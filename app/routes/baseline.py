"""Baseline routes: naive and pessimistic DB booking comparison. Owned by [P3]."""

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter()


class BaselineReserveRequest(BaseModel):
    user_id: str


@router.post("/baseline/events/{event_id}/reserve")
async def baseline_reserve(
    event_id: str,
    body: BaselineReserveRequest,
    mode: str = Query(..., regex="^(naive|pessimistic)$"),
):
    """Reserve a seat using naive or pessimistic DB locking."""
    raise NotImplementedError


@router.get("/baseline/events/{event_id}/verify")
async def baseline_verify(event_id: str):
    """Verify double bookings in baseline tables."""
    raise NotImplementedError
