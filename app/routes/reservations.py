"""Reservation routes: reserve, confirm, release. Owned by [P2]."""

import hashlib
import time
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.metrics import CONFIRM_TOTAL, RESERVE_TOTAL
from app.ratelimit import rate_limiter
from app.services.waiting_room import waiting_room_service
from app.services.waitlist import waitlist_service

router = APIRouter()


class ReserveRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    seat_id: str | None = None
    admission_token: str | None = None


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
    if settings.WAITING_ROOM_ENABLED:
        token = request.headers.get("X-Admission-Token") or body.admission_token
        is_admitted = await waiting_room_service.verify_admission_token(event_id, body.user_id, token)
        if not is_admitted:
            return JSONResponse(
                status_code=403,
                content={
                    "error": "QUEUE_ADMISSION_REQUIRED",
                    "message": "High-demand event requires admission through the virtual waiting room",
                },
            )

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
        if result.code == "OK" and result.seat_id:
            try:
                await waitlist_service.process_inventory_release(event_id, result.seat_id)
            except Exception:
                pass
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


class CancelBookingRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


@router.post(
    "/events/{event_id}/reservations/{reservation_id}/cancel",
    status_code=200,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def cancel_reservation(
    event_id: str,
    reservation_id: str,
    body: CancelBookingRequest,
    request: Request,
):
    """Cancel a confirmed booking and immediately trigger atomic waitlist reallocation."""
    inventory = request.app.state.inventory
    result = await inventory.cancel_booking(event_id, reservation_id)

    if result.get("code") == "OK":
        seat_id = result.get("seat_id")
        if seat_id:
            try:
                await waitlist_service.process_inventory_release(event_id, seat_id)
            except Exception:
                pass
        return JSONResponse(
            status_code=200,
            content={
                "status": "CANCELLED",
                "reservation_id": reservation_id,
                "seat_id": seat_id,
                "message": "Booking cancelled and seat submitted for waitlist reallocation",
            },
        )
    elif result.get("code") == "NOT_CONFIRMED":
        return JSONResponse(
            status_code=409,
            content={"error": "NOT_CONFIRMED", "message": "Reservation is not in CONFIRMED state to cancel"},
        )
    elif result.get("code") == "OWNER_MISMATCH":
        return JSONResponse(
            status_code=403,
            content={"error": "OWNER_MISMATCH", "message": "Reservation does not own this seat"},
        )
    else:
        return JSONResponse(
            status_code=404,
            content={"error": "UNKNOWN", "message": "Reservation not found"},
        )


@router.get(
    "/events/{event_id}/reservations/{reservation_id}",
    status_code=200,
    responses={404: {"model": ErrorResponse}},
)
async def get_reservation(event_id: str, reservation_id: str, request: Request):
    """Retrieve authoritative reservation lifecycle metadata and TTL countdown."""
    inventory = request.app.state.inventory
    data = await inventory.get_reservation(event_id, reservation_id)
    if not data:
        return JSONResponse(
            status_code=404,
            content={"error": "UNKNOWN", "message": "Reservation was not found"},
        )
    return JSONResponse(status_code=200, content=data)


@router.get(
    "/events/{event_id}/tickets/{reservation_id}/verify",
    status_code=200,
    responses={404: {"model": ErrorResponse}},
)
async def verify_event_ticket(event_id: str, reservation_id: str, request: Request):
    """Server-side ticket verification validating confirmed booking status."""
    inventory = request.app.state.inventory
    data = await inventory.get_reservation(event_id, reservation_id)

    if not data or data.get("status") != "CONFIRMED":
        return JSONResponse(
            status_code=404,
            content={
                "valid": False,
                "error": "TICKET_INVALID_OR_NOT_CONFIRMED",
                "message": "Ticket is either not found, unconfirmed, or expired.",
            },
        )

    hash_material = f"{event_id}:{reservation_id}:{data['seat_id']}:flashseat_secure"
    verification_code = "TKT-" + hashlib.sha256(hash_material.encode("utf-8")).hexdigest()[:12].upper()

    return JSONResponse(
        status_code=200,
        content={
            "valid": True,
            "event_id": event_id,
            "reservation_id": reservation_id,
            "seat_id": data["seat_id"],
            "status": "CONFIRMED",
            "verification_code": verification_code,
            "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )


@router.get("/tickets/verify", status_code=200)
async def verify_ticket_query(event_id: str, reservation_id: str, request: Request):
    """Convenience endpoint for QR code scanner verification."""
    return await verify_event_ticket(event_id, reservation_id, request)
