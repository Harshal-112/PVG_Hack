"""InventoryService interface and implementations. Owned by [P1]."""

from dataclasses import dataclass


@dataclass
class ReserveResult:
    code: str  # OK | SOLD_OUT | SEAT_SOLD | SEAT_HELD | SEAT_UNKNOWN
    seat_id: str | None = None
    reservation_id: str | None = None  # uuid4 hex, generated in Python
    expires_at_ms: int | None = None


@dataclass
class ConfirmResult:
    code: str  # OK | ALREADY_CONFIRMED | HOLD_EXPIRED | UNKNOWN
    seat_id: str | None = None


@dataclass
class ReleaseResult:
    code: str  # OK | NOOP | ALREADY_CONFIRMED | UNKNOWN
    seat_id: str | None = None


class InventoryService:
    def __init__(self, redis, hold_ttl_ms: int, rl_capacity: int, rl_refill_per_sec: int):
        self.redis = redis
        self.hold_ttl_ms = hold_ttl_ms
        self.rl_capacity = rl_capacity
        self.rl_refill_per_sec = rl_refill_per_sec

    async def seed_event(self, event_id: str, seat_ids: list[str]) -> None:
        """Wipes event keys, fills all+free."""
        raise NotImplementedError

    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult:
        """Reserve a seat or any free seat."""
        raise NotImplementedError

    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult:
        """Confirm a held seat."""
        raise NotImplementedError

    async def release(self, event_id: str, reservation_id: str) -> ReleaseResult:
        """Release a held seat."""
        raise NotImplementedError

    async def stats(self, event_id: str) -> dict:
        """Counts from SCARD/ZCARD/HLEN after a reap: {"event_id","total","free","held","sold","hold_ttl_ms"}"""
        raise NotImplementedError

    async def seat_map(self, event_id: str) -> dict[str, str]:
        """seat_id -> 'FREE' | 'HELD' | 'SOLD'"""
        raise NotImplementedError

    async def sold_map(self, event_id: str) -> dict[str, str]:
        """seat_id -> reservation_id (HGETALL sold)"""
        raise NotImplementedError

    async def allow_request(self, client_key: str) -> tuple[bool, int]:
        """(allowed, tokens_left) via token_bucket.lua"""
        raise NotImplementedError

    async def stream_len(self) -> int:
        """Return the length of stream fr:bookings."""
        raise NotImplementedError
