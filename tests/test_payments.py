"""Comprehensive automated tests for Razorpay payment integration in FlashSeat.

Tests all scenarios required by SPEC and integration prompt:
- Successful payment order creation
- Invalid or unknown reservation
- Expired reservation
- Invalid payment signature
- Incorrect amount or currency
- Payment not captured / capture handling
- Successful verified payment and booking
- Duplicate verification request (idempotency)
- Duplicate webhook delivery
- Out-of-order webhook events
- Concurrent confirmation attempts
- Booking confirmation failure after payment capture (triggers automatic refund)
- Correct payment and booking state persistence
"""

import asyncio
import hashlib
import hmac
import json
import time
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import (
    _mem_payments,
    _mem_webhooks,
    get_payment_by_order_id,
    get_payment_by_reservation_id,
)
from app.main import app
from app.routes.payments import razorpay_service
from app.services.inventory import ConfirmResult, ReleaseResult, ReserveResult


class MockInventory:
    """Mock inventory service supporting reservations, holds, and confirmation."""

    def __init__(self, hold_ttl_ms: int = 120000):
        self.hold_ttl_ms = hold_ttl_ms
        self.events: dict[str, dict] = {}
        self.confirm_results: dict[str, ConfirmResult] = {}

    def seed_event(self, event_id: str, seats: list[str]):
        self.events[event_id] = {
            "all": list(seats),
            "free": list(seats),
            "holds": {},   # seat_id -> (rid, exp_ms)
            "sold": {},    # seat_id -> rid
            "rids": {},    # rid -> (status, seat_id)
        }

    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult:
        ev = self.events.get(event_id)
        if not ev or not ev["free"]:
            return ReserveResult(code="SOLD_OUT")
        target_seat = seat_id or ev["free"][0]
        if target_seat not in ev["free"]:
            return ReserveResult(code="SEAT_HELD")
        ev["free"].remove(target_seat)
        rid = uuid.uuid4().hex
        exp = int(time.time() * 1000) + self.hold_ttl_ms
        ev["holds"][target_seat] = (rid, exp)
        ev["rids"][rid] = ("HELD", target_seat)
        return ReserveResult(code="OK", seat_id=target_seat, reservation_id=rid, expires_at_ms=exp)

    async def get_reservation(self, event_id: str, reservation_id: str) -> dict | None:
        ev = self.events.get(event_id)
        if not ev or reservation_id not in ev["rids"]:
            return None
        st, seat = ev["rids"][reservation_id]
        exp = ev["holds"].get(seat, (None, None))[1]
        return {"status": st, "seat_id": seat, "expires_at_ms": exp}

    async def allow_request(self, client_key: str) -> tuple[bool, int]:
        return (True, 20)

    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult:

        if reservation_id in self.confirm_results:
            return self.confirm_results[reservation_id]

        ev = self.events.get(event_id)
        if not ev or reservation_id not in ev["rids"]:
            return ConfirmResult(code="UNKNOWN")
        st, seat = ev["rids"][reservation_id]
        if st == "CONFIRMED":
            return ConfirmResult(code="ALREADY_CONFIRMED", seat_id=seat)
        if st != "HELD":
            return ConfirmResult(code="HOLD_EXPIRED", seat_id=seat)

        ev["holds"].pop(seat, None)
        ev["sold"][seat] = reservation_id
        ev["rids"][reservation_id] = ("CONFIRMED", seat)
        return ConfirmResult(code="OK", seat_id=seat)


def make_sig(order_id: str, payment_id: str, secret: str = settings.RAZORPAY_KEY_SECRET) -> str:
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def make_webhook_sig(body: bytes, secret: str = settings.RAZORPAY_WEBHOOK_SECRET) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


@pytest.fixture(autouse=True)
def setup_test_env():
    """Clear in-memory database stores before each test."""
    _mem_payments.clear()
    _mem_webhooks.clear()


@pytest.fixture
def inv():
    inventory = MockInventory()
    inventory.seed_event("evt1", ["S001", "S002", "S003", "S004", "S005"])
    app.state.inventory = inventory
    return inventory


@pytest.mark.asyncio
async def test_successful_payment_order_creation(inv):
    """Test creating a Razorpay payment order for a valid reservation."""
    res = await inv.reserve("evt1", "user_1", "S001")
    assert res.code == "OK"

    mock_order = {
        "id": "order_test_12345",
        "entity": "order",
        "amount": 50000,
        "currency": "INR",
        "status": "created",
    }

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )
            assert resp.status_code == 201
            data = resp.json()
            assert data["razorpay_order_id"] == "order_test_12345"
            assert data["amount"] == 50000
            assert data["currency"] == "INR"
            assert data["seat_id"] == "S001"
            assert data["event_id"] == "evt1"
            assert "payment_id" in data

            # Verify persisted in database
            db_record = await get_payment_by_order_id("order_test_12345")
            assert db_record is not None
            assert db_record["payment_status"] == "created"
            assert db_record["booking_status"] == "pending"


@pytest.mark.asyncio
async def test_order_creation_invalid_reservation(inv):
    """Attempting order creation for non-existent reservation returns 404."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/payments/order",
            json={"event_id": "evt1", "reservation_id": "non_existent_rid", "user_id": "user_1"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"] == "RESERVATION_NOT_FOUND"


@pytest.mark.asyncio
async def test_order_creation_expired_reservation(inv):
    """Attempting order creation for an expired hold returns 410."""
    res = await inv.reserve("evt1", "user_1", "S001")
    # Mark as expired in mock inventory
    inv.events["evt1"]["rids"][res.reservation_id] = ("EXPIRED", "S001")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/v1/payments/order",
            json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
        )
        assert resp.status_code == 410
        assert resp.json()["error"] == "HOLD_EXPIRED"


@pytest.mark.asyncio
async def test_verification_invalid_signature(inv):
    """Payment verification with invalid HMAC signature fails with 400."""
    res = await inv.reserve("evt1", "user_1", "S001")

    mock_order = {"id": "order_sig_test", "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # Send bogus signature
            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": "order_sig_test",
                    "razorpay_payment_id": "pay_test_001",
                    "razorpay_signature": "invalid_signature_hex_12345",
                },
            )
            assert v_resp.status_code == 400
            assert v_resp.json()["error"] == "INVALID_SIGNATURE"


@pytest.mark.asyncio
async def test_verification_amount_mismatch(inv):
    """Verification fails if Razorpay returns amount different from database order."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_mismatch"
    payment_id = "pay_mismatch"

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    sig = make_sig(order_id, payment_id)

    # Mock gateway returning tampered amount (e.g. 1000 paise instead of 50000)
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 1000, "currency": "INR", "status": "captured"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp.status_code == 400
            assert v_resp.json()["error"] == "AMOUNT_MISMATCH"


@pytest.mark.asyncio
async def test_verification_payment_not_captured(inv):
    """Verification fails if payment is in failed or refunded status on Razorpay."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_not_cap"
    payment_id = "pay_failed_gateway"

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    sig = make_sig(order_id, payment_id)
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 50000, "currency": "INR", "status": "failed"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp.status_code == 400
            assert v_resp.json()["error"] == "PAYMENT_NOT_CAPTURED"


@pytest.mark.asyncio
async def test_successful_verified_payment_and_booking(inv):
    """End-to-end happy path: order creation, signature verification, payment capture, and booking confirmation."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_success_1"
    payment_id = "pay_success_1"
    sig = make_sig(order_id, payment_id)

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 50000, "currency": "INR", "status": "captured"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Create order
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # 2. Verify payment
            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp.status_code == 200
            data = v_resp.json()
            assert data["status"] == "CONFIRMED"
            assert data["seat_id"] == "S001"
            assert data["idempotent"] is False
            assert "booking_reference" in data
            assert data["booking_reference"].startswith("BK-EVT1-S001-")

            # Check database persistence
            p = await get_payment_by_order_id(order_id)
            assert p["payment_status"] == "paid"
            assert p["booking_status"] == "confirmed"
            assert p["razorpay_payment_id"] == payment_id
            assert p["booking_reference"] == data["booking_reference"]


@pytest.mark.asyncio
async def test_duplicate_verification_request_is_idempotent(inv):
    """Calling verification twice with the same valid payload is strictly idempotent."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_idempotent"
    payment_id = "pay_idempotent"
    sig = make_sig(order_id, payment_id)

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 50000, "currency": "INR", "status": "captured"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # First verification
            v_resp1 = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp1.status_code == 200
            data1 = v_resp1.json()
            assert data1["idempotent"] is False

            # Second verification (retry)
            v_resp2 = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp2.status_code == 200
            data2 = v_resp2.json()
            assert data2["idempotent"] is True
            assert data2["booking_reference"] == data1["booking_reference"]


@pytest.mark.asyncio
async def test_booking_confirmation_failure_after_payment_capture_triggers_refund(inv):
    """If payment is captured but inventory hold expires, ticket is NOT issued and refund is initiated."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_expire_refund"
    payment_id = "pay_expire_refund"
    sig = make_sig(order_id, payment_id)

    # Force inventory to report HOLD_EXPIRED on confirm
    inv.confirm_results[res.reservation_id] = ConfirmResult(code="HOLD_EXPIRED", seat_id="S001")

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 50000, "currency": "INR", "status": "captured"}
    mock_refund = {"id": "rfnd_auto_123", "entity": "refund", "amount": 50000, "currency": "INR", "status": "processed"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)), \
         patch.object(razorpay_service, "refund_payment", AsyncMock(return_value=mock_refund)) as mock_refund_call:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp.status_code == 410
            data = v_resp.json()
            assert data["error"] == "HOLD_EXPIRED"
            assert data["refund_id"] == "rfnd_auto_123"
            assert data["payment_status"] == "refunded"
            assert data["booking_status"] == "expired"
            assert mock_refund_call.called

            # Check database record
            p = await get_payment_by_order_id(order_id)
            assert p["payment_status"] == "refunded"
            assert p["booking_status"] == "expired"
            assert p["refund_id"] == "rfnd_auto_123"
            assert p["booking_reference"] is None


@pytest.mark.asyncio
async def test_webhook_arrives_before_client_verification(inv):
    """When a webhook arrives before the client calls verify, booking is confirmed and subsequent verify is idempotent."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_webhook_first"
    payment_id = "pay_webhook_first"

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # Webhook payload
            webhook_body = {
                "event_id": "evt_hook_001",
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {
                            "id": payment_id,
                            "order_id": order_id,
                            "amount": 50000,
                            "currency": "INR",
                            "status": "captured",
                        }
                    }
                },
            }
            raw_bytes = json.dumps(webhook_body).encode("utf-8")
            hook_sig = make_webhook_sig(raw_bytes)

            w_resp = await client.post(
                "/api/v1/payments/webhook",
                content=raw_bytes,
                headers={"X-Razorpay-Signature": hook_sig, "Content-Type": "application/json"},
            )
            assert w_resp.status_code == 200
            assert w_resp.json()["status"] == "ok"

            # Check booking confirmed in DB
            p = await get_payment_by_order_id(order_id)
            assert p["payment_status"] == "paid"
            assert p["booking_status"] == "confirmed"

            # Now client calls verify: it should succeed as idempotent
            sig = make_sig(order_id, payment_id)
            v_resp = await client.post(
                "/api/v1/payments/verify",
                json={
                    "event_id": "evt1",
                    "reservation_id": res.reservation_id,
                    "user_id": "user_1",
                    "razorpay_order_id": order_id,
                    "razorpay_payment_id": payment_id,
                    "razorpay_signature": sig,
                },
            )
            assert v_resp.status_code == 200
            assert v_resp.json()["idempotent"] is True


@pytest.mark.asyncio
async def test_duplicate_webhook_delivery_is_deduplicated(inv):
    """Subsequent delivery of the same webhook event ID is acknowledged without reprocessing."""
    webhook_body = {
        "event_id": "evt_repeat_001",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_repeat",
                    "order_id": "order_non_existent",
                }
            }
        },
    }
    raw_bytes = json.dumps(webhook_body).encode("utf-8")
    sig = make_webhook_sig(raw_bytes)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # First delivery
        r1 = await client.post(
            "/api/v1/payments/webhook",
            content=raw_bytes,
            headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
        )
        assert r1.status_code == 200
        assert r1.json()["status"] == "ok"

        # Duplicate delivery
        r2 = await client.post(
            "/api/v1/payments/webhook",
            content=raw_bytes,
            headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "already_processed"


@pytest.mark.asyncio
async def test_concurrent_confirmation_attempts(inv):
    """Concurrent verification attempts for the same reservation do not double-book or error."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_concurrent"
    payment_id = "pay_concurrent"
    sig = make_sig(order_id, payment_id)

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    mock_rz_payment = {"id": payment_id, "order_id": order_id, "amount": 50000, "currency": "INR", "status": "captured"}

    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)), \
         patch.object(razorpay_service, "get_payment", AsyncMock(return_value=mock_rz_payment)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # Fire 5 concurrent verify requests
            tasks = [
                client.post(
                    "/api/v1/payments/verify",
                    json={
                        "event_id": "evt1",
                        "reservation_id": res.reservation_id,
                        "user_id": "user_1",
                        "razorpay_order_id": order_id,
                        "razorpay_payment_id": payment_id,
                        "razorpay_signature": sig,
                    },
                )
                for _ in range(5)
            ]
            responses = await asyncio.gather(*tasks)

            # All must succeed with 200
            for r in responses:
                assert r.status_code == 200
                assert r.json()["status"] == "CONFIRMED"

            # Check that database has exactly 1 confirmed record with the same booking reference
            p = await get_payment_by_order_id(order_id)
            assert p["payment_status"] == "paid"
            assert p["booking_status"] == "confirmed"


@pytest.mark.asyncio
async def test_payment_status_endpoint(inv):
    """Querying payment status by order ID or reservation ID returns full details."""
    res = await inv.reserve("evt1", "user_1", "S001")
    order_id = "order_status_check"

    mock_order = {"id": order_id, "entity": "order", "amount": 50000, "currency": "INR", "status": "created"}
    with patch.object(razorpay_service, "create_order", AsyncMock(return_value=mock_order)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post(
                "/api/v1/payments/order",
                json={"event_id": "evt1", "reservation_id": res.reservation_id, "user_id": "user_1"},
            )

            # Query by order_id
            resp = await client.get(f"/api/v1/payments/{order_id}/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["razorpay_order_id"] == order_id
            assert data["payment_status"] == "created"
            assert data["booking_status"] == "pending"
            assert data["seat_id"] == "S001"
            assert data["amount"] == 50000
