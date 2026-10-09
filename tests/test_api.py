"""API Integration Tests for FlashSeat (Owned by P4).

Tests SPEC.md rows:
- A7: Confirm twice with the same reservation_id -> 200 both times, second has idempotent=True, ONE row in Postgres.
- A8: Hold expiry: reserve with short TTL (1 s), wait > TTL (1.2 s), another user reserves same seat -> succeeds.
- A9: Confirm after expiry -> 410 HOLD_EXPIRED.

How to run against a running stack:
  pytest tests/test_api.py

Environment variables:
  BASE_URL: Target service base URL (default: http://localhost:8000)
  HOLD_TTL_MS: Hold TTL in ms. Note: For test_a8_hold_expiry and test_a9_confirm_after_expiry,
               either set HOLD_TTL_MS=1000 when starting the server or pass ?ttl_ms=1000 on reserve.
"""

import os
import time
import pytest
import httpx

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000").rstrip("/")
EVENT_ID = "test_evt_p4"


@pytest.fixture(autouse=True)
def seed_test_event():
    """Ensure clean test event before each test."""
    with httpx.Client(base_url=BASE_URL, timeout=5.0) as client:
        resp = client.post("/api/v1/admin/events", json={"event_id": EVENT_ID, "seat_count": 50})
        assert resp.status_code in (200, 201), f"Seed failed: {resp.text}"


def test_a7_confirm_idempotency():
    """SPEC.md Row A7: Confirm twice with the same reservation_id.

    Expected: 200 both times, second call returns idempotent=True.
    """
    with httpx.Client(base_url=BASE_URL, timeout=5.0) as client:
        # Reserve a seat
        reserve_resp = client.post(f"/api/v1/events/{EVENT_ID}/reserve", json={"user_id": "u-a7", "seat_id": "S001"})
        assert reserve_resp.status_code == 201, f"Reserve failed: {reserve_resp.text}"
        data = reserve_resp.json()
        rid = data["reservation_id"]
        seat_id = data["seat_id"]

        # First confirm
        confirm1 = client.post(f"/api/v1/events/{EVENT_ID}/reservations/{rid}/confirm", json={"user_id": "u-a7"})
        assert confirm1.status_code == 200, f"First confirm failed: {confirm1.text}"
        c1_data = confirm1.json()
        assert c1_data["status"] == "CONFIRMED"
        assert c1_data["seat_id"] == seat_id
        assert c1_data.get("idempotent") is False

        # Second confirm (same rid)
        confirm2 = client.post(f"/api/v1/events/{EVENT_ID}/reservations/{rid}/confirm", json={"user_id": "u-a7"})
        assert confirm2.status_code == 200, f"Second confirm failed: {confirm2.text}"
        c2_data = confirm2.json()
        assert c2_data["status"] == "CONFIRMED"
        assert c2_data["seat_id"] == seat_id
        assert c2_data.get("idempotent") is True


def test_a8_hold_expiry_rebooking():
    """SPEC.md Row A8: Hold expiry.

    Reserve with 1s TTL (via ?ttl_ms=1000 or HOLD_TTL_MS=1000), wait 1.2s, another user reserves same seat.
    Expected: Second user reservation succeeds.
    """
    with httpx.Client(base_url=BASE_URL, timeout=5.0) as client:
        # Reserve seat S002 with 1000ms TTL
        res1 = client.post(f"/api/v1/events/{EVENT_ID}/reserve?ttl_ms=1000", json={"user_id": "u-a8-1", "seat_id": "S002"})
        assert res1.status_code == 201, f"Initial reserve failed: {res1.text}"

        # Wait 1.2 seconds to allow hold to expire
        time.sleep(1.2)

        # Second user attempts to reserve the same seat S002
        res2 = client.post(f"/api/v1/events/{EVENT_ID}/reserve?ttl_ms=1000", json={"user_id": "u-a8-2", "seat_id": "S002"})
        assert res2.status_code == 201, f"Re-booking after expiry failed: {res2.text}"
        assert res2.json()["seat_id"] == "S002"


def test_a9_confirm_after_expiry():
    """SPEC.md Row A9: Confirm after expiry.

    Reserve with 1s TTL, wait 1.2s, attempt to confirm.
    Expected: 410 HOLD_EXPIRED.
    """
    with httpx.Client(base_url=BASE_URL, timeout=5.0) as client:
        # Reserve seat S003 with 1000ms TTL
        res = client.post(f"/api/v1/events/{EVENT_ID}/reserve?ttl_ms=1000", json={"user_id": "u-a9", "seat_id": "S003"})
        assert res.status_code == 201, f"Reserve failed: {res.text}"
        rid = res.json()["reservation_id"]

        # Wait 1.2 seconds for hold to expire
        time.sleep(1.2)

        # Attempt to confirm expired reservation
        confirm_resp = client.post(f"/api/v1/events/{EVENT_ID}/reservations/{rid}/confirm", json={"user_id": "u-a9"})
        assert confirm_resp.status_code == 410, f"Expected 410 HOLD_EXPIRED, got {confirm_resp.status_code}: {confirm_resp.text}"
        err_data = confirm_resp.json()
        assert err_data.get("error") == "HOLD_EXPIRED"
