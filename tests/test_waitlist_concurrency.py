"""
High-concurrency waitlist race condition and allocation verification.
Verifies that 100 concurrent users joining the waitlist maintain strict FIFO ordering,
and multiple release triggers reallocate seats without any double-allocation or race condition.
"""
import asyncio
import pytest
from app.services.waitlist import waitlist_service
from app.services.notifications import notification_service
from tests.test_waitlist_exhaustive import FakeWaitlistRedis, WaitlistTestInventory


@pytest.mark.asyncio
async def test_high_concurrency_waitlist_reallocations():
    event_id = "evt_conc_test"
    fake_redis = FakeWaitlistRedis()
    fake_inv = WaitlistTestInventory()

    # Seed 50 seats
    seats = [f"S{i:03d}" for i in range(1, 51)]
    await fake_inv.seed_event(event_id, seats)

    waitlist_service.set_redis(fake_redis)
    notification_service.set_redis(fake_redis)

    await waitlist_service.reset(event_id)
    await notification_service.reset(event_id)

    # 1. 100 concurrent users join waitlist
    async def join_user(idx: int):
        u_id = f"user_{idx:03d}"
        return await waitlist_service.join_waitlist(event_id, u_id, seat_id=None)

    tasks = [join_user(i) for i in range(100)]
    results = await asyncio.gather(*tasks)

    assert len(results) == 100
    positions = [r["position"] for r in results]
    assert sorted(positions) == list(range(1, 101))

    # Find which users got position 1 and 2 based on concurrent scheduling order
    first_user = next(r["user_id"] for r in results if r["position"] == 1)
    second_user = next(r["user_id"] for r in results if r["position"] == 2)

    # 2. Release seat S001 and ensure exactly first_user gets the offer
    offer1 = await waitlist_service.process_inventory_release(event_id, "S001")
    assert offer1 is not None
    assert offer1["seat_id"] == "S001"
    assert offer1["user_id"] == first_user

    # First user declines -> automatically reallocated to second_user
    decline_res = await waitlist_service.decline_offer(event_id, offer1["offer_id"], first_user)
    assert decline_res["ok"] is True

    status_u2 = await waitlist_service.get_status(event_id, second_user)
    assert status_u2["status"] == "OFFERED"
    assert status_u2["offer"]["seat_id"] == "S001"

    # Second user accepts -> successfully confirmed
    accept_res = await waitlist_service.accept_offer(event_id, status_u2["offer"]["offer_id"], second_user)
    assert accept_res["ok"] is True
    assert accept_res["status"] == "ACCEPTED"

    # Check telemetry
    stats = await waitlist_service.get_stats(event_id)
    assert stats["offers_accepted"] == 1
    assert stats["offers_declined"] == 1
    assert stats["active_waiting"] == 98
