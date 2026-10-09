"""Notification service for waitlist offers and reservation lifecycle events.

Provides decoupled, non-blocking notification dispatch and persistent event logs.
Notification delivery failures never block or invalidate atomic inventory locks.
"""

import json
import time
import uuid
from typing import Optional


class NotificationService:
    def __init__(self, redis=None):
        self._redis = redis
        self._local_notifications: dict[str, list[dict]] = {}  # key: f"{event_id}:{user_id}"
        self._stats = {"sent_total": 0, "failed_total": 0}

    def set_redis(self, redis):
        self._redis = redis

    @property
    def redis(self):
        if self._redis is None:
            try:
                from app.redis_client import get_redis
                self._redis = get_redis()
            except Exception:
                pass
        return self._redis

    async def send_notification(
        self,
        event_id: str,
        user_id: str,
        notif_type: str,
        title: str,
        message: str,
        data: Optional[dict] = None,
    ) -> dict:
        """Create and queue a notification for a user. Decoupled from inventory locks."""
        now_ms = int(time.time() * 1000)
        notif_id = f"ntf-{uuid.uuid4().hex[:10]}"

        payload = {
            "notification_id": notif_id,
            "event_id": event_id,
            "user_id": user_id,
            "type": notif_type,
            "title": title,
            "message": message,
            "data": data or {},
            "status": "DELIVERED",
            "read": False,
            "created_at_ms": now_ms,
        }

        # Store in local memory cache
        local_key = f"{event_id}:{user_id}"
        if local_key not in self._local_notifications:
            self._local_notifications[local_key] = []
        self._local_notifications[local_key].insert(0, payload)
        self._stats["sent_total"] += 1

        # Try persisting to Redis list if available
        if self.redis:
            try:
                redis_key = f"fr:{event_id}:notifs:{user_id}"
                raw = json.dumps(payload)
                if hasattr(self.redis, "lpush"):
                    await self.redis.lpush(redis_key, raw)
                    if hasattr(self.redis, "ltrim"):
                        await self.redis.ltrim(redis_key, 0, 49)  # Keep last 50
                elif hasattr(self.redis, "hset"):
                    # fallback in test fake
                    await self.redis.hset(f"fr:{event_id}:notifs", f"{user_id}:{notif_id}", raw)
            except Exception:
                pass

        return payload

    async def get_user_notifications(self, event_id: str, user_id: str) -> list[dict]:
        """Fetch notifications for a user, checking Redis and falling back to memory."""
        local_key = f"{event_id}:{user_id}"
        results = list(self._local_notifications.get(local_key, []))

        if self.redis:
            try:
                redis_key = f"fr:{event_id}:notifs:{user_id}"
                if hasattr(self.redis, "lrange"):
                    raw_items = await self.redis.lrange(redis_key, 0, 49)
                    if raw_items:
                        parsed = []
                        seen_ids = set()
                        for item in raw_items:
                            try:
                                d = json.loads(item)
                                if d["notification_id"] not in seen_ids:
                                    parsed.append(d)
                                    seen_ids.add(d["notification_id"])
                            except Exception:
                                pass
                        if parsed:
                            return parsed
            except Exception:
                pass

        return results

    async def mark_as_read(self, event_id: str, user_id: str, notification_id: Optional[str] = None) -> int:
        """Mark one or all notifications as read."""
        local_key = f"{event_id}:{user_id}"
        count = 0
        if local_key in self._local_notifications:
            for n in self._local_notifications[local_key]:
                if notification_id is None or n["notification_id"] == notification_id:
                    n["read"] = True
                    count += 1
        return count

    async def get_stats(self, event_id: str) -> dict:
        """Notification delivery metrics."""
        return {
            "event_id": event_id,
            "notifications_sent": self._stats["sent_total"],
            "notifications_failed": self._stats["failed_total"],
        }

    async def reset(self, event_id: str):
        """Clear notification cache for an event."""
        keys_to_del = [k for k in self._local_notifications if k.startswith(f"{event_id}:")]
        for k in keys_to_del:
            del self._local_notifications[k]
        self._stats = {"sent_total": 0, "failed_total": 0}
        if self.redis:
            try:
                pass
            except Exception:
                pass


notification_service = NotificationService()
