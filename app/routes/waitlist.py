"""Automated Waitlist and In-App Notification API routes.

Provides endpoints for:
- Joining the waitlist for an event or specific seat
- Polling waitlist status and active offers
- Leaving the waitlist
- Accepting and declining seat offers
- Querying waitlist dashboard telemetry
- Retrieving in-app notifications
"""

from typing import Optional
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.waitlist import waitlist_service
from app.services.notifications import notification_service

router = APIRouter()


class WaitlistJoinRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    seat_id: Optional[str] = None


class WaitlistLeaveRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class OfferActionRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class MarkReadRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)
    notification_id: Optional[str] = None


# 1. Join Waitlist
@router.post("/events/{event_id}/waitlist/join", status_code=200)
async def join_event_waitlist(event_id: str, body: WaitlistJoinRequest, request: Request):
    """Register for the event or seat waitlist."""
    result = await waitlist_service.join_waitlist(event_id, body.user_id, body.seat_id)
    return JSONResponse(status_code=200, content=result)


# 2. Check Waitlist Status
@router.get("/events/{event_id}/waitlist/status", status_code=200)
async def get_waitlist_status(
    event_id: str,
    user_id: str = Query(..., min_length=1, max_length=64),
    request: Request = None,
):
    """Check waitlist queue position, active offer details, or waitlist status."""
    status = await waitlist_service.get_status(event_id, user_id)
    return JSONResponse(status_code=200, content=status)


# 3. Leave Waitlist
@router.post("/events/{event_id}/waitlist/leave", status_code=200)
async def leave_event_waitlist(event_id: str, body: WaitlistLeaveRequest, request: Request):
    """Withdraw from the waitlist or cancel active offer."""
    res = await waitlist_service.leave_waitlist(event_id, body.user_id)
    return JSONResponse(status_code=200, content=res)


# 4. Accept Waitlist Offer
@router.post("/events/{event_id}/waitlist/offers/{offer_id}/accept", status_code=200)
async def accept_waitlist_offer(event_id: str, offer_id: str, body: OfferActionRequest, request: Request):
    """Accept a time-limited seat offer and confirm booking."""
    result = await waitlist_service.accept_offer(event_id, offer_id, body.user_id)
    if not result.get("ok"):
        status_code = 410 if result.get("error") == "OFFER_EXPIRED" else 400
        if result.get("error") == "OFFER_NOT_FOUND":
            status_code = 404
        elif result.get("error") == "UNAUTHORIZED_OFFER":
            status_code = 403
        return JSONResponse(status_code=status_code, content=result)

    return JSONResponse(status_code=200, content=result)


# 5. Decline Waitlist Offer
@router.post("/events/{event_id}/waitlist/offers/{offer_id}/decline", status_code=200)
async def decline_waitlist_offer(event_id: str, offer_id: str, body: OfferActionRequest, request: Request):
    """Decline a seat offer, releasing the inventory to the next waitlisted user."""
    result = await waitlist_service.decline_offer(event_id, offer_id, body.user_id)
    if not result.get("ok"):
        status_code = 404 if result.get("error") == "OFFER_NOT_FOUND" else 400
        return JSONResponse(status_code=status_code, content=result)

    return JSONResponse(status_code=200, content=result)


# 6. Waitlist Telemetry Statistics
@router.get("/events/{event_id}/waitlist/stats", status_code=200)
async def get_waitlist_stats(event_id: str, request: Request = None):
    """Operational statistics for waitlist live monitoring dashboard."""
    stats = await waitlist_service.get_stats(event_id)
    return JSONResponse(status_code=200, content=stats)


# 7. User Notifications
@router.get("/events/{event_id}/notifications", status_code=200)
async def get_user_notifications(
    event_id: str,
    user_id: str = Query(..., min_length=1, max_length=64),
    request: Request = None,
):
    """Fetch in-app notifications for waitlist offers, expirations, and confirmations."""
    notifs = await notification_service.get_user_notifications(event_id, user_id)
    return JSONResponse(
        status_code=200,
        content={"event_id": event_id, "user_id": user_id, "notifications": notifs},
    )


# 8. Mark Notifications as Read
@router.post("/events/{event_id}/notifications/read", status_code=200)
async def mark_notifications_read(event_id: str, body: MarkReadRequest, request: Request):
    """Mark one or all notifications as read."""
    count = await notification_service.mark_as_read(event_id, body.user_id, body.notification_id)
    return JSONResponse(status_code=200, content={"ok": True, "marked_count": count})
