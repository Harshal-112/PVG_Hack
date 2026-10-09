"""Stream consumer worker that writes confirmed bookings to Postgres. Owned by [P3]."""

import asyncio
import datetime
import logging
import os
import socket
import time
import uuid

import asyncpg
import redis.asyncio as aioredis

from app.config import settings
from app.db import close_pool, get_pool, init_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

STREAM_NAME = "fr:bookings"
GROUP_NAME = "pg-writers"

writer_inserted_total: int = 0
writer_batches_total: int = 0


async def ensure_consumer_group(redis_client: aioredis.Redis) -> None:
    """Ensure the consumer group exists on the bookings stream."""
    try:
        await redis_client.xgroup_create(
            name=STREAM_NAME,
            groupname=GROUP_NAME,
            id="0",
            mkstream=True,
        )
        logger.info("Created consumer group '%s' on stream '%s'", GROUP_NAME, STREAM_NAME)
    except Exception as e:
        # If the consumer group already exists, BUSYGROUP is raised; ignore it
        if "BUSYGROUP" in str(e):
            logger.debug("Consumer group '%s' already exists", GROUP_NAME)
        else:
            raise


async def process_batch(
    pool: asyncpg.Pool,
    redis_client: aioredis.Redis,
    entries: list[tuple[str, dict]],
) -> None:
    """Process a batch of stream entries in ONE transaction with ON CONFLICT DO NOTHING."""
    global writer_inserted_total, writer_batches_total
    if not entries:
        return

    msg_ids_to_ack = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            for msg_id, data in entries:
                event_id = data.get("event_id")
                seat_id = data.get("seat_id")
                reservation_id = data.get("reservation_id")
                user_id = data.get("user_id")
                confirmed_at_ms = data.get("confirmed_at_ms")

                try:
                    ms = int(confirmed_at_ms) if confirmed_at_ms is not None else int(time.time() * 1000)
                except (ValueError, TypeError):
                    ms = int(time.time() * 1000)
                confirmed_at = datetime.datetime.fromtimestamp(ms / 1000.0, tz=datetime.timezone.utc)

                try:
                    # Savepoint per item to isolate UNIQUE(event_id, seat_id) conflicts without aborting the transaction
                    async with conn.transaction():
                        await conn.execute(
                            """
                            INSERT INTO bookings (event_id, seat_id, reservation_id, user_id, confirmed_at)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (reservation_id) DO NOTHING
                            """,
                            event_id,
                            seat_id,
                            reservation_id,
                            user_id,
                            confirmed_at,
                        )
                except asyncpg.UniqueViolationError as e:
                    # Row violates UNIQUE(event_id, seat_id) with a different reservation_id
                    logger.critical(
                        "Violation of UNIQUE(event_id, seat_id) for event=%s, seat=%s, reservation_id=%s, user=%s: %s",
                        event_id,
                        seat_id,
                        reservation_id,
                        user_id,
                        e,
                    )
                    await conn.execute(
                        """
                        INSERT INTO booking_conflicts (event_id, seat_id, reservation_id, user_id, note)
                        VALUES ($1, $2, $3, $4, $5)
                        """,
                        event_id,
                        seat_id,
                        reservation_id,
                        user_id,
                        f"UNIQUE(event_id, seat_id) violation: {e}",
                    )

                msg_ids_to_ack.append(msg_id)

    # XACK only after the transaction commit succeeds
    if msg_ids_to_ack:
        await redis_client.xack(STREAM_NAME, GROUP_NAME, *msg_ids_to_ack)

    writer_batches_total += 1
    writer_inserted_total += len(entries)
    logger.info(
        "Batch committed and ACKed (%d messages). writer_inserted_total=%d writer_batches_total=%d",
        len(entries),
        writer_inserted_total,
        writer_batches_total,
    )


async def run_autoclaim(
    pool: asyncpg.Pool,
    redis_client: aioredis.Redis,
    consumer_name: str,
    start_id: str = "0-0",
) -> str:
    """Run XAUTOCLAIM for entries idle > 30s to recover from crashed writers."""
    try:
        claim_res = await redis_client.xautoclaim(
            name=STREAM_NAME,
            groupname=GROUP_NAME,
            consumername=consumer_name,
            min_idle_time=30000,
            start_id=start_id,
            count=settings.WRITER_BATCH,
        )
        # xautoclaim returns (next_start_id, messages, [deleted_ids])
        next_id = claim_res[0]
        messages = claim_res[1]
        if messages:
            logger.info("XAUTOCLAIM claimed %d stuck entries", len(messages))
            await process_batch(pool, redis_client, messages)
        return next_id
    except Exception as e:
        logger.warning("Error running XAUTOCLAIM: %s", e)
        return start_id


async def main() -> None:
    """Writer worker entry point."""
    consumer_name = f"writer-{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
    logger.info("Starting writer worker with consumer name: %s", consumer_name)

    await init_pool()
    pool = get_pool()
    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

    try:
        await ensure_consumer_group(redis_client)

        autoclaim_start_id = "0-0"
        # Run XAUTOCLAIM on start
        autoclaim_start_id = await run_autoclaim(pool, redis_client, consumer_name, autoclaim_start_id)
        last_autoclaim = time.monotonic()

        while True:
            # Run XAUTOCLAIM every 30s
            now = time.monotonic()
            if now - last_autoclaim >= 30.0:
                autoclaim_start_id = await run_autoclaim(pool, redis_client, consumer_name, autoclaim_start_id)
                last_autoclaim = now

            try:
                streams_res = await redis_client.xreadgroup(
                    groupname=GROUP_NAME,
                    consumername=consumer_name,
                    streams={STREAM_NAME: ">"},
                    count=settings.WRITER_BATCH,
                    block=settings.WRITER_BLOCK_MS,
                )
            except Exception as e:
                logger.error("Error in XREADGROUP: %s", e)
                await asyncio.sleep(1.0)
                continue

            if streams_res:
                for stream_name, messages in streams_res:
                    if messages:
                        await process_batch(pool, redis_client, messages)
            else:
                await asyncio.sleep(0.01)

    except (asyncio.CancelledError, KeyboardInterrupt):
        logger.info("Writer worker shutting down...")
    finally:
        await redis_client.aclose()
        await close_pool()
        logger.info("Writer worker stopped.")


if __name__ == "__main__":
    asyncio.run(main())
