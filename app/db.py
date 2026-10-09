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
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM bookings WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM booking_conflicts WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM baseline_bookings WHERE event_id = $1", event_id)
            await conn.execute("DELETE FROM baseline_seats WHERE event_id = $1", event_id)
            try:
                await conn.execute("DELETE FROM waitlist_entries WHERE event_id = $1", event_id)
                await conn.execute("DELETE FROM waitlist_offers WHERE event_id = $1", event_id)
            except Exception:
                pass


async def seed_baseline(event_id: str, seat_ids: list[str]) -> None:
    """Seed baseline_seats table with seat_ids."""
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
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval(
            "SELECT COUNT(*) FROM bookings WHERE event_id = $1",
            event_id,
        )
        return int(val or 0)


async def booked_seats(event_id: str) -> dict[str, str]:
    """Return map of seat_id -> reservation_id from bookings."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT seat_id, reservation_id FROM bookings WHERE event_id = $1",
            event_id,
        )
        return {r["seat_id"]: r["reservation_id"] for r in rows}


async def duplicate_seat_rows(event_id: str) -> int:
    """Count seats with >1 row (always 0 for bookings)."""
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
