"""Tiny local mock server for FlashSeat API testing (owned by P4 under loadtest/).

Provides the endpoints specified in SPEC.md section 9 and section 11 for local development
and verification before P1, P2, and P3 components are fully integrated.
"""

import os
import time
import uuid
import random
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

app = FastAPI(title="FlashSeat Mock Server (P4)")

DEFAULT_HOLD_TTL_MS = int(os.getenv("HOLD_TTL_MS", "120000"))

# State structure per event
# {
#   "seat_count": 200,
#   "seats": {"S001": "FREE", ...},
#   "holds": {"S001": {"rid": "...", "expires_at": ms, "user_id": "..."}, ...},
#   "sold": {"S001": {"rid": "...", "user_id": "...", "confirmed_at": ms}},
#   "reservations": {"rid": {"status": "HELD"|"CONFIRMED"|"RELEASED"|"EXPIRED", "seat_id": "...", "user_id": "...", "expires_at": ms}},
#   "baseline_bookings": [{"seat_id": "...", "user_id": "..."}]
# }
events_db: Dict[str, Dict[str, Any]] = {}


def _get_now_ms() -> int:
    return int(time.time() * 1000)


def _init_event(event_id: str, seat_count: int = 200) -> Dict[str, Any]:
    seats = {f"S{i:03d}": "FREE" for i in range(1, seat_count + 1)}
    events_db[event_id] = {
        "seat_count": seat_count,
        "seats": seats,
        "holds": {},  # seat_id -> dict
        "sold": {},   # seat_id -> dict
        "reservations": {},  # rid -> dict
        "baseline_bookings": [],
        "baseline_timeouts": 0,
    }
    return events_db[event_id]


def _get_event(event_id: str) -> Dict[str, Any]:
    if event_id not in events_db:
        return _init_event(event_id, 200)
    return events_db[event_id]


def _reap_event(evt: Dict[str, Any]) -> None:
    now = _get_now_ms()
    expired_seats = []
    for seat_id, hold_info in list(evt["holds"].items()):
        if hold_info["expires_at"] <= now:
            expired_seats.append((seat_id, hold_info["rid"]))

    for seat_id, rid in expired_seats:
        del evt["holds"][seat_id]
        evt["seats"][seat_id] = "FREE"
        if rid in evt["reservations"]:
            evt["reservations"][rid]["status"] = "EXPIRED"


class SeedRequest(BaseModel):
    event_id: str = "evt1"
    seat_count: int = 200


class ReserveRequest(BaseModel):
    user_id: str
    seat_id: Optional[str] = None


class ConfirmRequest(BaseModel):
    user_id: str


class BaselineReserveRequest(BaseModel):
    user_id: str


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/metrics")
async def metrics():
    return PlainTextResponse("# HELP flashseat_reserve_total Reserve requests\nflashseat_reserve_total 1\n")


@app.post("/api/v1/admin/events", status_code=201)
async def admin_seed_event(body: SeedRequest):
    _init_event(body.event_id, body.seat_count)
    return {"event_id": body.event_id, "seat_count": body.seat_count}


@app.post("/api/v1/admin/events/{event_id}/reset")
async def admin_reset_event(event_id: str):
    evt = _get_event(event_id)
    seat_count = evt["seat_count"]
    _init_event(event_id, seat_count)
    return {"event_id": event_id, "seat_count": seat_count}


@app.post("/api/v1/events/{event_id}/reserve")
async def reserve_seat(event_id: str, body: ReserveRequest, request: Request):
    evt = _get_event(event_id)
    _reap_event(evt)

    user_id = body.user_id
    requested_seat = body.seat_id
    ttl_ms = int(request.query_params.get("ttl_ms", DEFAULT_HOLD_TTL_MS))

    target_seat = None
    if requested_seat:
        status = evt["seats"].get(requested_seat)
        if status is None:
            return JSONResponse(status_code=404, content={"error": "SEAT_UNKNOWN", "message": "Seat does not exist"})
        elif status == "HELD":
            return JSONResponse(status_code=409, content={"error": "SEAT_HELD", "message": "Seat currently held"})
        elif status == "SOLD":
            return JSONResponse(status_code=409, content={"error": "SEAT_SOLD", "message": "Seat already sold"})
        elif status == "FREE":
            target_seat = requested_seat
    else:
        # Pick any free seat
        free_seats = [s for s, st in evt["seats"].items() if st == "FREE"]
        if not free_seats:
            return JSONResponse(status_code=409, content={"error": "SOLD_OUT", "message": "No seats remaining"})
        target_seat = free_seats[0]

    if not target_seat or evt["seats"].get(target_seat) != "FREE":
        return JSONResponse(status_code=409, content={"error": "SOLD_OUT", "message": "No seats remaining"})

    rid = uuid.uuid4().hex
    now = _get_now_ms()
    exp = now + ttl_ms

    evt["seats"][target_seat] = "HELD"
    evt["holds"][target_seat] = {"rid": rid, "expires_at": exp, "user_id": user_id}
    evt["reservations"][rid] = {"status": "HELD", "seat_id": target_seat, "user_id": user_id, "expires_at": exp}

    return JSONResponse(
        status_code=201,
        content={"reservation_id": rid, "seat_id": target_seat, "expires_at_ms": exp, "ttl_ms": ttl_ms},
    )


@app.post("/api/v1/events/{event_id}/reservations/{reservation_id}/confirm")
async def confirm_reservation(event_id: str, reservation_id: str, body: ConfirmRequest):
    evt = _get_event(event_id)
    _reap_event(evt)

    res = evt["reservations"].get(reservation_id)
    if not res:
        return JSONResponse(status_code=404, content={"error": "UNKNOWN", "message": "Reservation not found"})

    if res["status"] == "CONFIRMED":
        return {"status": "CONFIRMED", "seat_id": res["seat_id"], "idempotent": True}

    if res["status"] == "EXPIRED":
        return JSONResponse(status_code=410, content={"error": "HOLD_EXPIRED", "message": "Hold has expired", "seat_id": res["seat_id"]})

    if res["status"] != "HELD":
        return JSONResponse(status_code=410, content={"error": "HOLD_EXPIRED", "message": "Hold is invalid", "seat_id": res["seat_id"]})

    seat_id = res["seat_id"]
    if seat_id in evt["holds"]:
        del evt["holds"][seat_id]
    evt["seats"][seat_id] = "SOLD"
    evt["sold"][seat_id] = {"rid": reservation_id, "user_id": body.user_id, "confirmed_at": _get_now_ms()}
    res["status"] = "CONFIRMED"

    return {"status": "CONFIRMED", "seat_id": seat_id, "idempotent": False}


@app.delete("/api/v1/events/{event_id}/reservations/{reservation_id}")
async def release_reservation(event_id: str, reservation_id: str):
    evt = _get_event(event_id)
    _reap_event(evt)

    res = evt["reservations"].get(reservation_id)
    if not res:
        return JSONResponse(status_code=404, content={"error": "UNKNOWN", "message": "Reservation not found"})

    if res["status"] == "CONFIRMED":
        return JSONResponse(status_code=409, content={"error": "ALREADY_CONFIRMED", "message": "Cannot release confirmed reservation", "seat_id": res["seat_id"]})

    if res["status"] == "HELD":
        seat_id = res["seat_id"]
        if seat_id in evt["holds"]:
            del evt["holds"][seat_id]
        evt["seats"][seat_id] = "FREE"
        res["status"] = "RELEASED"
        return {"status": "RELEASED", "seat_id": seat_id}

    return {"status": "NOOP", "seat_id": res.get("seat_id")}


@app.get("/api/v1/events/{event_id}/stats")
async def get_stats(event_id: str):
    evt = _get_event(event_id)
    _reap_event(evt)

    total = evt["seat_count"]
    free = sum(1 for st in evt["seats"].values() if st == "FREE")
    held = sum(1 for st in evt["seats"].values() if st == "HELD")
    sold = sum(1 for st in evt["seats"].values() if st == "SOLD")

    return {
        "event_id": event_id,
        "total": total,
        "free": free,
        "held": held,
        "sold": sold,
        "persisted": sold,
        "backlog": 0,
        "hold_ttl_ms": DEFAULT_HOLD_TTL_MS,
    }


@app.get("/api/v1/events/{event_id}/seats")
async def get_seats(event_id: str):
    evt = _get_event(event_id)
    _reap_event(evt)
    return {"seats": evt["seats"]}


@app.get("/api/v1/events/{event_id}/verify")
async def verify_event(event_id: str):
    evt = _get_event(event_id)
    _reap_event(evt)

    sold_count = len(evt["sold"])

    return {
        "event_id": event_id,
        "redis_sold": sold_count,
        "pg_bookings": sold_count,
        "drained": True,
        "duplicate_seat_rows": 0,
        "missing_in_pg": [],
        "extra_in_pg": [],
        "consistent": True,
        "no_double_booking": True,
    }


@app.post("/api/v1/baseline/events/{event_id}/reserve")
async def baseline_reserve(event_id: str, body: BaselineReserveRequest, mode: str = Query("naive")):
    evt = _get_event(event_id)

    if mode == "pessimistic":
        # Simulate pool exhaustion under high concurrency
        if len(evt["baseline_bookings"]) >= 20:
            evt["baseline_timeouts"] += 1
            return JSONResponse(status_code=503, content={"error": "DB_POOL_TIMEOUT", "message": "Database pool exhausted"})

    # Naive mode: pick seat from S001..S200 (allow double booking if over seat_count)
    curr_len = len(evt["baseline_bookings"])
    seat_num = (curr_len % evt["seat_count"]) + 1
    seat_id = f"S{seat_num:03d}"

    evt["baseline_bookings"].append({"seat_id": seat_id, "user_id": body.user_id})
    return JSONResponse(status_code=201, content={"seat_id": seat_id})


@app.get("/api/v1/baseline/events/{event_id}/verify")
async def baseline_verify(event_id: str):
    evt = _get_event(event_id)
    bookings = evt["baseline_bookings"]
    booked_rows = len(bookings)
    distinct_seats = len(set(b["seat_id"] for b in bookings))
    double_bookings = booked_rows - distinct_seats if booked_rows > distinct_seats else 0

    return {
        "booked_rows": booked_rows,
        "distinct_seats": distinct_seats,
        "double_bookings": double_bookings,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
