"""Tests for P2 API routes and components with FakeInventory. Owned by [P2] (throwaway test inside tests/)."""

import asyncio
from unittest.mock import patch
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.inventory import ConfirmResult, ReleaseResult, ReserveResult


class FakeInventory:
    """In-memory throwaway inventory implementation for route testing."""

    def __init__(self, hold_ttl_ms: int = 120000, rl_capacity: int = 20, rl_refill_per_sec: int = 10):
        self.hold_ttl_ms = hold_ttl_ms
        self.rl_capacity = rl_capacity
        self.rl_refill_per_sec = rl_refill_per_sec
        self.events: dict[str, dict] = {}
        self.rate_limit_allowed = True

    async def seed_event(self, event_id: str, seat_ids: list[str]) -> None:
        self.events[event_id] = {
            "all": list(seat_ids),
            "free": list(seat_ids),
            "holds": {},  # seat_id -> (rid, exp)
            "sold": {},   # seat_id -> rid
            "rids": {},   # rid -> (status, seat_id)
        }

    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult:
        ev = self.events.get(event_id)
        if not ev:
            return ReserveResult(code="SOLD_OUT")
        if seat_id is None:
            if not ev["free"]:
                return ReserveResult(code="SOLD_OUT")
            seat_id = ev["free"].pop(0)
        else:
            if seat_id in ev["sold"]:
                return ReserveResult(code="SEAT_SOLD")
            if seat_id in ev["holds"]:
                return ReserveResult(code="SEAT_HELD")
            if seat_id not in ev["all"]:
                return ReserveResult(code="SEAT_UNKNOWN")
            ev["free"].remove(seat_id)

        rid = f"rid-{seat_id}"
        exp = 1700000000000 + self.hold_ttl_ms
        ev["holds"][seat_id] = (rid, exp)
        ev["rids"][rid] = ("HELD", seat_id)
        return ReserveResult(code="OK", seat_id=seat_id, reservation_id=rid, expires_at_ms=exp)

    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult:
        ev = self.events.get(event_id)
        if not ev:
            return ConfirmResult(code="UNKNOWN")
        st = ev["rids"].get(reservation_id)
        if not st:
            return ConfirmResult(code="UNKNOWN")
        status, seat_id = st
        if status == "CONFIRMED":
            return ConfirmResult(code="ALREADY_CONFIRMED", seat_id=seat_id)
        if status != "HELD":
            return ConfirmResult(code="HOLD_EXPIRED", seat_id=seat_id)

        ev["holds"].pop(seat_id, None)
        ev["sold"][seat_id] = reservation_id
        ev["rids"][reservation_id] = ("CONFIRMED", seat_id)
        return ConfirmResult(code="OK", seat_id=seat_id)

    async def release(self, event_id: str, reservation_id: str) -> ReleaseResult:
        ev = self.events.get(event_id)
        if not ev:
            return ReleaseResult(code="UNKNOWN")
        st = ev["rids"].get(reservation_id)
        if not st:
            return ReleaseResult(code="UNKNOWN")
        status, seat_id = st
        if status == "CONFIRMED":
            return ReleaseResult(code="ALREADY_CONFIRMED", seat_id=seat_id)
        if status != "HELD":
            return ReleaseResult(code="NOOP", seat_id=seat_id)

        ev["holds"].pop(seat_id, None)
        ev["free"].append(seat_id)
        ev["rids"][reservation_id] = ("RELEASED", seat_id)
        return ReleaseResult(code="OK", seat_id=seat_id)

    async def stats(self, event_id: str) -> dict:
        ev = self.events.get(event_id, {"all": [], "free": [], "holds": {}, "sold": {}})
        return {
            "event_id": event_id,
            "total": len(ev["all"]),
            "free": len(ev["free"]),
            "held": len(ev["holds"]),
            "sold": len(ev["sold"]),
            "hold_ttl_ms": self.hold_ttl_ms,
        }

    async def seat_map(self, event_id: str) -> dict[str, str]:
        ev = self.events.get(event_id, {"all": []})
        res = {}
        for s in ev["all"]:
            if s in ev["sold"]:
                res[s] = "SOLD"
            elif s in ev["holds"]:
                res[s] = "HELD"
            else:
                res[s] = "FREE"
        return res

    async def sold_map(self, event_id: str) -> dict[str, str]:
        ev = self.events.get(event_id, {"sold": {}})
        return dict(ev["sold"])

    async def allow_request(self, client_key: str) -> tuple[bool, int]:
        return (self.rate_limit_allowed, 10 if self.rate_limit_allowed else 0)

    async def stream_len(self) -> int:
        return 0


@pytest.fixture
def fake_inventory():
    inv = FakeInventory()
    seat_ids = [f"S{i:03d}" for i in range(1, 201)]
    asyncio.run(inv.seed_event("evt1", seat_ids))
    return inv


@pytest.mark.asyncio
async def test_healthz():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}


@pytest.mark.asyncio
async def test_metrics():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        assert "reserve_total" in resp.text
        assert "confirm_total" in resp.text
        assert "request_latency_seconds" in resp.text


@pytest.mark.asyncio
async def test_ui_mount():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/ui/")
        assert resp.status_code == 200
        assert "FlashSeat" in resp.text


@pytest.mark.asyncio
async def test_reserve_confirm_release_flow(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Reserve specific seat
        resp = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u1", "seat_id": "S001"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["seat_id"] == "S001"
        assert "reservation_id" in data
        assert "expires_at_ms" in data
        assert data["ttl_ms"] == 120000
        rid = data["reservation_id"]

        # 2. Reserve same seat -> 409 SEAT_HELD
        resp2 = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u2", "seat_id": "S001"})
        assert resp2.status_code == 409
        assert resp2.json()["error"] == "SEAT_HELD"

        # 3. Confirm reservation
        c_resp1 = await client.post(f"/api/v1/events/evt1/reservations/{rid}/confirm", json={"user_id": "u1"})
        assert c_resp1.status_code == 200
        c_data1 = c_resp1.json()
        assert c_data1["status"] == "CONFIRMED"
        assert c_data1["seat_id"] == "S001"
        assert c_data1["idempotent"] is False

        # 4. Confirm AGAIN (idempotent)
        c_resp2 = await client.post(f"/api/v1/events/evt1/reservations/{rid}/confirm", json={"user_id": "u1"})
        assert c_resp2.status_code == 200
        c_data2 = c_resp2.json()
        assert c_data2["status"] == "CONFIRMED"
        assert c_data2["seat_id"] == "S001"
        assert c_data2["idempotent"] is True

        # 5. Reserve confirmed seat -> 409 SEAT_SOLD
        resp3 = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u3", "seat_id": "S001"})
        assert resp3.status_code == 409
        assert resp3.json()["error"] == "SEAT_SOLD"

        # 6. Release confirmed seat -> 409 ALREADY_CONFIRMED
        r_resp = await client.delete(f"/api/v1/events/evt1/reservations/{rid}")
        assert r_resp.status_code == 409
        assert r_resp.json()["error"] == "ALREADY_CONFIRMED"

        # 7. Reserve another seat with seat_id=None (any seat)
        resp4 = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u4", "seat_id": None})
        assert resp4.status_code == 201
        data4 = resp4.json()
        assert data4["seat_id"] == "S002"
        rid4 = data4["reservation_id"]

        # 8. Release held seat -> 200 RELEASED
        r_resp2 = await client.delete(f"/api/v1/events/evt1/reservations/{rid4}")
        assert r_resp2.status_code == 200
        assert r_resp2.json()["status"] == "RELEASED"
        assert r_resp2.json()["seat_id"] == "S002"


@pytest.mark.asyncio
async def test_reserve_unknown_seat(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u1", "seat_id": "S999"})
        assert resp.status_code == 404
        assert resp.json()["error"] == "SEAT_UNKNOWN"


@pytest.mark.asyncio
async def test_confirm_unknown_rid(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/events/evt1/reservations/nonexistent/confirm", json={"user_id": "u1"})
        assert resp.status_code == 404
        assert resp.json()["error"] == "UNKNOWN"


@pytest.mark.asyncio
async def test_rate_limiting(fake_inventory):
    app.state.inventory = fake_inventory
    fake_inventory.rate_limit_allowed = False
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/v1/events/evt1/reserve", json={"user_id": "u_spammer", "seat_id": "S010"})
        assert resp.status_code == 429
        assert resp.headers.get("retry-after") == "1"
        assert resp.json()["error"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_stats_and_seats(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        s_resp = await client.get("/api/v1/events/evt1/stats")
        assert s_resp.status_code == 200
        s_data = s_resp.json()
        assert s_data["event_id"] == "evt1"
        assert s_data["total"] == 200
        assert s_data["free"] == 200

        seats_resp = await client.get("/api/v1/events/evt1/seats")
        assert seats_resp.status_code == 200
        seats_data = seats_resp.json()
        assert "seats" in seats_data
        assert seats_data["seats"]["S001"] == "FREE"


@pytest.mark.asyncio
async def test_verify_endpoint(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/events/evt1/verify")
        assert resp.status_code == 200
        v_data = resp.json()
        assert v_data["event_id"] == "evt1"
        assert "redis_sold" in v_data
        assert "pg_bookings" in v_data
        assert "drained" in v_data
        assert "duplicate_seat_rows" in v_data
        assert "missing_in_pg" in v_data
        assert "extra_in_pg" in v_data
        assert "consistent" in v_data
        assert "no_double_booking" in v_data


@pytest.mark.asyncio
async def test_admin_create_and_reset(fake_inventory):
    app.state.inventory = fake_inventory
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create event
        c_resp = await client.post("/api/v1/admin/events", json={"event_id": "evt2", "seat_count": 50})
        assert c_resp.status_code == 201
        assert c_resp.json() == {"event_id": "evt2", "seat_count": 50}

        # Reset event
        r_resp = await client.post("/api/v1/admin/events/evt2/reset")
        assert r_resp.status_code == 200
        assert r_resp.json() == {"event_id": "evt2", "seat_count": 50}
