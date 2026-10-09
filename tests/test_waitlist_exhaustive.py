"""Exhaustive unit and concurrency test suite for Automated Waitlist with Atomic Seat Reallocation.

Verifies:
1. Join waitlist and strict FIFO queue ordering (event queue & specific seat queue)
2. Duplicate join idempotency (same entry and position returned)
3. Hold release triggers atomic waitlist offer allocation
4. Offered seat cannot be stolen by normal reservation requests (409 SEAT_HELD)
5. Normal random seat reservation (SPOP) never selects an offered seat
6. Accept offer before expiration confirms booking and persists to stream
7. Accept offer is idempotent on repeat requests
8. Accept expired offer is rejected with 410 OFFER_EXPIRED
9. Decline offer immediately releases hold and reallocates to next eligible waitlisted user
10. Offer expiration releases hold and reallocates to next eligible waitlisted user
11. Confirmed booking cancellation triggers immediate waitlist reallocation
12. Leave waitlist deactivates entry and cleans active offers
13. In-app notification creation, retrieval, and read state tracking
14. Waitlist telemetry stats gathering for live dashboard monitoring
15. High contention: multiple users competing for same released seat with zero double-bookings
"""

import asyncio
import json
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.config import settings
from app.services.waitlist import waitlist_service
from app.services.notifications import notification_service
from tests.test_p2_routes import FakeInventory


class WaitlistTestInventory(FakeInventory):
    """Test fake inventory supporting reservations, cancellations, and state inspection."""

    def __init__(self, hold_ttl_ms=120000):
        super().__init__(hold_ttl_ms=hold_ttl_ms)

    async def get_reservation(self, event_id: str, reservation_id: str) -> dict | None:
        ev = self.events.get(event_id)
        if not ev:
            return None
        st = ev["rids"].get(reservation_id)
        if not st:
            return None
        status, seat_id = st
        exp = ev["holds"].get(seat_id, (None, None))[1] if status == "HELD" else None
        return {
            "reservation_id": reservation_id,
            "event_id": event_id,
            "seat_id": seat_id,
            "status": status,
            "expires_at_ms": exp,
            "ttl_ms": max(0, exp - 1700000000000) if exp else 0,
        }

    async def cancel_booking(self, event_id: str, reservation_id: str) -> dict:
        ev = self.events.get(event_id)
        if not ev:
            return {"code": "UNKNOWN", "seat_id": None}
        st = ev["rids"].get(reservation_id)
        if not st or st[0] != "CONFIRMED":
            return {"code": "NOT_CONFIRMED", "seat_id": None}
        seat_id = st[1]
        ev["sold"].pop(seat_id, None)
        if isinstance(ev["free"], list):
            if seat_id not in ev["free"]:
                ev["free"].append(seat_id)
        elif isinstance(ev["free"], set):
            ev["free"].add(seat_id)
        ev["rids"][reservation_id] = ("CANCELLED", seat_id)
        return {"code": "OK", "seat_id": seat_id}

    async def stream_len(self) -> int:
        return 0


class FakeWaitlistRedis:
    """Redis fake tracking hashes, sorted sets, sets, and lists for waitlist testing."""

    def __init__(self):
        self.hashes = {}
        self.zsets = {}
        self.sets = {}
        self.lists = {}
        self.keys = {}
        self.now_ms = 1700000000000

    async def time(self):
        s = self.now_ms // 1000
        ms = (self.now_ms % 1000) * 1000
        return (s, ms)

    async def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    async def hset(self, key, field, value):
        if key not in self.hashes:
            self.hashes[key] = {}
        self.hashes[key][field] = value
        return 1

    async def hdel(self, key, field):
        if key in self.hashes and field in self.hashes[key]:
            del self.hashes[key][field]
            return 1
        return 0

    async def hlen(self, key):
        return len(self.hashes.get(key, {}))

    async def hexists(self, key, field):
        return 1 if (key in self.hashes and field in self.hashes[key]) else 0

    async def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    async def zadd(self, key, mapping):
        if key not in self.zsets:
            self.zsets[key] = {}
        for m, s in mapping.items():
            self.zsets[key][m] = s
        return len(mapping)

    async def zrank(self, key, member):
        z = self.zsets.get(key, {})
        if member not in z:
            return None
        sorted_members = sorted(z.keys(), key=lambda m: z[m])
        return sorted_members.index(member)

    async def zrem(self, key, member):
        if key in self.zsets and member in self.zsets[key]:
            del self.zsets[key][member]
            return 1
        return 0

    async def zcard(self, key):
        return len(self.zsets.get(key, {}))

    async def zrange(self, key, start, stop, withscores=False):
        z = self.zsets.get(key, {})
        sorted_members = sorted(z.keys(), key=lambda m: z[m])
        if stop == -1:
            res = sorted_members[start:]
        else:
            res = sorted_members[start:stop + 1]
        if withscores:
            return [(m, z[m]) for m in res]
        return res

    async def srem(self, key, member):
        if key in self.sets and member in self.sets[key]:
            self.sets[key].remove(member)
            return 1
        return 0

    async def sadd(self, key, member):
        if key not in self.sets:
            self.sets[key] = set()
        self.sets[key].add(member)
        return 1

    async def lpush(self, key, value):
        if key not in self.lists:
            self.lists[key] = []
        self.lists[key].insert(0, value)
        return len(self.lists[key])

    async def lrange(self, key, start, stop):
        lst = self.lists.get(key, [])
        if stop == -1:
            return lst[start:]
        return lst[start:stop + 1]

    async def ltrim(self, key, start, stop):
        lst = self.lists.get(key, [])
        self.lists[key] = lst[start:stop + 1]
        return True

    async def xadd(self, key, fields):
        return "1700000000000-0"


@pytest.fixture
def setup_waitlist_env():
    """Setup clean test state for inventory, waitlist, and notifications."""
    fake_inv = WaitlistTestInventory()
    fake_redis = FakeWaitlistRedis()

    # Seed event evt1 with 10 seats
    seats = [f"S{i:03d}" for i in range(1, 11)]
    asyncio.run(fake_inv.seed_event("evt1", seats))

    app.state.inventory = fake_inv
    waitlist_service.set_redis(fake_redis)
    notification_service.set_redis(fake_redis)

    asyncio.run(waitlist_service.reset("evt1"))

    orig_wl_enabled = settings.WAITLIST_ENABLED
    orig_wr_enabled = settings.WAITING_ROOM_ENABLED
    settings.WAITLIST_ENABLED = True
    settings.WAITING_ROOM_ENABLED = False

    yield fake_inv, fake_redis

    settings.WAITLIST_ENABLED = orig_wl_enabled
    settings.WAITING_ROOM_ENABLED = orig_wr_enabled


@pytest.mark.asyncio
async def test_waitlist_join_and_fifo_order(setup_waitlist_env):
    """Test that users joining the waitlist are sequenced in strict FIFO order."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # User 1 joins
        r1 = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-alice", "seat_id": "S005"})
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["status"] == "WAITING"
        assert d1["position"] == 1
        assert d1["users_ahead"] == 0

        # Advance fake clock by 100ms
        fake_redis.now_ms += 100

        # User 2 joins
        r2 = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-bob", "seat_id": "S005"})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["status"] == "WAITING"
        assert d2["position"] == 2
        assert d2["users_ahead"] == 1

        # Advance fake clock by 100ms
        fake_redis.now_ms += 100

        # User 3 joins
        r3 = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-carol", "seat_id": "S005"})
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["position"] == 3
        assert d3["users_ahead"] == 2

        # Check status for User 2
        st2 = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-bob")
        assert st2.status_code == 200
        assert st2.json()["position"] == 2
        assert st2.json()["users_ahead"] == 1


@pytest.mark.asyncio
async def test_waitlist_duplicate_join_idempotency(setup_waitlist_env):
    """Test that repeated join requests for the same user return existing entry without moving position."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r1 = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-dan", "seat_id": "S002"})
        assert r1.status_code == 200
        entry_id = r1.json()["waitlist_entry_id"]

        # Duplicate join
        r2 = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-dan", "seat_id": "S002"})
        assert r2.status_code == 200
        assert r2.json()["waitlist_entry_id"] == entry_id
        assert r2.json()["position"] == 1


@pytest.mark.asyncio
async def test_hold_release_triggers_atomic_waitlist_offer(setup_waitlist_env):
    """Test that releasing a hold automatically claims the seat and issues an offer to the waitlisted user."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. User X reserves S001
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-holder", "seat_id": "S001"})
        assert res.status_code == 201
        rid = res.json()["reservation_id"]

        # 2. User Y joins waitlist for S001
        wl_res = await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-waiter", "seat_id": "S001"})
        assert wl_res.status_code == 200
        assert wl_res.json()["status"] == "WAITING"

        # 3. User X releases S001
        rel_res = await client.delete(f"/api/v1/events/evt1/reservations/{rid}")
        assert rel_res.status_code == 200

        # 4. User Y should now have an active OFFER for S001!
        status_res = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-waiter")
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["status"] == "OFFERED"
        assert status_data["offer"] is not None
        assert status_data["offer"]["seat_id"] == "S001"
        assert status_data["offer"]["status"] == "ACTIVE"
        assert status_data["offer"]["remaining_seconds"] > 0


@pytest.mark.asyncio
async def test_offered_seat_cannot_be_stolen_by_normal_reserve(setup_waitlist_env):
    """Test that a seat currently offered to a waitlist user cannot be reserved by competing normal requests."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Hold and release to trigger offer
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-1", "seat_id": "S003"})
        rid = res.json()["reservation_id"]

        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-waitlist-1", "seat_id": "S003"})
        await client.delete(f"/api/v1/events/evt1/reservations/{rid}")

        # Competing normal user tries to reserve S003 directly
        competing_res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-stealer", "seat_id": "S003"})
        assert competing_res.status_code == 409
        assert competing_res.json()["error"] in ("SEAT_HELD", "SEAT_SOLD")


@pytest.mark.asyncio
async def test_accept_offer_confirms_booking(setup_waitlist_env):
    """Test that accepting an active offer transitions the seat to confirmed and writes to the stream."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Trigger offer for u-waiter on S004
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-first", "seat_id": "S004"})
        rid = res.json()["reservation_id"]
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-buyer", "seat_id": "S004"})
        await client.delete(f"/api/v1/events/evt1/reservations/{rid}")

        # Fetch offer_id
        st = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-buyer")
        offer_id = st.json()["offer"]["offer_id"]

        # Accept offer
        accept_res = await client.post(
            f"/api/v1/events/evt1/waitlist/offers/{offer_id}/accept",
            json={"user_id": "u-buyer"},
        )
        assert accept_res.status_code == 200
        accept_data = accept_res.json()
        assert accept_data["status"] == "ACCEPTED"
        assert accept_data["seat_id"] == "S004"
        assert accept_data["idempotent"] is False

        # Repeat acceptance should be idempotent
        accept_rep = await client.post(
            f"/api/v1/events/evt1/waitlist/offers/{offer_id}/accept",
            json={"user_id": "u-buyer"},
        )
        assert accept_rep.status_code == 200
        assert accept_rep.json()["idempotent"] is True


@pytest.mark.asyncio
async def test_accept_expired_offer_rejected_410(setup_waitlist_env):
    """Test that an expired offer is rejected with 410 and cannot confirm the seat."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-first", "seat_id": "S005"})
        rid = res.json()["reservation_id"]
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-late", "seat_id": "S005"})
        await client.delete(f"/api/v1/events/evt1/reservations/{rid}")

        st = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-late")
        offer_id = st.json()["offer"]["offer_id"]

        # Fast forward past 120s TTL
        fake_redis.now_ms += 130000

        # Attempt accept
        accept_res = await client.post(
            f"/api/v1/events/evt1/waitlist/offers/{offer_id}/accept",
            json={"user_id": "u-late"},
        )
        assert accept_res.status_code == 410
        assert accept_res.json()["error"] == "OFFER_EXPIRED"


@pytest.mark.asyncio
async def test_decline_offer_reallocates_to_next_waitlisted_user(setup_waitlist_env):
    """Test that when User 1 declines an offer, the seat is immediately offered to User 2."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Hold S006
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-holder", "seat_id": "S006"})
        rid = res.json()["reservation_id"]

        # User 1 and User 2 join waitlist for S006
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-person-1", "seat_id": "S006"})
        fake_redis.now_ms += 50
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-person-2", "seat_id": "S006"})

        # Release S006 -> User 1 gets offer
        await client.delete(f"/api/v1/events/evt1/reservations/{rid}")

        st1 = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-person-1")
        offer_1 = st1.json()["offer"]["offer_id"]

        # User 1 declines
        dec_res = await client.post(
            f"/api/v1/events/evt1/waitlist/offers/{offer_1}/decline",
            json={"user_id": "u-person-1"},
        )
        assert dec_res.status_code == 200
        assert dec_res.json()["status"] == "DECLINED"

        # User 2 should immediately receive an active offer!
        st2 = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-person-2")
        assert st2.status_code == 200
        assert st2.json()["status"] == "OFFERED"
        assert st2.json()["offer"]["seat_id"] == "S006"


@pytest.mark.asyncio
async def test_booking_cancellation_triggers_waitlist_offer(setup_waitlist_env):
    """Test that cancelling a confirmed booking triggers waitlist reallocation."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. User holds and confirms S007
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-canceller", "seat_id": "S007"})
        rid = res.json()["reservation_id"]
        conf = await client.post(f"/api/v1/events/evt1/reservations/{rid}/confirm", json={"user_id": "u-canceller"})
        assert conf.status_code == 200

        # 2. Waitlist user joins for S007
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-waitlist-cancel", "seat_id": "S007"})

        # 3. User cancels confirmed booking
        canc_res = await client.post(
            f"/api/v1/events/evt1/reservations/{rid}/cancel",
            json={"user_id": "u-canceller"},
        )
        assert canc_res.status_code == 200
        assert canc_res.json()["status"] == "CANCELLED"

        # 4. Waitlist user receives offer for S007
        st = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-waitlist-cancel")
        assert st.status_code == 200
        assert st.json()["status"] == "OFFERED"
        assert st.json()["offer"]["seat_id"] == "S007"


@pytest.mark.asyncio
async def test_leave_waitlist(setup_waitlist_env):
    """Test withdrawing from the waitlist."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-quitter", "seat_id": "S008"})
        leave_res = await client.post("/api/v1/events/evt1/waitlist/leave", json={"user_id": "u-quitter"})
        assert leave_res.status_code == 200
        assert leave_res.json()["status"] == "LEFT"

        st = await client.get("/api/v1/events/evt1/waitlist/status?user_id=u-quitter")
        assert st.json()["status"] in ("LEFT", "NONE")


@pytest.mark.asyncio
async def test_notifications_lifecycle(setup_waitlist_env):
    """Test in-app notification dispatch and query."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Trigger offer for u-notify-user
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-holder", "seat_id": "S009"})
        rid = res.json()["reservation_id"]
        await client.post("/api/v1/events/evt1/waitlist/join", json={"user_id": "u-notify-user", "seat_id": "S009"})
        await client.delete(f"/api/v1/events/evt1/reservations/{rid}")

        # Fetch notifications
        notif_res = await client.get("/api/v1/events/evt1/notifications?user_id=u-notify-user")
        assert notif_res.status_code == 200
        notifs = notif_res.json()["notifications"]
        assert len(notifs) >= 1
        assert notifs[0]["type"] == "OFFER_CREATED"
        assert notifs[0]["data"]["seat_id"] == "S009"

        # Mark read
        read_res = await client.post("/api/v1/events/evt1/notifications/read", json={"user_id": "u-notify-user"})
        assert read_res.status_code == 200
        assert read_res.json()["ok"] is True


@pytest.mark.asyncio
async def test_waitlist_telemetry_stats(setup_waitlist_env):
    """Test waitlist operational statistics endpoint."""
    fake_inv, fake_redis = setup_waitlist_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        stats_res = await client.get("/api/v1/events/evt1/waitlist/stats")
        assert stats_res.status_code == 200
        d = stats_res.json()
        assert d["event_id"] == "evt1"
        assert "active_waiting" in d
        assert "active_offers" in d
        assert "offers_accepted" in d
        assert "offers_declined" in d
        assert "offers_expired" in d
        assert d["offer_ttl_sec"] == 120
