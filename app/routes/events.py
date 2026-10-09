"""Event routes: stats, seats, verify. Owned by [P2]."""

import asyncio
import time
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import settings
from app import db

router = APIRouter()


class StatsResponse(BaseModel):
    event_id: str
    total: int
    free: int
    held: int
    sold: int
    persisted: int
    backlog: int
    hold_ttl_ms: int


class SeatsResponse(BaseModel):
    seats: dict[str, str]


class VerifyResponse(BaseModel):
    event_id: str
    redis_sold: int
    pg_bookings: int
    drained: bool
    duplicate_seat_rows: int
    missing_in_pg: list[str]
    extra_in_pg: list[str]
    consistent: bool
    no_double_booking: bool


@router.get("/events/{event_id}/stats", response_model=StatsResponse)
async def get_stats(event_id: str, request: Request):
    """Get real-time statistics for an event."""
    inventory = request.app.state.inventory
    st = await inventory.stats(event_id)

    try:
        persisted = await db.count_bookings(event_id)
    except NotImplementedError:
        persisted = 0

    sold = st.get("sold", 0)
    backlog = max(0, sold - persisted)

    return JSONResponse(
        status_code=200,
        content={
            "event_id": event_id,
            "total": st.get("total", 0),
            "free": st.get("free", 0),
            "held": st.get("held", 0),
            "sold": sold,
            "persisted": persisted,
            "backlog": backlog,
            "hold_ttl_ms": st.get("hold_ttl_ms", inventory.hold_ttl_ms),
        },
    )


@router.get("/events/{event_id}/seats", response_model=SeatsResponse)
async def get_seats(event_id: str, request: Request):
    """Get the current seat status map for an event."""
    inventory = request.app.state.inventory
    seats = await inventory.seat_map(event_id)
    return JSONResponse(
        status_code=200,
        content={"seats": seats},
    )


@router.get("/events/{event_id}/verify", response_model=VerifyResponse)
async def verify_event(event_id: str, request: Request):
    """Verify consistency between Redis and Postgres for an event."""
    inventory = request.app.state.inventory

    # Poll stats until backlog == 0 or 5 seconds pass
    start_time = time.monotonic()
    while time.monotonic() - start_time < 5.0:
        st = await inventory.stats(event_id)
        try:
            persisted = await db.count_bookings(event_id)
        except NotImplementedError:
            persisted = 0
        sold = st.get("sold", 0)
        if sold - persisted <= 0:
            break
        await asyncio.sleep(0.05)

    redis_sold_map = await inventory.sold_map(event_id)
    try:
        pg_booked_map = await db.booked_seats(event_id)
    except NotImplementedError:
        pg_booked_map = {}
    try:
        duplicate_rows = await db.duplicate_seat_rows(event_id)
    except NotImplementedError:
        duplicate_rows = 0

    st = await inventory.stats(event_id)

    redis_sold_count = len(redis_sold_map)
    pg_bookings_count = len(pg_booked_map)
    drained = (redis_sold_count == pg_bookings_count)

    missing_in_pg = sorted([
        seat for seat, rid in redis_sold_map.items()
        if seat not in pg_booked_map or pg_booked_map[seat] != rid
    ])
    extra_in_pg = sorted([
        seat for seat, rid in pg_booked_map.items()
        if seat not in redis_sold_map or redis_sold_map[seat] != rid
    ])

    consistent = (
        drained
        and len(missing_in_pg) == 0
        and len(extra_in_pg) == 0
        and duplicate_rows == 0
    )

    total = st.get("total", settings.DEFAULT_SEAT_COUNT)
    no_double_booking = (duplicate_rows == 0 and pg_bookings_count <= total)

    return JSONResponse(
        status_code=200,
        content={
            "event_id": event_id,
            "redis_sold": redis_sold_count,
            "pg_bookings": pg_bookings_count,
            "drained": drained,
            "duplicate_seat_rows": duplicate_rows,
            "missing_in_pg": missing_in_pg,
            "extra_in_pg": extra_in_pg,
            "consistent": consistent,
            "no_double_booking": no_double_booking,
        },
    )
