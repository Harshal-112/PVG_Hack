"""Database connection pool and query helpers using asyncpg. Owned by [P3]."""


async def init_pool() -> None:
    """Creates pool (PG_POOL_MAX) and runs schema.sql."""
    raise NotImplementedError


async def close_pool() -> None:
    """Closes asyncpg connection pools."""
    raise NotImplementedError


async def reset_event(event_id: str) -> None:
    """Delete bookings and baseline rows for event."""
    raise NotImplementedError


async def seed_baseline(event_id: str, seat_ids: list[str]) -> None:
    """Seed baseline_seats table with seat_ids."""
    raise NotImplementedError


async def count_bookings(event_id: str) -> int:
    """Count persisted bookings in bookings table for event."""
    raise NotImplementedError


async def booked_seats(event_id: str) -> dict[str, str]:
    """Return map of seat_id -> reservation_id from bookings."""
    raise NotImplementedError


async def duplicate_seat_rows(event_id: str) -> int:
    """Count seats with >1 row (always 0 for bookings)."""
    raise NotImplementedError
