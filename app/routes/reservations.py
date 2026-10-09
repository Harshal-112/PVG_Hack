"""Reservation routes: reserve, confirm, release. Owned by [P2]."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.metrics import CONFIRM_TOTAL, RESERVE_TOTAL
from app.ratelimit import rate_limiter

router = APIRouter()


class ReserveRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    seat_id: str | None = None


class ReserveResponse(BaseModel):
    reservation_id: str
    seat_id: str
    expires_at_ms: int
    ttl_ms: int


class ConfirmRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class ConfirmResponse(BaseModel):
    status: str
    seat_id: str
    idempotent: bool


class ReleaseResponse(BaseModel):
    status: str
    seat_id: str | None = None


class ErrorResponse(BaseModel):
    error: str
    message: str


@router.post(
    "/events/{event_id}/reserve",
    status_code=201,
    response_model=ReserveResponse,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
    dependencies=[Depends(rate_limiter)],
)
async def reserve_seat(event_id: str, body: ReserveRequest, request: Request):
    """Reserve a seat or any available seat."""
    inventory = request.app.state.inventory
    result = await inventory.reserve(event_id, body.user_id, body.seat_id)

    if result.code == "OK":
        RESERVE_TOTAL.labels(result="ok").inc()
        return JSONResponse(
            status_code=201,
            content={
                "reservation_id": result.reservation_id,
                "seat_id": result.seat_id,
                "expires_at_ms": result.expires_at_ms,
                "ttl_ms": inventory.hold_ttl_ms,
            },
        )
    elif result.code in ("SEAT_HELD", "SEAT_SOLD", "SOLD_OUT"):
        RESERVE_TOTAL.labels(result=result.code.lower()).inc()
        messages = {
            "SEAT_HELD": "Seat is currently held by another reservation",
            "SEAT_SOLD": "Seat has already been sold",
            "SOLD_OUT": "Event is sold out",
        }
        return JSONResponse(
            status_code=409,
            content={"error": result.code, "message": messages.get(result.code, "Reservation conflict")},
        )
    elif result.code == "SEAT_UNKNOWN":
        RESERVE_TOTAL.labels(result="seat_unknown").inc()
        return JSONResponse(
            status_code=404,
            content={"error": "SEAT_UNKNOWN", "message": "Specified seat was not found for this event"},
        )
    else:
        RESERVE_TOTAL.labels(result=result.code.lower()).inc()
        return JSONResponse(
            status_code=400,
            content={"error": result.code, "message": f"Reservation failed: {result.code}"},
        )


@router.post(
    "/events/{event_id}/reservations/{reservation_id}/confirm",
    status_code=200,
    response_model=ConfirmResponse,
    responses={
        404: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
    },
)
async def confirm_reservation(event_id: str, reservation_id: str, body: ConfirmRequest, request: Request):
    """Confirm a held seat."""
    inventory = request.app.state.inventory
    result = await inventory.confirm(event_id, reservation_id, body.user_id)

    if result.code == "OK":
        CONFIRM_TOTAL.labels(result="ok").inc()
        return JSONResponse(
            status_code=200,
            content={
                "status": "CONFIRMED",
                "seat_id": result.seat_id,
                "idempotent": False,
            },
        )
    elif result.code == "ALREADY_CONFIRMED":
        CONFIRM_TOTAL.labels(result="already_confirmed").inc()
        return JSONResponse(
            status_code=200,
            content={
                "status": "CONFIRMED",
                "seat_id": result.seat_id,
                "idempotent": True,
            },
        )
    elif result.code == "HOLD_EXPIRED":
        CONFIRM_TOTAL.labels(result="hold_expired").inc()
        return JSONResponse(
            status_code=410,
            content={"error": "HOLD_EXPIRED", "message": "Reservation hold has expired"},
        )
    elif result.code == "UNKNOWN":
        CONFIRM_TOTAL.labels(result="unknown").inc()
        return JSONResponse(
            status_code=404,
            content={"error": "UNKNOWN", "message": "Reservation not found"},
        )
    else:
        CONFIRM_TOTAL.labels(result=result.code.lower()).inc()
        return JSONResponse(
            status_code=400,
            content={"error": result.code, "message": f"Confirmation failed: {result.code}"},
        )


@router.delete(
    "/events/{event_id}/reservations/{reservation_id}",
    status_code=200,
    response_model=ReleaseResponse,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def release_reservation(event_id: str, reservation_id: str, request: Request):
    """Release a held reservation."""
    inventory = request.app.state.inventory
    result = await inventory.release(event_id, reservation_id)

    if result.code in ("OK", "NOOP"):
        return JSONResponse(
            status_code=200,
            content={
                "status": "RELEASED" if result.code == "OK" else "NOOP",
                "seat_id": result.seat_id,
            },
        )
    elif result.code == "ALREADY_CONFIRMED":
        return JSONResponse(
            status_code=409,
            content={"error": "ALREADY_CONFIRMED", "message": "Reservation has already been confirmed"},
        )
    elif result.code == "UNKNOWN":
        return JSONResponse(
            status_code=404,
            content={"error": "UNKNOWN", "message": "Reservation not found"},
        )
    else:
        return JSONResponse(
            status_code=400,
            content={"error": result.code, "message": f"Release failed: {result.code}"},
        )
