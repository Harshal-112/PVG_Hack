"""Reservation routes: reserve, confirm, release. Owned by [P2]."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ReserveRequest(BaseModel):
    user_id: str
    seat_id: str | None = None


class ConfirmRequest(BaseModel):
    user_id: str


@router.post("/events/{event_id}/reserve")
async def reserve_seat(event_id: str, body: ReserveRequest):
    """Reserve a seat or any available seat."""
    raise NotImplementedError


@router.post("/events/{event_id}/reservations/{reservation_id}/confirm")
async def confirm_reservation(event_id: str, reservation_id: str, body: ConfirmRequest):
    """Confirm a held seat."""
    raise NotImplementedError


@router.delete("/events/{event_id}/reservations/{reservation_id}")
async def release_reservation(event_id: str, reservation_id: str):
    """Release a held reservation."""
    raise NotImplementedError
