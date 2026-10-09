"""Baseline routes: naive and pessimistic DB booking comparison. Owned by [P3]."""

import asyncio
import logging
from fastapi import APIRouter, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import asyncpg

from app.db import get_baseline_pool

logger = logging.getLogger(__name__)

router = APIRouter()


class BaselineReserveRequest(BaseModel):
    user_id: str


@router.post("/baseline/events/{event_id}/reserve", status_code=status.HTTP_201_CREATED)
async def baseline_reserve(
    event_id: str,
    body: BaselineReserveRequest,
    mode: str = Query(..., pattern="^(naive|pessimistic)$"),
):
    """Reserve a seat using naive or pessimistic DB locking."""
    pool = get_baseline_pool()

    if mode == "naive":
        try:
            async with pool.acquire(timeout=2.0) as conn:
                # 1. SELECT seat_id ... WHERE booked_by IS NULL LIMIT 1 (no locking)
                row = await conn.fetchrow(
                    """
                    SELECT seat_id FROM baseline_seats
                    WHERE event_id = $1 AND booked_by IS NULL
                    LIMIT 1
                    """,
                    event_id,
                )
                if not row:
                    return JSONResponse(
                        status_code=status.HTTP_409_CONFLICT,
                        content={"error": "SOLD_OUT", "message": "No seats available"},
                    )
                seat_id = row["seat_id"]

                # 2. Separately UPDATE ... SET booked_by=$1 WHERE seat_id=$2
                await conn.execute(
                    """
                    UPDATE baseline_seats
                    SET booked_by = $1
                    WHERE event_id = $2 AND seat_id = $3
                    """,
                    body.user_id,
                    event_id,
                    seat_id,
                )

                # 3. INSERT INTO baseline_bookings
                await conn.execute(
                    """
                    INSERT INTO baseline_bookings (event_id, seat_id, user_id)
                    VALUES ($1, $2, $3)
                    """,
                    event_id,
                    seat_id,
                    body.user_id,
                )

                return JSONResponse(
                    status_code=status.HTTP_201_CREATED,
                    content={"seat_id": seat_id},
                )
        except (asyncio.TimeoutError, asyncpg.exceptions.TooManyConnectionsError):
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "DB_POOL_TIMEOUT", "message": "Database pool timeout"},
            )
        except asyncpg.exceptions.QueryCanceledError:
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "DB_POOL_TIMEOUT", "message": "Statement timeout"},
            )

    elif mode == "pessimistic":
        try:
            async with pool.acquire(timeout=2.0) as conn:
                # Set statement_timeout to 3s (3000ms) for this session/transaction
                await conn.execute("SET statement_timeout = 3000")
                try:
                    # One transaction with SELECT ... FOR UPDATE
                    async with conn.transaction():
                        row = await conn.fetchrow(
                            """
                            SELECT seat_id FROM baseline_seats
                            WHERE event_id = $1 AND booked_by IS NULL
                            ORDER BY seat_id
                            LIMIT 1
                            FOR UPDATE
                            """,
                            event_id,
                        )
                        if not row:
                            return JSONResponse(
                                status_code=status.HTTP_409_CONFLICT,
                                content={"error": "SOLD_OUT", "message": "No seats available"},
                            )
                        seat_id = row["seat_id"]

                        await conn.execute(
                            """
                            UPDATE baseline_seats
                            SET booked_by = $1
                            WHERE event_id = $2 AND seat_id = $3
                            """,
                            body.user_id,
                            event_id,
                            seat_id,
                        )

                        await conn.execute(
                            """
                            INSERT INTO baseline_bookings (event_id, seat_id, user_id)
                            VALUES ($1, $2, $3)
                            """,
                            event_id,
                            seat_id,
                            body.user_id,
                        )

                        return JSONResponse(
                            status_code=status.HTTP_201_CREATED,
                            content={"seat_id": seat_id},
                        )
                finally:
                    # Reset statement_timeout before releasing connection back to pool
                    try:
                        await conn.execute("SET statement_timeout = 0")
                    except Exception:
                        pass
        except (asyncio.TimeoutError, asyncpg.exceptions.TooManyConnectionsError):
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "DB_POOL_TIMEOUT", "message": "Database pool timeout"},
            )
        except asyncpg.exceptions.QueryCanceledError:
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"error": "DB_POOL_TIMEOUT", "message": "Statement timeout"},
            )


@router.get("/baseline/events/{event_id}/verify")
async def baseline_verify(event_id: str):
    """Verify double bookings in baseline tables."""
    pool = get_baseline_pool()
    async with pool.acquire(timeout=5.0) as conn:
        booked_rows = await conn.fetchval(
            "SELECT COUNT(*) FROM baseline_bookings WHERE event_id = $1",
            event_id,
        )
        distinct_seats = await conn.fetchval(
            "SELECT COUNT(DISTINCT seat_id) FROM baseline_bookings WHERE event_id = $1",
            event_id,
        )
        b_rows = int(booked_rows or 0)
        d_seats = int(distinct_seats or 0)
        double_bookings = max(0, b_rows - d_seats)
        return {
            "booked_rows": b_rows,
            "distinct_seats": d_seats,
            "double_bookings": double_bookings,
        }
