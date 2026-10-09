"""Event routes: stats, seats, verify. Owned by [P2]."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/events/{event_id}/stats")
async def get_stats(event_id: str):
    """Get real-time statistics for an event."""
    raise NotImplementedError


@router.get("/events/{event_id}/seats")
async def get_seats(event_id: str):
    """Get the current seat status map for an event."""
    raise NotImplementedError


@router.get("/events/{event_id}/verify")
async def verify_event(event_id: str):
    """Verify consistency between Redis and Postgres for an event."""
    raise NotImplementedError
