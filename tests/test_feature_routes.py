"""Comprehensive unit and route tests for Features 2, 3, 4, 5, and 6.

Validates:
- Feature 2: Reservation inspection endpoint and TTL lifecycle
- Feature 3: Server-side ticket verification and unconfirmed ticket rejection
- Feature 4: Admin dashboard overview and authentication protection
- Feature 5: Event discovery, searching, filtering, and empty search states
- Feature 6: Virtual waiting room queue, token validation, and server-side bypass rejection
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.config import settings
from tests.test_p2_routes import FakeInventory


class ExtendedFakeInventory(FakeInventory):
    """FakeInventory extended with get_reservation and stream_len for testing."""

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

    async def stream_len(self) -> int:
        return 0


class FakeWaitingRoomRedis:
    """In-memory Redis fake for waiting room testing."""

    def __init__(self):
        self.hashes = {}
        self.zsets = {}
        self.keys = {}

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

    async def set(self, key, value, ex=None):
        self.keys[key] = value
        return True

    async def get(self, key):
        return self.keys.get(key)

    async def delete(self, key):
        if key in self.keys:
            del self.keys[key]
            return 1
        return 0


@pytest.fixture
def fake_inventory():
    inv = ExtendedFakeInventory(hold_ttl_ms=60000)
    return inv


# -------------------------------------------------------------------------
# Feature 2 Tests: Reservation Inspection & TTL
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_feature2_get_reservation_lifecycle(fake_inventory):
    await fake_inventory.seed_event("evt1", ["S001", "S002"])
    app.state.inventory = fake_inventory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Reserve S001
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-feat2", "seat_id": "S001"})
        assert res.status_code == 201
        data = res.json()
        rid = data["reservation_id"]

        # Inspect reservation status via Feature 2 endpoint
        status_res = await client.get(f"/api/v1/events/evt1/reservations/{rid}")
        assert status_res.status_code == 200
        status_data = status_res.json()
        assert status_data["reservation_id"] == rid
        assert status_data["seat_id"] == "S001"
        assert status_data["status"] == "HELD"
        assert status_data["expires_at_ms"] is not None

        # Unknown reservation returns 404
        unknown_res = await client.get("/api/v1/events/evt1/reservations/nonexistent_rid")
        assert unknown_res.status_code == 404
        assert unknown_res.json()["error"] == "UNKNOWN"


# -------------------------------------------------------------------------
# Feature 3 Tests: Server-side Ticket Verification
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_feature3_ticket_verification(fake_inventory):
    await fake_inventory.seed_event("evt1", ["S001"])
    app.state.inventory = fake_inventory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Reserve S001
        res = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u-feat3", "seat_id": "S001"})
        rid = res.json()["reservation_id"]

        # Attempt to verify BEFORE confirmation -> MUST FAIL (Feature 3 requirement)
        pre_verify = await client.get(f"/api/v1/events/evt1/tickets/{rid}/verify")
        assert pre_verify.status_code == 404
        assert pre_verify.json()["valid"] is False

        # Confirm reservation
        confirm_res = await client.post(f"/api/v1/events/evt1/reservations/{rid}/confirm", json={"user_id": "u-feat3"})
        assert confirm_res.status_code == 200

        # Verify AFTER confirmation -> MUST PASS
        verify_res = await client.get(f"/api/v1/events/evt1/tickets/{rid}/verify")
        assert verify_res.status_code == 200
        v_data = verify_res.json()
        assert v_data["valid"] is True
        assert v_data["seat_id"] == "S001"
        assert v_data["status"] == "CONFIRMED"
        assert v_data["verification_code"].startswith("TKT-")

        # Query param endpoint verification
        query_verify = await client.get(f"/api/v1/tickets/verify?event_id=evt1&reservation_id={rid}")
        assert query_verify.status_code == 200
        assert query_verify.json()["valid"] is True


# -------------------------------------------------------------------------
# Feature 4 Tests: Live Admin Dashboard & Auth Protection
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_feature4_admin_dashboard_auth_and_metrics(fake_inventory):
    await fake_inventory.seed_event("evt1", ["S001", "S002"])
    app.state.inventory = fake_inventory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Missing Admin Key -> 401 UNAUTHORIZED
        unauth_res = await client.get("/api/v1/admin/overview?event_id=evt1")
        assert unauth_res.status_code == 401
        assert unauth_res.json()["error"] == "UNAUTHORIZED"

        # 2. Invalid Admin Key -> 401 UNAUTHORIZED
        bad_key_res = await client.get(
            "/api/v1/admin/overview?event_id=evt1",
            headers={"X-Admin-Key": "wrong_key"}
        )
        assert bad_key_res.status_code == 401

        # 3. Valid Admin Key -> 200 OK with full metrics
        auth_res = await client.get(
            "/api/v1/admin/overview?event_id=evt1",
            headers={"X-Admin-Key": settings.ADMIN_SECRET_KEY}
        )
        assert auth_res.status_code == 200
        overview = auth_res.json()
        assert "refreshed_at" in overview
        assert "inventory" in overview
        assert overview["inventory"]["total"] == 2
        assert overview["inventory"]["free"] == 2
        assert "persistence" in overview
        assert "telemetry" in overview


# -------------------------------------------------------------------------
# Feature 5 Tests: Event Discovery and Search
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_feature5_event_discovery_and_search(fake_inventory):
    await fake_inventory.seed_event("evt1", ["S001", "S002"])
    app.state.inventory = fake_inventory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. List all events
        list_res = await client.get("/api/v1/events")
        assert list_res.status_code == 200
        data = list_res.json()
        assert "events" in data
        assert data["total_events"] >= 3

        # 2. Search by keyword
        search_res = await client.get("/api/v1/events?search=Summit")
        assert search_res.status_code == 200
        search_data = search_res.json()
        assert len(search_data["events"]) == 1
        assert search_data["events"][0]["event_id"] == "evt2"

        # 3. Filter by category
        cat_res = await client.get("/api/v1/events?category=Music")
        assert cat_res.status_code == 200
        assert len(cat_res.json()["events"]) >= 1

        # 4. Search with no matches -> empty results list without error
        empty_res = await client.get("/api/v1/events?search=nonexistent_query_xyz")
        assert empty_res.status_code == 200
        assert len(empty_res.json()["events"]) == 0

        # 5. Get single event detail
        detail_res = await client.get("/api/v1/events/evt1")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["event_id"] == "evt1"
        assert "name" in detail
        assert "venue" in detail
        assert "free" in detail


# -------------------------------------------------------------------------
# Feature 6 Tests: Virtual Waiting Room & Server-side Bypass Prevention
# -------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_feature6_virtual_waiting_room():
    from app.services.waiting_room import waiting_room_service
    fake_redis = FakeWaitingRoomRedis()
    waiting_room_service.set_redis(fake_redis)

    # 1. When disabled: join returns BYPASS
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", False)

        join_res = await waiting_room_service.join_queue("evt1", "u-wr1")
        assert join_res["status"] == "BYPASS"
        assert join_res["admitted"] is True

        # verify_admission_token always permits when disabled
        assert await waiting_room_service.verify_admission_token("evt1", "u-wr1", None) is True

    # 2. When enabled: join issues admission or queues
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 1)  # small capacity

        # First user is admitted immediately
        user1_join = await waiting_room_service.join_queue("evt1", "u-wr1")
        assert user1_join["status"] == "ADMITTED"
        assert user1_join["admitted"] is True
        token1 = user1_join["admission_token"]
        assert token1 is not None

        # Token 1 is verified
        assert await waiting_room_service.verify_admission_token("evt1", "u-wr1", token1) is True
        # Wrong token is rejected
        assert await waiting_room_service.verify_admission_token("evt1", "u-wr1", "bogus_token") is False

        # Second user must wait in queue (capacity = 1)
        user2_join = await waiting_room_service.join_queue("evt1", "u-wr2")
        assert user2_join["status"] == "WAITING"
        assert user2_join["admitted"] is False
        assert user2_join["position"] == 1

        # Check status for user 2
        user2_status = await waiting_room_service.get_status("evt1", "u-wr2")
        assert user2_status["status"] == "WAITING"

        # User 1 leaves, slot opens for user 2
        await waiting_room_service.leave_queue("evt1", "u-wr1")
        user2_status_admitted = await waiting_room_service.get_status("evt1", "u-wr2")
        assert user2_status_admitted["status"] == "ADMITTED"
        assert user2_status_admitted["admission_token"] is not None


@pytest.mark.asyncio
async def test_feature6_server_side_bypass_prevention(fake_inventory):
    """Verify that calling /reserve directly without an admission token is blocked when enabled."""
    await fake_inventory.seed_event("evt1", ["S001"])
    app.state.inventory = fake_inventory

    from app.services.waiting_room import waiting_room_service
    fake_redis = FakeWaitingRoomRedis()
    waiting_room_service.set_redis(fake_redis)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Enable waiting room
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "WAITING_ROOM_ENABLED", True)

            # Direct reserve attempt with NO token -> 403 QUEUE_ADMISSION_REQUIRED
            direct_attempt = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": "u-bypass", "seat_id": "S001"}
            )
            assert direct_attempt.status_code == 403
            assert direct_attempt.json()["error"] == "QUEUE_ADMISSION_REQUIRED"

            # Join waiting room legitimately to get token
            join_res = await waiting_room_service.join_queue("evt1", "u-bypass")
            token = join_res["admission_token"]

            # Reserve with legitimate admission token -> 201 CREATED
            admitted_attempt = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": "u-bypass", "seat_id": "S001"},
                headers={"X-Admission-Token": token}
            )
            assert admitted_attempt.status_code == 201
            assert admitted_attempt.json()["seat_id"] == "S001"
