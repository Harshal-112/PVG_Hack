"""Database connection pool and query helpers using asyncpg. Owned by [P3]."""

from pathlib import Path
import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None
_baseline_pool: asyncpg.Pool | None = None


def get_pool() -> asyncpg.Pool:
    """Return the main asyncpg connection pool."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_pool() first.")
    return _pool


def get_baseline_pool() -> asyncpg.Pool:
    """Return the separate baseline connection pool."""
    if _baseline_pool is None:
        raise RuntimeError("Baseline database pool not initialized. Call init_pool() first.")
    return _baseline_pool


async def init_pool() -> None:
    """Creates pool (PG_POOL_MAX) and runs schema.sql. Also creates baseline pool (BASELINE_POOL_MAX)."""
    global _pool, _baseline_pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.DATABASE_URL,
            min_size=1,
            max_size=settings.PG_POOL_MAX,
        )
    if _baseline_pool is None:
        _baseline_pool = await asyncpg.create_pool(
            dsn=settings.DATABASE_URL,
            min_size=1,
            max_size=settings.BASELINE_POOL_MAX,
        )

    schema_file = Path(__file__).parent / "schema.sql"
    if schema_file.exists():
        schema_sql = schema_file.read_text(encoding="utf-8")
        async with _pool.acquire() as conn:
            await conn.execute(schema_sql)


async def close_pool() -> None:
    """Closes asyncpg connection pools."""
    global _pool, _baseline_pool
    if _pool is not None:
        await _pool.close()
        _pool = None
    if _baseline_pool is not None:
        await _baseline_pool.close()
        _baseline_pool = None


async def reset_event(event_id: str) -> None:
    """Delete bookings and baseline rows for event."""
    if _pool is None:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM bookings WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM booking_conflicts WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM baseline_bookings WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM baseline_seats WHERE event_id = $1", event_id)


async def seed_baseline(event_id: str, seat_ids: list[str]) -> None:
    """Seed baseline_seats table with seat_ids."""
    if _pool is None:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM baseline_seats WHERE event_id = $1", event_id)
            if seat_ids:
                records = [(event_id, seat_id) for seat_id in seat_ids]
                await conn.executemany(
                    "INSERT INTO baseline_seats (event_id, seat_id, booked_by) VALUES ($1, $2, NULL)",
                    records,
                )


async def count_bookings(event_id: str) -> int:
    """Count persisted bookings in bookings table for event."""
    if _pool is None:
        return 0
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT COUNT(*) FROM bookings WHERE event_id = $1",
            event_id,
        )
        return int(val or 0)


async def booked_seats(event_id: str) -> dict[str, str]:
    """Return map of seat_id -> reservation_id from bookings."""
    if _pool is None:
        return {}
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT seat_id, reservation_id FROM bookings WHERE event_id = $1",
            event_id,
        )
        return {r["seat_id"]: r["reservation_id"] for r in rows}



async def duplicate_seat_rows(event_id: str) -> int:
    """Count seats with >1 row (always 0 for bookings)."""
    if _pool is None:
        return 0
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            """
            SELECT COUNT(*) FROM (
                SELECT seat_id FROM bookings
                WHERE event_id = $1
                GROUP BY seat_id
                HAVING COUNT(*) > 1
            ) sub
            """,
            event_id,
        )
        return int(val or 0)


# In-memory store fallback when PostgreSQL pool is not initialized (e.g., during unit tests)
_mem_payments: dict[str, dict] = {}       # keyed by order_id
_mem_webhooks: dict[str, dict] = {}       # keyed by event_id


async def create_payment_record(data: dict) -> dict:
    """Persist a new payment record."""
    if _pool is None:
        order_id = data["razorpay_order_id"]
        record = dict(data)
        record.setdefault("id", len(_mem_payments) + 1)
        record.setdefault("payment_status", "created")
        record.setdefault("booking_status", "pending")
        record.setdefault("booking_reference", None)
        record.setdefault("razorpay_payment_id", None)
        record.setdefault("refund_id", None)
        record.setdefault("error_code", None)
        record.setdefault("error_description", None)
        _mem_payments[order_id] = record
        return record

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO payments (
                payment_id_internal, reservation_id, event_id, seat_id, user_id,
                razorpay_order_id, razorpay_payment_id, amount, currency,
                payment_status, booking_status, booking_reference
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
            """,
            data["payment_id_internal"],
            data["reservation_id"],
            data["event_id"],
            data["seat_id"],
            data["user_id"],
            data["razorpay_order_id"],
            data.get("razorpay_payment_id"),
            data["amount"],
            data.get("currency", "INR"),
            data.get("payment_status", "created"),
            data.get("booking_status", "pending"),
            data.get("booking_reference"),
        )
        return dict(row)


async def get_payment_by_order_id(order_id: str) -> dict | None:
    """Fetch payment record by Razorpay order_id."""
    if _pool is None:
        return _mem_payments.get(order_id)
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM payments WHERE razorpay_order_id = $1", order_id)
        return dict(row) if row else None


async def get_payment_by_reservation_id(reservation_id: str) -> dict | None:
    """Fetch payment record by reservation_id."""
    if _pool is None:
        for p in _mem_payments.values():
            if p.get("reservation_id") == reservation_id:
                return p
        return None
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM payments WHERE reservation_id = $1", reservation_id)
        return dict(row) if row else None


async def get_payment_by_id(payment_id_internal: str) -> dict | None:
    """Fetch payment record by internal payment_id."""
    if _pool is None:
        for p in _mem_payments.values():
            if p.get("payment_id_internal") == payment_id_internal:
                return p
        return None
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM payments WHERE payment_id_internal = $1", payment_id_internal)
        return dict(row) if row else None


async def get_payment_by_razorpay_payment_id(payment_id: str) -> dict | None:
    """Fetch payment record by Razorpay payment_id."""
    if _pool is None:
        for p in _mem_payments.values():
            if p.get("razorpay_payment_id") == payment_id:
                return p
        return None
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM payments WHERE razorpay_payment_id = $1", payment_id)
        return dict(row) if row else None


async def update_payment_record(order_id: str, **updates) -> dict | None:
    """Update fields of an existing payment record transactionally."""
    if _pool is None:
        record = _mem_payments.get(order_id)
        if record:
            record.update(updates)
            return dict(record)
        return None

    if not updates:
        return await get_payment_by_order_id(order_id)

    set_clauses = []
    args = []
    idx = 1
    for key, val in updates.items():
        set_clauses.append(f"{key} = ${idx}")
        args.append(val)
        idx += 1

    set_clauses.append(f"updated_at = now()")
    args.append(order_id)
    where_idx = idx

    query = f"""
        UPDATE payments
        SET {', '.join(set_clauses)}
        WHERE razorpay_order_id = ${where_idx}
        RETURNING *
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, *args)
        return dict(row) if row else None


async def record_webhook_event(event_id: str, event_type: str, payload: str) -> bool:
    """Record an incoming webhook event. Returns True if newly recorded, False if duplicate."""
    if _pool is None:
        if event_id in _mem_webhooks:
            return False
        _mem_webhooks[event_id] = {"event_id": event_id, "event_type": event_type, "payload": payload}
        return True

    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            """
            INSERT INTO webhook_events (event_id, event_type, payload)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            event_id,
            event_type,
            payload,
        )
        return bool(val)


async def is_webhook_event_processed(event_id: str) -> bool:
    """Check if webhook event has already been recorded."""
    if _pool is None:
        return event_id in _mem_webhooks
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval("SELECT 1 FROM webhook_events WHERE event_id = $1", event_id)
        return bool(val)

