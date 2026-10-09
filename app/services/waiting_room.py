"""Virtual Waiting Room service for high-demand ticket releases.

Manages FIFO queuing, queue position calculation, rate-limited gradual admission,
and atomic issuance of short-lived admission tokens via Redis.
Enabled via WAITING_ROOM_ENABLED setting.
"""

import math
import secrets
import time
from typing import Optional
from app.config import settings


class WaitingRoomService:
    def __init__(self, redis=None):
        self._redis = redis
        # In-memory metrics fallback when Redis counters are unavailable
        self._local_metrics = {
            "admissions_total": 0,
            "expired_total": 0,
            "rejected_total": 0,
            "left_total": 0,
        }

    def set_redis(self, redis):
        self._redis = redis

    @property
    def redis(self):
        if self._redis is None:
            from app.redis_client import get_redis
            self._redis = get_redis()
        return self._redis

    async def _incr_metric(self, event_id: str, field: str, amount: int = 1):
        metrics_key = f"fr:{event_id}:wr:metrics"
        try:
            if hasattr(self.redis, "hincrby"):
                await self.redis.hincrby(metrics_key, field, amount)
            elif hasattr(self.redis, "hset"):
                current = await self.redis.hget(metrics_key, field)
                val = (int(current) if current else 0) + amount
                await self.redis.hset(metrics_key, field, str(val))
        except Exception:
            self._local_metrics[field] = self._local_metrics.get(field, 0) + amount

    async def _get_metric(self, event_id: str, field: str) -> int:
        metrics_key = f"fr:{event_id}:wr:metrics"
        try:
            val = await self.redis.hget(metrics_key, field)
            if val is not None:
                return int(val)
        except Exception:
            pass
        return self._local_metrics.get(field, 0)

    async def _process_admissions(self, event_id: str):
        """Gradually admit waiting users into the admitted pool according to rate and capacity limits."""
        if not settings.WAITING_ROOM_ENABLED:
            return

        now_ms = int(time.time() * 1000)
        admitted_hash = f"fr:{event_id}:wr:admitted"
        queue_key = f"fr:{event_id}:wr:queue"
        rate_key = f"fr:{event_id}:wr:rate"

        # 1. Reap expired admissions
        try:
            admitted_entries = {}
            if hasattr(self.redis, "hgetall"):
                admitted_entries = await self.redis.hgetall(admitted_hash)
            elif hasattr(self.redis, "hashes") and admitted_hash in self.redis.hashes:
                admitted_entries = dict(self.redis.hashes[admitted_hash])

            for uid, val in list(admitted_entries.items()):
                try:
                    tok, exp_str = val.split("|", 1)
                    if int(exp_str) <= now_ms:
                        await self.redis.hdel(admitted_hash, uid)
                        await self.redis.delete(f"fr:{event_id}:wr:token:{tok}")
                        await self._incr_metric(event_id, "expired_total")
                except Exception:
                    pass
        except Exception:
            pass

        # 2. Check current capacity
        active_admitted = await self.redis.hlen(admitted_hash)
        capacity_available = settings.WAITING_ROOM_MAX_ADMITTED - active_admitted
        if capacity_available <= 0:
            return

        # 3. Check admission rate limiter (token bucket in Redis)
        rate_limit = settings.WAITING_ROOM_ADMISSION_RATE
        tokens_val = await self.redis.hget(rate_key, "tokens")
        last_ms_val = await self.redis.hget(rate_key, "last_ms")

        if tokens_val is None or last_ms_val is None:
            current_tokens = float(rate_limit)
            last_ms = now_ms
        else:
            try:
                current_tokens = float(tokens_val)
                last_ms = int(last_ms_val)
            except Exception:
                current_tokens = float(rate_limit)
                last_ms = now_ms

            elapsed_sec = max(0.0, (now_ms - last_ms) / 1000.0)
            current_tokens = min(float(rate_limit), current_tokens + elapsed_sec * rate_limit)
            last_ms = now_ms

        to_admit = min(capacity_available, int(current_tokens))
        if to_admit <= 0:
            await self.redis.hset(rate_key, "tokens", str(current_tokens))
            await self.redis.hset(rate_key, "last_ms", str(last_ms))
            return

        # 4. Fetch top candidates from FIFO queue
        users_to_admit = []
        try:
            if hasattr(self.redis, "zpopmin"):
                popped = await self.redis.zpopmin(queue_key, to_admit)
                users_to_admit = [item[0] for item in popped]
            elif hasattr(self.redis, "zrange"):
                users_to_admit = await self.redis.zrange(queue_key, 0, to_admit - 1)
                for u in users_to_admit:
                    await self.redis.zrem(queue_key, u)
            elif hasattr(self.redis, "zsets") and queue_key in self.redis.zsets:
                # Fallback for FakeWaitingRoomRedis
                sorted_members = sorted(
                    self.redis.zsets[queue_key].keys(),
                    key=lambda m: self.redis.zsets[queue_key][m]
                )
                users_to_admit = sorted_members[:to_admit]
                for u in users_to_admit:
                    await self.redis.zrem(queue_key, u)
        except Exception:
            pass

        if not users_to_admit:
            await self.redis.hset(rate_key, "tokens", str(current_tokens))
            await self.redis.hset(rate_key, "last_ms", str(last_ms))
            return

        # 5. Issue cryptographic admission credentials to admitted candidates
        for uid in users_to_admit:
            token = secrets.token_hex(20)
            exp_ms = now_ms + (settings.WAITING_ROOM_TOKEN_TTL_SEC * 1000)
            await self.redis.hset(admitted_hash, uid, f"{token}|{exp_ms}")
            token_key = f"fr:{event_id}:wr:token:{token}"
            await self.redis.set(token_key, uid, ex=settings.WAITING_ROOM_TOKEN_TTL_SEC)
            await self._incr_metric(event_id, "admissions_total")

        # Deduct used tokens from rate bucket
        current_tokens = max(0.0, current_tokens - len(users_to_admit))
        await self.redis.hset(rate_key, "tokens", str(current_tokens))
        await self.redis.hset(rate_key, "last_ms", str(last_ms))

    async def join_queue(self, event_id: str, user_id: str) -> dict:
        """Join the virtual waiting room queue for an event."""
        if not settings.WAITING_ROOM_ENABLED:
            return {
                "enabled": False,
                "admitted": True,
                "status": "BYPASS",
                "message": "Virtual waiting room is disabled. Direct reservation enabled.",
                "queue_entry_id": user_id,
                "admission_token": None,
                "position": 0,
                "users_ahead": 0,
                "estimated_wait_seconds": 0,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        now_ms = int(time.time() * 1000)

        # 1. Process pending admissions and expire stale holds
        await self._process_admissions(event_id)

        # 2. Check if user already holds a valid admission token
        existing_val = await self.redis.hget(admitted_hash, user_id)
        if existing_val:
            try:
                token, exp_ms = existing_val.split("|", 1)
                if int(exp_ms) > now_ms:
                    return {
                        "enabled": True,
                        "admitted": True,
                        "status": "ADMITTED",
                        "queue_entry_id": user_id,
                        "admission_token": token,
                        "position": 0,
                        "users_ahead": 0,
                        "expires_at_ms": int(exp_ms),
                        "estimated_wait_seconds": 0,
                        "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
                    }
                else:
                    await self.redis.hdel(admitted_hash, user_id)
                    await self.redis.delete(f"fr:{event_id}:wr:token:{token}")
                    await self._incr_metric(event_id, "expired_total")
            except Exception:
                pass

        # 3. Check if user is already waiting in queue
        rank = await self.redis.zrank(queue_key, user_id)
        if rank is not None:
            position = rank + 1
            est_wait = max(1, math.ceil(position / settings.WAITING_ROOM_ADMISSION_RATE))
            return {
                "enabled": True,
                "admitted": False,
                "status": "WAITING",
                "queue_entry_id": user_id,
                "admission_token": None,
                "position": position,
                "users_ahead": rank,
                "estimated_wait_seconds": est_wait,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        # 4. Check maximum queue capacity
        queue_len = 0
        if hasattr(self.redis, "zcard"):
            queue_len = await self.redis.zcard(queue_key)
        elif hasattr(self.redis, "zsets") and queue_key in self.redis.zsets:
            queue_len = len(self.redis.zsets[queue_key])

        if queue_len >= settings.WAITING_ROOM_MAX_QUEUE_SIZE:
            await self._incr_metric(event_id, "rejected_total")
            return {
                "enabled": True,
                "admitted": False,
                "status": "QUEUE_FULL",
                "error": "QUEUE_OVERLOAD",
                "message": "Virtual waiting room is currently at maximum capacity. Please retry shortly.",
                "queue_entry_id": user_id,
                "admission_token": None,
                "position": -1,
                "users_ahead": -1,
                "estimated_wait_seconds": 0,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        # 5. Check if capacity allows immediate admission
        active_admitted = await self.redis.hlen(admitted_hash)
        if active_admitted < settings.WAITING_ROOM_MAX_ADMITTED and queue_len == 0:
            token = secrets.token_hex(20)
            exp_ms = now_ms + (settings.WAITING_ROOM_TOKEN_TTL_SEC * 1000)
            await self.redis.hset(admitted_hash, user_id, f"{token}|{exp_ms}")
            token_key = f"fr:{event_id}:wr:token:{token}"
            await self.redis.set(token_key, user_id, ex=settings.WAITING_ROOM_TOKEN_TTL_SEC)
            await self.redis.zrem(queue_key, user_id)
            await self._incr_metric(event_id, "admissions_total")

            return {
                "enabled": True,
                "admitted": True,
                "status": "ADMITTED",
                "queue_entry_id": user_id,
                "admission_token": token,
                "position": 0,
                "users_ahead": 0,
                "expires_at_ms": exp_ms,
                "estimated_wait_seconds": 0,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        # 6. Add user to FIFO queue
        await self.redis.zadd(queue_key, {user_id: now_ms})
        rank = await self.redis.zrank(queue_key, user_id)
        position = (rank + 1) if rank is not None else 1
        est_wait = max(1, math.ceil(position / settings.WAITING_ROOM_ADMISSION_RATE))

        return {
            "enabled": True,
            "admitted": False,
            "status": "WAITING",
            "queue_entry_id": user_id,
            "admission_token": None,
            "position": position,
            "users_ahead": position - 1,
            "estimated_wait_seconds": est_wait,
            "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
        }

    async def get_status(self, event_id: str, user_id: str) -> dict:
        """Poll the current queue or admission status for a user."""
        if not settings.WAITING_ROOM_ENABLED:
            return {
                "enabled": False,
                "admitted": True,
                "status": "BYPASS",
                "queue_entry_id": user_id,
                "admission_token": None,
                "position": 0,
                "users_ahead": 0,
                "estimated_wait_seconds": 0,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        now_ms = int(time.time() * 1000)

        # Process pending admissions
        await self._process_admissions(event_id)

        # Check existing admission
        existing_val = await self.redis.hget(admitted_hash, user_id)
        if existing_val:
            try:
                token, exp_ms = existing_val.split("|", 1)
                if int(exp_ms) > now_ms:
                    return {
                        "enabled": True,
                        "admitted": True,
                        "status": "ADMITTED",
                        "queue_entry_id": user_id,
                        "admission_token": token,
                        "position": 0,
                        "users_ahead": 0,
                        "expires_at_ms": int(exp_ms),
                        "estimated_wait_seconds": 0,
                        "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
                    }
                else:
                    await self.redis.hdel(admitted_hash, user_id)
                    await self.redis.delete(f"fr:{event_id}:wr:token:{token}")
                    await self._incr_metric(event_id, "expired_total")
            except Exception:
                pass

        # Check queue rank
        rank = await self.redis.zrank(queue_key, user_id)
        if rank is None:
            return {
                "enabled": True,
                "admitted": False,
                "status": "NOT_IN_QUEUE",
                "queue_entry_id": user_id,
                "admission_token": None,
                "position": -1,
                "users_ahead": -1,
                "estimated_wait_seconds": 0,
                "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            }

        position = rank + 1
        est_wait = max(1, math.ceil(position / settings.WAITING_ROOM_ADMISSION_RATE))

        return {
            "enabled": True,
            "admitted": False,
            "status": "WAITING",
            "queue_entry_id": user_id,
            "admission_token": None,
            "position": position,
            "users_ahead": rank,
            "estimated_wait_seconds": est_wait,
            "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
        }

    async def verify_admission_token(self, event_id: str, user_id: str, token: str) -> bool:
        """Atomically verify that the admission token is valid, unexpired, and belongs to the user."""
        if not settings.WAITING_ROOM_ENABLED:
            return True

        if not token or not user_id:
            return False

        now_ms = int(time.time() * 1000)

        # Quick reverse lookup
        token_key = f"fr:{event_id}:wr:token:{token}"
        assigned_user = await self.redis.get(token_key)
        if assigned_user == user_id:
            # Check unexpired in admitted hash
            admitted_hash = f"fr:{event_id}:wr:admitted"
            val = await self.redis.hget(admitted_hash, user_id)
            if val:
                try:
                    _, exp_ms = val.split("|", 1)
                    if int(exp_ms) > now_ms:
                        return True
                    else:
                        # Expired: clean up
                        await self.redis.hdel(admitted_hash, user_id)
                        await self.redis.delete(token_key)
                        await self._incr_metric(event_id, "expired_total")
                except Exception:
                    pass
            return False

        # Fallback check hash directly
        admitted_hash = f"fr:{event_id}:wr:admitted"
        existing_val = await self.redis.hget(admitted_hash, user_id)
        if existing_val:
            try:
                stored_token, exp_ms = existing_val.split("|", 1)
                if stored_token == token and int(exp_ms) > now_ms:
                    return True
                elif int(exp_ms) <= now_ms:
                    await self.redis.hdel(admitted_hash, user_id)
                    await self.redis.delete(f"fr:{event_id}:wr:token:{stored_token}")
                    await self._incr_metric(event_id, "expired_total")
            except Exception:
                pass

        return False

    async def leave_queue(self, event_id: str, user_id: str) -> dict:
        """Remove user from queue or revoke admission."""
        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        existing = await self.redis.hget(admitted_hash, user_id)
        if existing:
            try:
                token = existing.split("|")[0]
                await self.redis.delete(f"fr:{event_id}:wr:token:{token}")
            except Exception:
                pass
            await self.redis.hdel(admitted_hash, user_id)
            await self._incr_metric(event_id, "left_total")

        await self.redis.zrem(queue_key, user_id)
        # Immediately run admissions to fill open slot
        await self._process_admissions(event_id)

        return {"ok": True, "status": "LEFT", "event_id": event_id, "user_id": user_id}

    async def get_stats(self, event_id: str) -> dict:
        """Operational statistics for virtual waiting room dashboard & telemetry."""
        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"

        # Refresh state
        if settings.WAITING_ROOM_ENABLED:
            await self._process_admissions(event_id)

        waiting_count = 0
        try:
            if hasattr(self.redis, "zcard"):
                waiting_count = await self.redis.zcard(queue_key)
            elif hasattr(self.redis, "zsets") and queue_key in self.redis.zsets:
                waiting_count = len(self.redis.zsets[queue_key])
        except Exception:
            pass

        admitted_count = 0
        try:
            admitted_count = await self.redis.hlen(admitted_hash)
        except Exception:
            pass

        rate = settings.WAITING_ROOM_ADMISSION_RATE
        avg_wait_sec = max(0, math.ceil(waiting_count / rate)) if rate > 0 else 0

        admissions_total = await self._get_metric(event_id, "admissions_total")
        expired_total = await self._get_metric(event_id, "expired_total")
        rejected_total = await self._get_metric(event_id, "rejected_total")
        left_total = await self._get_metric(event_id, "left_total")

        return {
            "event_id": event_id,
            "enabled": settings.WAITING_ROOM_ENABLED,
            "waiting_count": waiting_count,
            "admitted_count": admitted_count,
            "max_admitted": settings.WAITING_ROOM_MAX_ADMITTED,
            "admission_rate_per_sec": settings.WAITING_ROOM_ADMISSION_RATE,
            "max_queue_size": settings.WAITING_ROOM_MAX_QUEUE_SIZE,
            "token_ttl_sec": settings.WAITING_ROOM_TOKEN_TTL_SEC,
            "poll_interval_ms": settings.WAITING_ROOM_POLL_INTERVAL_MS,
            "admissions_total": admissions_total,
            "expired_total": expired_total,
            "rejected_total": rejected_total,
            "left_total": left_total,
            "avg_wait_seconds": avg_wait_sec,
            "queue_status": "ACTIVE" if settings.WAITING_ROOM_ENABLED else "DISABLED",
        }

    async def reset_queue(self, event_id: str):
        """Reset waiting room queues and metrics for an event."""
        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        rate_key = f"fr:{event_id}:wr:rate"
        metrics_key = f"fr:{event_id}:wr:metrics"

        try:
            await self.redis.delete(queue_key)
            await self.redis.delete(admitted_hash)
            await self.redis.delete(rate_key)
            await self.redis.delete(metrics_key)
        except Exception:
            pass
        self._local_metrics = {
            "admissions_total": 0,
            "expired_total": 0,
            "rejected_total": 0,
            "left_total": 0,
        }


waiting_room_service = WaitingRoomService()
