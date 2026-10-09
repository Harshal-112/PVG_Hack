"""Virtual Waiting Room API routes. Owned by Feature 6.

Endpoints for joining the virtual queue, checking admission status, and queue departure.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.waiting_room import waiting_room_service

router = APIRouter()


class QueueJoinRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class QueueLeaveRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


@router.post("/events/{event_id}/queue/join", status_code=200)
async def join_event_queue(event_id: str, body: QueueJoinRequest, request: Request):
    """Enter the high-demand virtual waiting room queue."""
    result = await waiting_room_service.join_queue(event_id, body.user_id)
    return JSONResponse(status_code=200, content=result)


@router.get("/events/{event_id}/queue/status", status_code=200)
async def get_queue_status(event_id: str, user_id: str, request: Request):
    """Poll queue rank, wait time, or admission token."""
    result = await waiting_room_service.get_status(event_id, user_id)
    return JSONResponse(status_code=200, content=result)


@router.post("/events/{event_id}/queue/leave", status_code=200)
async def leave_event_queue(event_id: str, body: QueueLeaveRequest, request: Request):
    """Leave the waiting room queue or cancel admission."""
    await waiting_room_service.leave_queue(event_id, body.user_id)
    return JSONResponse(status_code=200, content={"ok": True, "event_id": event_id, "user_id": body.user_id})
