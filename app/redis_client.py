"""Redis client provider using redis.asyncio. Owned by [P1]."""

from typing import Optional
import redis.asyncio as aioredis
from app.config import settings

_redis_client: Optional[aioredis.Redis] = None


def get_redis(url: Optional[str] = None, max_connections: int = 2000) -> aioredis.Redis:
    """Get or create singleton Redis async client."""
    global _redis_client
    target_url = url or settings.REDIS_URL
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            target_url,
            decode_responses=True,
            max_connections=max_connections,
        )
    return _redis_client


async def close_redis() -> None:
    """Close the Redis async client."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
