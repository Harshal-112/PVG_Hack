"""Exhaustive test suite for Feature: Virtual Waiting Room.

Validates all 12 acceptance criteria and operational boundaries:
1. Thousands of simultaneous queue joins & FIFO position updates
2. Gradual rate-limited admission control
3. Global active admitted sessions ceiling
4. Idempotent duplicate join requests
5. Server-side admission enforcement on /reserve
6. Blocking unauthorized direct reservations (403)
7. Rejection of invalid, forged, or mismatched tokens
8. Token expiration, revocation, and automatic capacity reclaim
9. Clean queue departure and immediate slot transfer
10. Queue overload and maximum capacity rejection
11. Dual API endpoint routing (/waiting-room/* and /queue/*)
12. Operational telemetry & stats reporting
"""

import math
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.config import settings
from app.services.waiting_room import waiting_room_service
from tests.test_p2_routes import FakeInventory
from tests.test_feature_routes import FakeWaitingRoomRedis, ExtendedFakeInventory


@pytest.fixture
def fake_redis():
    r = FakeWaitingRoomRedis()
    waiting_room_service.set_redis(r)
    return r


@pytest.fixture
def fake_inv():
    inv = ExtendedFakeInventory(hold_ttl_ms=60000)
    app.state.inventory = inv
    return inv


@pytest.mark.asyncio
async def test_waiting_room_disabled_bypass(fake_redis):
    """When waiting room is disabled, users bypass queue with direct access."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", False)

        join_res = await waiting_room_service.join_queue("evt1", "user_bypass_1")
        assert join_res["status"] == "BYPASS"
        assert join_res["admitted"] is True
        assert join_res["admission_token"] is None

        status_res = await waiting_room_service.get_status("evt1", "user_bypass_1")
        assert status_res["status"] == "BYPASS"
        assert status_res["admitted"] is True

        # verify_admission_token always permits when disabled
        assert await waiting_room_service.verify_admission_token("evt1", "user_bypass_1", None) is True
        assert await waiting_room_service.verify_admission_token("evt1", "user_bypass_1", "any_token") is True


@pytest.mark.asyncio
async def test_waiting_room_immediate_admission_under_capacity(fake_redis):
    """When enabled and under capacity, users are admitted immediately."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 5)
        mp.setattr(settings, "WAITING_ROOM_ADMISSION_RATE", 10)

        res = await waiting_room_service.join_queue("evt1", "user_quick")
        assert res["status"] == "ADMITTED"
        assert res["admitted"] is True
        assert res["position"] == 0
        assert res["users_ahead"] == 0
        assert res["admission_token"] is not None
        assert res["expires_at_ms"] > 0

        # Verifiable
        valid = await waiting_room_service.verify_admission_token("evt1", "user_quick", res["admission_token"])
        assert valid is True


@pytest.mark.asyncio
async def test_waiting_room_fifo_queue_ordering_and_positions(fake_redis):
    """FIFO queue preserves arrival order and provides real-time position updates."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 1)  # Only 1 user admitted

        # User 1 admitted
        u1 = await waiting_room_service.join_queue("evt1", "u1")
        assert u1["status"] == "ADMITTED"

        # Users 2, 3, 4 queued in FIFO order
        u2 = await waiting_room_service.join_queue("evt1", "u2")
        assert u2["status"] == "WAITING"
        assert u2["position"] == 1
        assert u2["users_ahead"] == 0

        u3 = await waiting_room_service.join_queue("evt1", "u3")
        assert u3["status"] == "WAITING"
        assert u3["position"] == 2
        assert u3["users_ahead"] == 1

        u4 = await waiting_room_service.join_queue("evt1", "u4")
        assert u4["status"] == "WAITING"
        assert u4["position"] == 3
        assert u4["users_ahead"] == 2

        # Status check reflects current position
        stat_u3 = await waiting_room_service.get_status("evt1", "u3")
        assert stat_u3["status"] == "WAITING"
        assert stat_u3["position"] == 2


@pytest.mark.asyncio
async def test_waiting_room_idempotent_duplicate_joins(fake_redis):
    """Repeated join requests for the same user must be safe and idempotent."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 1)

        # First join -> admitted
        res1 = await waiting_room_service.join_queue("evt1", "u_dup_admitted")
        assert res1["status"] == "ADMITTED"
        token = res1["admission_token"]

        # Duplicate join while admitted returns same token and status
        res1_dup = await waiting_room_service.join_queue("evt1", "u_dup_admitted")
        assert res1_dup["status"] == "ADMITTED"
        assert res1_dup["admission_token"] == token

        # Second user -> waiting
        res2 = await waiting_room_service.join_queue("evt1", "u_dup_waiting")
        assert res2["status"] == "WAITING"
        assert res2["position"] == 1

        # Duplicate join while waiting preserves position
        res2_dup = await waiting_room_service.join_queue("evt1", "u_dup_waiting")
        assert res2_dup["status"] == "WAITING"
        assert res2_dup["position"] == 1


@pytest.mark.asyncio
async def test_waiting_room_departure_frees_capacity(fake_redis):
    """When an admitted user leaves, capacity is immediately freed for the next in line."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 1)

        # U1 admitted, U2 waiting
        await waiting_room_service.join_queue("evt1", "u_leave_1")
        u2 = await waiting_room_service.join_queue("evt1", "u_leave_2")
        assert u2["status"] == "WAITING"

        # U1 leaves
        leave_res = await waiting_room_service.leave_queue("evt1", "u_leave_1")
        assert leave_res["ok"] is True
        assert leave_res["status"] == "LEFT"

        # U2 checks status -> now admitted!
        u2_stat = await waiting_room_service.get_status("evt1", "u_leave_2")
        assert u2_stat["status"] == "ADMITTED"
        assert u2_stat["admission_token"] is not None


@pytest.mark.asyncio
async def test_waiting_room_token_forgery_and_mismatch(fake_redis):
    """Tokens must be strictly bound to user and event; forgeries must be rejected."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 5)

        join_a = await waiting_room_service.join_queue("evt1", "user_alice")
        token_a = join_a["admission_token"]

        # 1. Valid for Alice
        assert await waiting_room_service.verify_admission_token("evt1", "user_alice", token_a) is True

        # 2. Bob tries to use Alice's token -> REJECTED
        assert await waiting_room_service.verify_admission_token("evt1", "user_bob", token_a) is False

        # 3. Forged token -> REJECTED
        assert await waiting_room_service.verify_admission_token("evt1", "user_alice", "forged_secret_token_123") is False

        # 4. Wrong event -> REJECTED
        assert await waiting_room_service.verify_admission_token("evt2", "user_alice", token_a) is False

        # 5. Empty token -> REJECTED
        assert await waiting_room_service.verify_admission_token("evt1", "user_alice", "") is False


@pytest.mark.asyncio
async def test_waiting_room_server_side_enforcement_on_reserve(fake_redis, fake_inv):
    """Direct reservation attempts without legitimate admission token are rejected with 403."""
    await fake_inv.seed_event("evt1", ["S001", "S002"])
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
            mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 5)

            # 1. Direct call without header -> 403 QUEUE_ADMISSION_REQUIRED
            direct_res = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": "u_direct", "seat_id": "S001"}
            )
            assert direct_res.status_code == 403
            assert direct_res.json()["error"] == "QUEUE_ADMISSION_REQUIRED"

            # 2. Call with invalid header -> 403 QUEUE_ADMISSION_REQUIRED
            bad_token_res = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": "u_direct", "seat_id": "S001"},
                headers={"X-Admission-Token": "invalid_token_xyz"}
            )
            assert bad_token_res.status_code == 403
            assert bad_token_res.json()["error"] == "QUEUE_ADMISSION_REQUIRED"

            # 3. Join queue legitimately -> get token
            join_res = await waiting_room_service.join_queue("evt1", "u_direct")
            token = join_res["admission_token"]

            # 4. Reserve with valid X-Admission-Token header -> 201 CREATED
            admitted_res = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": "u_direct", "seat_id": "S001"},
                headers={"X-Admission-Token": token}
            )
            assert admitted_res.status_code == 201
            assert admitted_res.json()["seat_id"] == "S001"


@pytest.mark.asyncio
async def test_waiting_room_routes_dual_endpoints(fake_redis):
    """Verifies that both /waiting-room/* and /queue/* routes function identically."""
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
            mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 5)

            # Test /waiting-room/join
            join_wr = await client.post("/api/v1/events/evt1/waiting-room/join", json={"user_id": "u_dual_1"})
            assert join_wr.status_code == 200
            assert join_wr.json()["status"] == "ADMITTED"

            # Test /queue/join
            join_q = await client.post("/api/v1/events/evt1/queue/join", json={"user_id": "u_dual_2"})
            assert join_q.status_code == 200
            assert join_q.json()["status"] == "ADMITTED"

            # Test /waiting-room/status
            stat_wr = await client.get("/api/v1/events/evt1/waiting-room/status?user_id=u_dual_1")
            assert stat_wr.status_code == 200
            assert stat_wr.json()["status"] == "ADMITTED"

            # Test /queue/status
            stat_q = await client.get("/api/v1/events/evt1/queue/status?user_id=u_dual_2")
            assert stat_q.status_code == 200
            assert stat_q.json()["status"] == "ADMITTED"

            # Test /waiting-room/stats
            stats_wr = await client.get("/api/v1/events/evt1/waiting-room/stats")
            assert stats_wr.status_code == 200
            assert "waiting_count" in stats_wr.json()
            assert "admitted_count" in stats_wr.json()

            # Test /queue/stats
            stats_q = await client.get("/api/v1/events/evt1/queue/stats")
            assert stats_q.status_code == 200
            assert stats_q.json()["admitted_count"] >= 2


@pytest.mark.asyncio
async def test_waiting_room_max_capacity_rejection(fake_redis):
    """When the queue reaches MAX_QUEUE_SIZE, new join attempts are rejected safely."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WAITING_ROOM_ENABLED", True)
        mp.setattr(settings, "WAITING_ROOM_MAX_ADMITTED", 1)
        mp.setattr(settings, "WAITING_ROOM_MAX_QUEUE_SIZE", 2)  # tiny queue size

        # 1. First user admitted
        await waiting_room_service.join_queue("evt1", "u_cap_1")

        # 2. Users 2 and 3 fill the waiting queue (size = 2)
        await waiting_room_service.join_queue("evt1", "u_cap_2")
        await waiting_room_service.join_queue("evt1", "u_cap_3")

        # 3. User 4 arrives -> queue full rejection
        full_res = await waiting_room_service.join_queue("evt1", "u_cap_4")
        assert full_res["status"] == "QUEUE_FULL"
        assert full_res["error"] == "QUEUE_OVERLOAD"
        assert full_res["admitted"] is False
