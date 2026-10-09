"""Admin routes: create and reset events. Owned by [P2]."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app import db

router = APIRouter()


class CreateEventRequest(BaseModel):
    event_id: str = Field(..., min_length=1)
    seat_count: int = Field(..., gt=0)


class EventResponse(BaseModel):
    event_id: str
    seat_count: int


@router.post("/admin/events", status_code=201, response_model=EventResponse)
async def create_event(body: CreateEventRequest, request: Request):
    """Seed Redis, clear Postgres rows for the event, seed baseline seats."""
    inventory = request.app.state.inventory
    seat_ids = [f"S{i:03d}" for i in range(1, body.seat_count + 1)]

    await inventory.seed_event(body.event_id, seat_ids)
    try:
        await db.reset_event(body.event_id)
        await db.seed_baseline(body.event_id, seat_ids)
    except NotImplementedError:
        pass

    return JSONResponse(
        status_code=201,
        content={"event_id": body.event_id, "seat_count": body.seat_count},
    )


@router.post("/admin/events/{event_id}/reset", status_code=200, response_model=EventResponse)
async def reset_event(event_id: str, request: Request):
    """Reset event with existing seat count."""
    inventory = request.app.state.inventory

    st = await inventory.stats(event_id)
    seat_count = st.get("total") or settings.DEFAULT_SEAT_COUNT
    seat_ids = [f"S{i:03d}" for i in range(1, seat_count + 1)]

    await inventory.seed_event(event_id, seat_ids)
    try:
        await db.reset_event(event_id)
        await db.seed_baseline(event_id, seat_ids)
    except NotImplementedError:
        pass

    return JSONResponse(
        status_code=200,
        content={"event_id": event_id, "seat_count": seat_count},
    )
