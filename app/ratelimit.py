"""Rate limiting dependency using token bucket algorithm. Owned by [P2]."""

import json
from fastapi import Request
from app.config import settings
from app.metrics import RESERVE_TOTAL


class APIException(Exception):
    """Base API exception that formats response according to SPEC.md."""
    def __init__(self, status_code: int, error: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.error = error
        self.message = message
        self.headers = headers


class RateLimitExceeded(APIException):
    """Raised when token bucket rate limit is exceeded."""
    def __init__(self, retry_after: int = 1):
        super().__init__(
            status_code=429,
            error="RATE_LIMITED",
            message="Rate limit exceeded. Please retry later.",
            headers={"Retry-After": str(retry_after)},
        )


async def rate_limiter(request: Request) -> None:
    """FastAPI dependency using InventoryService.allow_request(client_key).

    client_key = user_id for reserve (fall back to client IP).
    Respects RL_ENABLED. On denial returns 429 RATE_LIMITED with a Retry-After header.
    """
    if not settings.RL_ENABLED:
        return

    client_key: str | None = None
    try:
        body_bytes = await request.body()
        if body_bytes:
            data = json.loads(body_bytes)
            if isinstance(data, dict):
                user_id = data.get("user_id")
                if user_id:
                    client_key = str(user_id)
    except Exception:
        pass

    if not client_key:
        if request.client and request.client.host:
            client_key = request.client.host
        else:
            client_key = "127.0.0.1"

    inventory = getattr(request.app.state, "inventory", None)
    if inventory is not None:
        try:
            allowed, _ = await inventory.allow_request(client_key)
            if not allowed:
                RESERVE_TOTAL.labels(result="rate_limited").inc()
                raise RateLimitExceeded(retry_after=1)
        except (NotImplementedError, AttributeError):
            pass

