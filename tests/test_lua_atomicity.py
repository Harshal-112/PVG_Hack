"""Atomicity and concurrency tests for Lua scripts. Owned by [P1].

Covers SPEC.md acceptance check A6:
- 1,000 concurrent reserves on the SAME seat with asyncio.gather:
  exactly 1 OK, 999 conflicts.
- High-concurrency SPOP (any seat) reservations.
- Token bucket concurrency.
"""

import asyncio
import os
import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from app.config import settings
from app.services.inventory import InventoryService


async def get_test_redis():
    url = os.getenv("REDIS_URL", settings.REDIS_URL)
    try:
        r = aioredis.from_url(url, decode_responses=True, max_connections=2000)
        await r.ping()
        return r
    except Exception:
        url = "redis://127.0.0.1:6379/0"
        r = aioredis.from_url(url, decode_responses=True, max_connections=2000)
        await r.ping()
        return r


@pytest_asyncio.fixture
async def redis():
    r = await get_test_redis()
    yield r
    await r.aclose()


@pytest.mark.asyncio
async def test_a6_1000_concurrent_reserves_same_seat(redis):
    """SPEC.md acceptance check A6:

    1,000 concurrent reserve on the SAME seat (pytest, asyncio.gather)
    Expects exactly 1 OK, 999 conflicts.
    """
    event_id = "evt_a6_atomicity"
    seat_id = "S001"
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    # Seed the event with a single seat
    await inv.seed_event(event_id, [seat_id])

    # 1,000 concurrent reservations targeting the exact same seat
    tasks = [
        inv.reserve(event_id, user_id=f"user-{i}", seat_id=seat_id)
        for i in range(1000)
    ]
    results = await asyncio.gather(*tasks)

    assert len(results) == 1000

    ok_list = [r for r in results if r.code == "OK"]
    held_list = [r for r in results if r.code == "SEAT_HELD"]
    other_list = [r for r in results if r.code not in ("OK", "SEAT_HELD")]

    assert len(ok_list) == 1, f"Expected exactly 1 OK, got {len(ok_list)}"
    assert len(held_list) == 999, f"Expected exactly 999 SEAT_HELD, got {len(held_list)}"
    assert len(other_list) == 0, f"Unexpected return codes: {[r.code for r in other_list]}"

    winning_res = ok_list[0]
    assert winning_res.seat_id == seat_id
    assert winning_res.reservation_id is not None
    assert winning_res.expires_at_ms is not None

    # Verify Redis internal state
    owner = await redis.hget(f"fr:{event_id}:owners", seat_id)
    assert owner == winning_res.reservation_id

    free_count = await redis.scard(f"fr:{event_id}:free")
    assert free_count == 0

    hold_score = await redis.zscore(f"fr:{event_id}:holds", seat_id)
    assert hold_score == winning_res.expires_at_ms


@pytest.mark.asyncio
async def test_concurrent_spop_any_seat(redis):
    """High contention test for 'any seat' reserve (seat_id=None).

    100 seats, 300 concurrent requests: exactly 100 OK with distinct seats,
    200 SOLD_OUT.
    """
    event_id = "evt_spop_concurrency"
    seat_count = 100
    seat_ids = [f"S{i:03d}" for i in range(1, seat_count + 1)]
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, seat_ids)

    tasks = [
        inv.reserve(event_id, user_id=f"u-{i}", seat_id=None)
        for i in range(300)
    ]
    results = await asyncio.gather(*tasks)

    ok_list = [r for r in results if r.code == "OK"]
    sold_out_list = [r for r in results if r.code == "SOLD_OUT"]

    assert len(ok_list) == 100
    assert len(sold_out_list) == 200

    assigned_seats = {r.seat_id for r in ok_list}
    assert len(assigned_seats) == 100
    assert assigned_seats == set(seat_ids)


@pytest.mark.asyncio
async def test_token_bucket_concurrency(redis):
    """Token bucket concurrent requests test.

    Burst concurrency: with refill rate of 1 token/sec, 50 instant concurrent
    requests against capacity 20 should result in exactly 20 allowed and 30 rejected.
    """
    client_key = "test_tb_client_concurrent"
    await redis.delete(f"fr:rl:{client_key}")

    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=1)

    # 50 concurrent requests against capacity 20
    tasks = [inv.allow_request(client_key) for _ in range(50)]
    results = await asyncio.gather(*tasks)

    allowed_count = sum(1 for allowed, _ in results if allowed)
    rejected_count = sum(1 for allowed, _ in results if not allowed)

    assert allowed_count == 20
    assert rejected_count == 30
