"""InventoryService implementation using redis.asyncio and Lua scripts. Owned by [P1]."""

from dataclasses import dataclass
import pathlib
from typing import Optional
import uuid


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

        lua_dir = pathlib.Path(__file__).parent.parent / "lua"
        reserve_code = (lua_dir / "reserve.lua").read_text(encoding="utf-8")
        confirm_code = (lua_dir / "confirm.lua").read_text(encoding="utf-8")
        release_code = (lua_dir / "release.lua").read_text(encoding="utf-8")
        token_bucket_code = (lua_dir / "token_bucket.lua").read_text(encoding="utf-8")
        reap_code = (lua_dir / "reap.lua").read_text(encoding="utf-8")

        self._reserve_script = self.redis.register_script(reserve_code)
        self._confirm_script = self.redis.register_script(confirm_code)
        self._release_script = self.redis.register_script(release_code)
        self._tb_script = self.redis.register_script(token_bucket_code)
        self._reap_script = self.redis.register_script(reap_code)
        cancel_path = lua_dir / "cancel_booking.lua"
        if cancel_path.exists():
            self._cancel_script = self.redis.register_script(cancel_path.read_text(encoding="utf-8"))
        else:
            self._cancel_script = None

    async def seed_event(self, event_id: str, seat_ids: list[str]) -> None:
        """Wipes event keys, fills all+free."""
        keys = [
            f"fr:{event_id}:all",
            f"fr:{event_id}:free",
            f"fr:{event_id}:holds",
            f"fr:{event_id}:owners",
            f"fr:{event_id}:sold",
            f"fr:{event_id}:rids",
        ]
        pipe = self.redis.pipeline()
        pipe.delete(*keys)
        if seat_ids:
            pipe.sadd(f"fr:{event_id}:all", *seat_ids)
            pipe.sadd(f"fr:{event_id}:free", *seat_ids)
        await pipe.execute()

    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult:
        """Atomic reservation of a seat (or any seat if seat_id is None)."""
        rid = uuid.uuid4().hex
        seat_arg = seat_id if seat_id is not None else ""
        keys = [
            f"fr:{event_id}:free",
            f"fr:{event_id}:holds",
            f"fr:{event_id}:owners",
            f"fr:{event_id}:sold",
            f"fr:{event_id}:rids",
        ]
        res = await self._reserve_script(keys=keys, args=[rid, str(self.hold_ttl_ms), seat_arg])
        code = res[0]
        if code == "OK":
            return ReserveResult(
                code="OK",
                seat_id=res[1],
                reservation_id=rid,
                expires_at_ms=int(res[2]),
            )
        return ReserveResult(code=code, seat_id=seat_id)

    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult:
        """Atomic confirmation of a held reservation."""
        keys = [
            f"fr:{event_id}:free",
            f"fr:{event_id}:holds",
            f"fr:{event_id}:owners",
            f"fr:{event_id}:sold",
            f"fr:{event_id}:rids",
            "fr:bookings",
        ]
        res = await self._confirm_script(keys=keys, args=[reservation_id, user_id, event_id])
        code = res[0]
        seat = res[1] if len(res) > 1 else None
        return ConfirmResult(code=code, seat_id=seat)

    async def release(self, event_id: str, reservation_id: str) -> ReleaseResult:
        """Atomic release of a held reservation."""
        keys = [
            f"fr:{event_id}:free",
            f"fr:{event_id}:holds",
            f"fr:{event_id}:owners",
            f"fr:{event_id}:sold",
            f"fr:{event_id}:rids",
        ]
        res = await self._release_script(keys=keys, args=[reservation_id])
        code = res[0]
        seat = res[1] if len(res) > 1 else None
        return ReleaseResult(code=code, seat_id=seat)

    async def cancel_booking(self, event_id: str, reservation_id: str) -> dict:
        """Atomic cancellation of a confirmed booking."""
        keys = [
            f"fr:{event_id}:free",
            f"fr:{event_id}:holds",
            f"fr:{event_id}:owners",
            f"fr:{event_id}:sold",
            f"fr:{event_id}:rids",
        ]
        if self._cancel_script:
            res = await self._cancel_script(keys=keys, args=[reservation_id])
            code = res[0]
            seat = res[1] if len(res) > 1 else None
            return {"code": code, "seat_id": seat}
        # Fallback if script not registered
        st = await self.redis.hget(f"fr:{event_id}:rids", reservation_id)
        if not st or not str(st).startswith("CONFIRMED|"):
            return {"code": "NOT_CONFIRMED", "seat_id": None}
        seat = str(st).split("|")[1]
        await self.redis.hdel(f"fr:{event_id}:sold", seat)
        await self.redis.sadd(f"fr:{event_id}:free", seat)
        await self.redis.hset(f"fr:{event_id}:rids", reservation_id, f"CANCELLED|{seat}")
        return {"code": "OK", "seat_id": seat}

    async def get_reservation(self, event_id: str, reservation_id: str) -> dict | None:
        """Fetch current reservation metadata, status, and authoritative expiry TTL."""
        free_key = f"fr:{event_id}:free"
        holds_key = f"fr:{event_id}:holds"
        owners_key = f"fr:{event_id}:owners"
        rids_key = f"fr:{event_id}:rids"

        # Reap expired holds first to ensure accurate state
        await self._reap_script(keys=[free_key, holds_key, owners_key, rids_key], args=[])

        st = await self.redis.hget(rids_key, reservation_id)
        if not st:
            return None

        # st is in format "STATUS|SEAT_ID"
        status, seat_id = st.split("|", 1)
        expires_at_ms = None
        ttl_ms = 0

        if status == "HELD":
            score = await self.redis.zscore(holds_key, seat_id)
            if score is not None:
                expires_at_ms = int(score)
                t = await self.redis.time()
                now_ms = t[0] * 1000 + t[1] // 1000
                ttl_ms = max(0, expires_at_ms - now_ms)
                if expires_at_ms <= now_ms:
                    status = "EXPIRED"

        return {
            "reservation_id": reservation_id,
            "event_id": event_id,
            "seat_id": seat_id,
            "status": status,
            "expires_at_ms": expires_at_ms,
            "ttl_ms": ttl_ms,
        }

    async def stats(self, event_id: str) -> dict:
        """Counts from SCARD/ZCARD/HLEN after a reap: {"event_id","total","free","held","sold","hold_ttl_ms"}."""
        free_key = f"fr:{event_id}:free"
        holds_key = f"fr:{event_id}:holds"
        owners_key = f"fr:{event_id}:owners"
        sold_key = f"fr:{event_id}:sold"
        rids_key = f"fr:{event_id}:rids"
        all_key = f"fr:{event_id}:all"

        await self._reap_script(keys=[free_key, holds_key, owners_key, rids_key], args=[])

        pipe = self.redis.pipeline()
        pipe.scard(all_key)
        pipe.scard(free_key)
        pipe.zcard(holds_key)
        pipe.hlen(sold_key)
        total, free, held, sold = await pipe.execute()

        return {
            "event_id": event_id,
            "total": int(total),
            "free": int(free),
            "held": int(held),
            "sold": int(sold),
            "hold_ttl_ms": self.hold_ttl_ms,
        }

    async def seat_map(self, event_id: str) -> dict[str, str]:
        """seat_id -> 'FREE' | 'HELD' | 'SOLD'."""
        free_key = f"fr:{event_id}:free"
        holds_key = f"fr:{event_id}:holds"
        owners_key = f"fr:{event_id}:owners"
        sold_key = f"fr:{event_id}:sold"
        rids_key = f"fr:{event_id}:rids"
        all_key = f"fr:{event_id}:all"

        await self._reap_script(keys=[free_key, holds_key, owners_key, rids_key], args=[])

        pipe = self.redis.pipeline()
        pipe.smembers(all_key)
        pipe.zrange(holds_key, 0, -1)
        pipe.hgetall(sold_key)
        all_seats, held_seats, sold_dict = await pipe.execute()

        held_set = set(held_seats)
        result = {}
        for seat in sorted(all_seats):
            if seat in sold_dict:
                result[seat] = "SOLD"
            elif seat in held_set:
                result[seat] = "HELD"
            else:
                result[seat] = "FREE"
        return result

    async def sold_map(self, event_id: str) -> dict[str, str]:
        """seat_id -> reservation_id (HGETALL sold)."""
        sold_key = f"fr:{event_id}:sold"
        return await self.redis.hgetall(sold_key)

    async def allow_request(self, client_key: str) -> tuple[bool, int]:
        """(allowed, tokens_left) via token_bucket.lua."""
        bucket_key = f"fr:rl:{client_key}"
        res = await self._tb_script(keys=[bucket_key], args=[str(self.rl_capacity), str(self.rl_refill_per_sec), "1"])
        allowed = bool(int(res[0]) == 1)
        tokens_left = int(res[1])
        return (allowed, tokens_left)

    async def stream_len(self) -> int:
        """Return the length of stream fr:bookings."""
        return await self.redis.xlen("fr:bookings")
