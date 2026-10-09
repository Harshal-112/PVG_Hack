"""Virtual Waiting Room API routes. Owned by Feature 6.

Endpoints for joining the virtual queue, checking admission status,
queue departure, and monitoring queue statistics.
Supports both /events/{event_id}/waiting-room/* and /events/{event_id}/queue/* routes.
"""

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.waiting_room import waiting_room_service

router = APIRouter()


class QueueJoinRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class QueueLeaveRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


# 1. Join Queue
@router.post("/events/{event_id}/waiting-room/join", status_code=200)
@router.post("/events/{event_id}/queue/join", status_code=200)
async def join_event_queue(event_id: str, body: QueueJoinRequest, request: Request):
    """Enter the high-demand virtual waiting room queue."""
    result = await waiting_room_service.join_queue(event_id, body.user_id)
    status_code = 429 if result.get("status") == "QUEUE_FULL" else 200
    return JSONResponse(status_code=status_code, content=result)


# 2. Check Queue Status
@router.get("/events/{event_id}/waiting-room/status", status_code=200)
@router.get("/events/{event_id}/queue/status", status_code=200)
async def get_queue_status(event_id: str, user_id: str = Query(..., min_length=1, max_length=64), request: Request = None):
    """Poll queue rank, wait time, or admission token."""
    result = await waiting_room_service.get_status(event_id, user_id)
    return JSONResponse(status_code=200, content=result)


# 3. Leave Queue
@router.post("/events/{event_id}/waiting-room/leave", status_code=200)
@router.post("/events/{event_id}/queue/leave", status_code=200)
async def leave_event_queue(event_id: str, body: QueueLeaveRequest, request: Request):
    """Leave the waiting room queue or cancel admission."""
    res = await waiting_room_service.leave_queue(event_id, body.user_id)
    return JSONResponse(status_code=200, content=res)


# 4. Queue Statistics
@router.get("/events/{event_id}/waiting-room/stats", status_code=200)
@router.get("/events/{event_id}/queue/stats", status_code=200)
async def get_queue_stats(event_id: str, request: Request = None):
    """Operational statistics and metrics for the virtual waiting room."""
    stats = await waiting_room_service.get_stats(event_id)
    return JSONResponse(status_code=200, content=stats)
