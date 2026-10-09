"""Admin routes: create and reset events. Owned by [P2]."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app import db
from app.services.waiting_room import waiting_room_service
from app.services.waitlist import waitlist_service

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
    except (NotImplementedError, RuntimeError):
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
    except (NotImplementedError, RuntimeError):
        pass
    try:
        await waitlist_service.reset(event_id)
    except Exception:
        pass

    return JSONResponse(
        status_code=200,
        content={"event_id": event_id, "seat_count": seat_count},
    )


@router.get("/admin/overview", status_code=200)
async def admin_overview(request: Request, event_id: str = "evt1", admin_key: str | None = None):
    """Operations and Telemetry Dashboard with authentication protection."""
    header_key = request.headers.get("X-Admin-Key")
    provided_key = header_key or admin_key or request.query_params.get("admin_key")
    if not provided_key or provided_key != settings.ADMIN_SECRET_KEY:
        return JSONResponse(
            status_code=401,
            content={
                "error": "UNAUTHORIZED",
                "message": "Admin authorization key is required via X-Admin-Key header or admin_key query parameter.",
            },
        )

    import time
    from app.metrics import CONFIRM_TOTAL, RESERVE_TOTAL

    inventory = getattr(request.app.state, "inventory", None)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    st = {}
    if inventory:
        try:
            st = await inventory.stats(event_id)
        except Exception:
            pass

    total_seats = st.get("total", settings.DEFAULT_SEAT_COUNT)
    free_seats = st.get("free", total_seats)
    held_seats = st.get("held", 0)
    sold_seats = st.get("sold", 0)

    try:
        persisted_bookings = await db.count_bookings(event_id)
    except (NotImplementedError, RuntimeError):
        persisted_bookings = 0

    backlog = max(0, sold_seats - persisted_bookings)

    stream_len = 0
    if inventory:
        try:
            stream_len = await inventory.stream_len()
        except Exception:
            pass

    reserve_metrics = {}
    confirm_metrics = {}
    try:
        for metric in RESERVE_TOTAL.collect():
            for sample in metric.samples:
                result_lbl = sample.labels.get("result", "unknown")
                reserve_metrics[result_lbl] = sample.value
    except Exception:
        pass

    try:
        for metric in CONFIRM_TOTAL.collect():
            for sample in metric.samples:
                result_lbl = sample.labels.get("result", "unknown")
                confirm_metrics[result_lbl] = sample.value
    except Exception:
        pass

    wr_stats = {}
    try:
        wr_stats = await waiting_room_service.get_stats(event_id)
    except Exception:
        wr_stats = {
            "enabled": settings.WAITING_ROOM_ENABLED,
            "max_admitted": settings.WAITING_ROOM_MAX_ADMITTED,
        }

    wl_stats = {}
    try:
        wl_stats = await waitlist_service.get_stats(event_id)
    except Exception:
        wl_stats = {"enabled": settings.WAITLIST_ENABLED}

    return JSONResponse(
        status_code=200,
        content={
            "refreshed_at": now_iso,
            "event_id": event_id,
            "inventory": {
                "total": total_seats,
                "free": free_seats,
                "held": held_seats,
                "sold": sold_seats,
                "hold_ttl_ms": st.get("hold_ttl_ms", settings.HOLD_TTL_MS),
            },
            "persistence": {
                "persisted_bookings": persisted_bookings,
                "backlog": backlog,
                "stream_len": stream_len,
                "worker_status": "HEALTHY" if backlog == 0 or stream_len > 0 else "IDLE",
                "consistent": (sold_seats == persisted_bookings and backlog == 0),
            },
            "telemetry": {
                "reserves": reserve_metrics,
                "confirms": confirm_metrics,
                "rate_limiting": {
                    "enabled": settings.RL_ENABLED,
                    "capacity": settings.RL_CAPACITY,
                    "refill_per_sec": settings.RL_REFILL_PER_SEC,
                },
                "waiting_room": wr_stats,
                "waitlist": wl_stats,
            },
        },
    )
