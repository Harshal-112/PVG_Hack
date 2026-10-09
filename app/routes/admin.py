"""Admin routes: create and reset events. Owned by [P2]."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class CreateEventRequest(BaseModel):
    event_id: str
    seat_count: int


@router.post("/admin/events")
async def create_event(body: CreateEventRequest):
    """Seed Redis, clear Postgres rows for the event, seed baseline seats."""
    raise NotImplementedError


@router.post("/admin/events/{event_id}/reset")
async def reset_event(event_id: str):
    """Reset event with existing seat count."""
    raise NotImplementedError
