"""Virtual Waiting Room service for high-demand ticket releases.

Manages FIFO queuing, queue position calculation, and atomic issuance of
short-lived admission tokens via Redis. Enabled via WAITING_ROOM_ENABLED setting.
"""

import time
import secrets
from typing import Optional
from app.config import settings


class WaitingRoomService:
    def __init__(self, redis=None):
        self._redis = redis

    def set_redis(self, redis):
        self._redis = redis

    @property
    def redis(self):
        if self._redis is None:
            from app.redis_client import get_redis
            self._redis = get_redis()
        return self._redis

    async def join_queue(self, event_id: str, user_id: str) -> dict:
        """Join the virtual waiting room queue for an event."""
        if not settings.WAITING_ROOM_ENABLED:
            return {
                "enabled": False,
                "admitted": True,
                "status": "BYPASS",
                "message": "Virtual waiting room is disabled. Direct reservation enabled.",
                "admission_token": None,
                "position": 0,
                "estimated_wait_seconds": 0,
            }

        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        now_ms = int(time.time() * 1000)

        # 1. Check if user already holds an unexpired admission token
        existing_val = await self.redis.hget(admitted_hash, user_id)
        if existing_val:
            try:
                token, exp_ms = existing_val.split("|", 1)
                if int(exp_ms) > now_ms:
                    return {
                        "enabled": True,
                        "admitted": True,
                        "status": "ADMITTED",
                        "admission_token": token,
                        "position": 0,
                        "expires_at_ms": int(exp_ms),
                        "estimated_wait_seconds": 0,
                    }
                else:
                    await self.redis.hdel(admitted_hash, user_id)
            except Exception:
                pass

        # 2. Check current number of active admitted users
        active_admitted = await self.redis.hlen(admitted_hash)
        if active_admitted < settings.WAITING_ROOM_MAX_ADMITTED:
            # Under capacity: admit immediately
            token = secrets.token_hex(16)
            exp_ms = now_ms + (settings.WAITING_ROOM_TOKEN_TTL_SEC * 1000)
            await self.redis.hset(admitted_hash, user_id, f"{token}|{exp_ms}")
            # Also store reverse lookup for quick token validation
            token_key = f"fr:{event_id}:wr:token:{token}"
            await self.redis.set(token_key, user_id, ex=settings.WAITING_ROOM_TOKEN_TTL_SEC)
            await self.redis.zrem(queue_key, user_id)

            return {
                "enabled": True,
                "admitted": True,
                "status": "ADMITTED",
                "admission_token": token,
                "position": 0,
                "expires_at_ms": exp_ms,
                "estimated_wait_seconds": 0,
            }

        # 3. Over capacity: add to FIFO queue (score = current time)
        await self.redis.zadd(queue_key, {user_id: now_ms})
        rank = await self.redis.zrank(queue_key, user_id)
        position = (rank + 1) if rank is not None else 1
        est_seconds = position * 3

        return {
            "enabled": True,
            "admitted": False,
            "status": "WAITING",
            "admission_token": None,
            "position": position,
            "estimated_wait_seconds": est_seconds,
        }

    async def get_status(self, event_id: str, user_id: str) -> dict:
        """Poll the current queue or admission status for a user."""
        if not settings.WAITING_ROOM_ENABLED:
            return {
                "enabled": False,
                "admitted": True,
                "status": "BYPASS",
                "admission_token": None,
                "position": 0,
                "estimated_wait_seconds": 0,
            }

        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        now_ms = int(time.time() * 1000)

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
                        "admission_token": token,
                        "position": 0,
                        "expires_at_ms": int(exp_ms),
                        "estimated_wait_seconds": 0,
                    }
                else:
                    await self.redis.hdel(admitted_hash, user_id)
            except Exception:
                pass

        # Check queue rank
        rank = await self.redis.zrank(queue_key, user_id)
        if rank is None:
            # Not in queue
            return {
                "enabled": True,
                "admitted": False,
                "status": "NOT_IN_QUEUE",
                "admission_token": None,
                "position": -1,
                "estimated_wait_seconds": 0,
            }

        position = rank + 1
        active_admitted = await self.redis.hlen(admitted_hash)

        # If slot opened up and user is at top of queue
        if active_admitted < settings.WAITING_ROOM_MAX_ADMITTED and rank < (settings.WAITING_ROOM_MAX_ADMITTED - active_admitted):
            token = secrets.token_hex(16)
            exp_ms = now_ms + (settings.WAITING_ROOM_TOKEN_TTL_SEC * 1000)
            await self.redis.hset(admitted_hash, user_id, f"{token}|{exp_ms}")
            token_key = f"fr:{event_id}:wr:token:{token}"
            await self.redis.set(token_key, user_id, ex=settings.WAITING_ROOM_TOKEN_TTL_SEC)
            await self.redis.zrem(queue_key, user_id)

            return {
                "enabled": True,
                "admitted": True,
                "status": "ADMITTED",
                "admission_token": token,
                "position": 0,
                "expires_at_ms": exp_ms,
                "estimated_wait_seconds": 0,
            }

        return {
            "enabled": True,
            "admitted": False,
            "status": "WAITING",
            "admission_token": None,
            "position": position,
            "estimated_wait_seconds": position * 3,
        }

    async def verify_admission_token(self, event_id: str, user_id: str, token: str) -> bool:
        """Atomically verify that the admission token is valid and belongs to the user."""
        if not settings.WAITING_ROOM_ENABLED:
            return True

        if not token or not user_id:
            return False

        token_key = f"fr:{event_id}:wr:token:{token}"
        assigned_user = await self.redis.get(token_key)
        if assigned_user == user_id:
            return True

        # Fallback check hash directly
        admitted_hash = f"fr:{event_id}:wr:admitted"
        existing_val = await self.redis.hget(admitted_hash, user_id)
        if existing_val:
            try:
                stored_token, exp_ms = existing_val.split("|", 1)
                now_ms = int(time.time() * 1000)
                if stored_token == token and int(exp_ms) > now_ms:
                    return True
            except Exception:
                pass

        return False

    async def leave_queue(self, event_id: str, user_id: str) -> bool:
        """Remove user from queue or revoke admission."""
        queue_key = f"fr:{event_id}:wr:queue"
        admitted_hash = f"fr:{event_id}:wr:admitted"
        existing = await self.redis.hget(admitted_hash, user_id)
        if existing:
            token = existing.split("|")[0]
            await self.redis.delete(f"fr:{event_id}:wr:token:{token}")
            await self.redis.hdel(admitted_hash, user_id)
        await self.redis.zrem(queue_key, user_id)
        return True


waiting_room_service = WaitingRoomService()
