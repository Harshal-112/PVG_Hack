"""Unit tests for InventoryService. Owned by [P1].

Covers SPEC.md acceptance checks:
- A5: Every seat is in exactly one of free/held/sold at all times
- A7: Confirm twice with same reservation_id (idempotent retry)
- A8: Hold expiry: reserve with 1s TTL, wait 1.2s, another user reserves same seat succeeds
- A9: Confirm after expiry returns HOLD_EXPIRED
- stats, seat_map, sold_map, release, and token bucket.
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


async def assert_inventory_invariant(redis, event_id: str):
    """Verifies SPEC.md acceptance check A5:

    Every seat of an event is in EXACTLY ONE of: free, owners (held), sold.
    free ∩ held == ∅, free ∩ sold == ∅, held ∩ sold == ∅, free ∪ held ∪ sold == all.
    """
    free = set(await redis.smembers(f"fr:{event_id}:free"))
    held = set(await redis.zrange(f"fr:{event_id}:holds", 0, -1))
    owners = set(await redis.hkeys(f"fr:{event_id}:owners"))
    sold = set(await redis.hkeys(f"fr:{event_id}:sold"))
    all_seats = set(await redis.smembers(f"fr:{event_id}:all"))

    # Owners and holds should match for held seats
    assert held == owners, f"Mismatch between holds ZSET and owners HASH: {held} vs {owners}"

    # Disjoint sets
    assert free.isdisjoint(held), f"free and held overlap: {free & held}"
    assert free.isdisjoint(sold), f"free and sold overlap: {free & sold}"
    assert held.isdisjoint(sold), f"held and sold overlap: {held & sold}"

    # Union covers all seats
    assert (free | held | sold) == all_seats, (
        f"Partition does not equal all seats: "
        f"union={(free | held | sold)}, all={all_seats}"
    )


@pytest.mark.asyncio
async def test_a5_partition_invariant(redis):
    """SPEC.md acceptance check A5:

    Every seat is in exactly one of free/held/sold at all times.
    """
    event_id = "evt_a5_invariant"
    seat_ids = [f"S{i:03d}" for i in range(1, 201)]
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    # 1. After seeding
    await inv.seed_event(event_id, seat_ids)
    await assert_inventory_invariant(redis, event_id)

    # 2. After reserving 50 seats
    reserved = []
    for i in range(50):
        res = await inv.reserve(event_id, f"user-{i}", seat_ids[i])
        assert res.code == "OK"
        reserved.append(res)
    await assert_inventory_invariant(redis, event_id)

    # 3. After confirming 25 seats
    for res in reserved[:25]:
        conf = await inv.confirm(event_id, res.reservation_id, "user-test")
        assert conf.code == "OK"
    await assert_inventory_invariant(redis, event_id)

    # 4. After releasing 10 seats
    for res in reserved[25:35]:
        rel = await inv.release(event_id, res.reservation_id)
        assert rel.code == "OK"
    await assert_inventory_invariant(redis, event_id)

    # Verify counts via stats()
    st = await inv.stats(event_id)
    assert st["total"] == 200
    assert st["free"] == 160
    assert st["held"] == 15
    assert st["sold"] == 25


@pytest.mark.asyncio
async def test_a7_confirm_idempotency(redis):
    """SPEC.md acceptance check A7:

    Confirm twice with the same reservation_id:
    First returns OK, second returns ALREADY_CONFIRMED, stream has only 1 entry.
    """
    event_id = "evt_a7_idempotent"
    seat_id = "S001"
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, [seat_id])
    initial_stream_len = await inv.stream_len()

    res = await inv.reserve(event_id, "u-1", seat_id)
    assert res.code == "OK"

    # First confirm
    conf1 = await inv.confirm(event_id, res.reservation_id, "u-1")
    assert conf1.code == "OK"
    assert conf1.seat_id == seat_id

    # Second confirm with the same reservation_id (idempotent retry)
    conf2 = await inv.confirm(event_id, res.reservation_id, "u-1")
    assert conf2.code == "ALREADY_CONFIRMED"
    assert conf2.seat_id == seat_id

    # Only 1 entry was added to the bookings stream
    current_stream_len = await inv.stream_len()
    assert current_stream_len == initial_stream_len + 1


@pytest.mark.asyncio
async def test_a8_hold_expiry_reaping(redis):
    """SPEC.md acceptance check A8:

    Hold expiry: reserve with 1 s TTL, wait 1.2 s, another user reserves same seat succeeds.
    """
    event_id = "evt_a8_expiry"
    seat_id = "S001"
    # 1 second TTL
    inv = InventoryService(redis, hold_ttl_ms=1000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, [seat_id])

    res1 = await inv.reserve(event_id, "user-1", seat_id)
    assert res1.code == "OK"

    # Wait for the hold to expire
    await asyncio.sleep(1.2)

    # Another user reserves the exact same seat
    res2 = await inv.reserve(event_id, "user-2", seat_id)
    assert res2.code == "OK"
    assert res2.seat_id == seat_id
    assert res2.reservation_id != res1.reservation_id


@pytest.mark.asyncio
async def test_a9_confirm_after_expiry(redis):
    """SPEC.md acceptance check A9:

    Confirm after expiry: returns HOLD_EXPIRED.
    """
    event_id = "evt_a9_confirm_expired"
    seat_id = "S001"
    # 1 second TTL
    inv = InventoryService(redis, hold_ttl_ms=1000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, [seat_id])

    res = await inv.reserve(event_id, "user-1", seat_id)
    assert res.code == "OK"

    # Wait for hold to expire
    await asyncio.sleep(1.2)

    # Attempt to confirm after expiry
    conf = await inv.confirm(event_id, res.reservation_id, "user-1")
    assert conf.code == "HOLD_EXPIRED"
    assert conf.seat_id == seat_id


@pytest.mark.asyncio
async def test_release_semantics(redis):
    """Tests release() return codes and transitions."""
    event_id = "evt_release"
    seat_id = "S001"
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, [seat_id])

    # 1. Release unknown rid
    rel_unknown = await inv.release(event_id, "nonexistent-rid")
    assert rel_unknown.code == "UNKNOWN"

    # 2. Reserve and release
    res = await inv.reserve(event_id, "user-1", seat_id)
    assert res.code == "OK"

    rel1 = await inv.release(event_id, res.reservation_id)
    assert rel1.code == "OK"
    assert rel1.seat_id == seat_id

    # 3. Release again -> NOOP
    rel2 = await inv.release(event_id, res.reservation_id)
    assert rel2.code == "NOOP"

    # 4. Release after confirmation -> ALREADY_CONFIRMED
    res2 = await inv.reserve(event_id, "user-2", seat_id)
    await inv.confirm(event_id, res2.reservation_id, "user-2")

    rel_conf = await inv.release(event_id, res2.reservation_id)
    assert rel_conf.code == "ALREADY_CONFIRMED"


@pytest.mark.asyncio
async def test_seat_map_and_sold_map(redis):
    """Tests seat_map and sold_map implementations."""
    event_id = "evt_maps"
    seat_ids = ["S001", "S002", "S003"]
    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=20, rl_refill_per_sec=10)

    await inv.seed_event(event_id, seat_ids)

    # Reserve S001 and confirm it
    r1 = await inv.reserve(event_id, "u-1", "S001")
    await inv.confirm(event_id, r1.reservation_id, "u-1")

    # Reserve S002 (held)
    await inv.reserve(event_id, "u-2", "S002")

    # S003 remains free

    s_map = await inv.seat_map(event_id)
    assert s_map == {
        "S001": "SOLD",
        "S002": "HELD",
        "S003": "FREE",
    }

    sold_m = await inv.sold_map(event_id)
    assert sold_m == {"S001": r1.reservation_id}


@pytest.mark.asyncio
async def test_token_bucket(redis):
    """Tests token bucket allow_request functionality."""
    client_key = "test_user_tb"
    await redis.delete(f"fr:rl:{client_key}")

    inv = InventoryService(redis, hold_ttl_ms=60000, rl_capacity=5, rl_refill_per_sec=10)

    # Consume all 5 tokens
    for i in range(5):
        allowed, tokens = await inv.allow_request(client_key)
        assert allowed is True
        assert tokens == 4 - i

    # 6th request is denied
    allowed, tokens = await inv.allow_request(client_key)
    assert allowed is False
    assert tokens == 0
