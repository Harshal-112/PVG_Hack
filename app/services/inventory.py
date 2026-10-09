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

    async def get_reservation(self, event_id: str, reservation_id: str) -> dict | None:
        """Check status and expiration of a reservation in Redis after reaping expired holds."""
        free_key = f"fr:{event_id}:free"
        holds_key = f"fr:{event_id}:holds"
        owners_key = f"fr:{event_id}:owners"
        rids_key = f"fr:{event_id}:rids"

        await self._reap_script(keys=[free_key, holds_key, owners_key, rids_key], args=[])

        st = await self.redis.hget(rids_key, reservation_id)
        if not st:
            return None
        parts = st.split("|", 1)
        status = parts[0]
        seat = parts[1] if len(parts) > 1 else None
        exp = None
        if status == "HELD" and seat:
            exp_score = await self.redis.zscore(holds_key, seat)
            if exp_score is not None:
                exp = int(float(exp_score))
        return {
            "status": status,
            "seat_id": seat,
            "expires_at_ms": exp,
        }


class InMemoryInventory:
    """Robust in-memory inventory implementation with full TTL expiration, hold reaping, and stats."""

    def __init__(self, hold_ttl_ms: int = 120000, rl_capacity: int = 20, rl_refill_per_sec: int = 10):
        self.hold_ttl_ms = hold_ttl_ms
        self.rl_capacity = rl_capacity
        self.rl_refill_per_sec = rl_refill_per_sec
        self.events: dict[str, dict] = {}
        self.bookings_stream: list[dict] = []

    def _get_now_ms(self) -> int:
        import time
        return int(time.time() * 1000)

    def _reap_event(self, ev: dict) -> None:
        now = self._get_now_ms()
        expired_seats = []
        for seat_id, (rid, exp, uid) in list(ev["holds"].items()):
            if exp <= now:
                expired_seats.append((seat_id, rid))
        for seat_id, rid in expired_seats:
            del ev["holds"][seat_id]
            if seat_id not in ev["free"] and seat_id not in ev["sold"]:
                ev["free"].append(seat_id)
                ev["free"].sort()
            if rid in ev["rids"]:
                ev["rids"][rid] = ("EXPIRED", seat_id)

    async def seed_event(self, event_id: str, seat_ids: list[str]) -> None:
        sorted_seats = sorted(list(seat_ids))
        self.events[event_id] = {
            "all": sorted_seats,
            "free": list(sorted_seats),
            "holds": {},  # seat_id -> (rid, exp_ms, user_id)
            "sold": {},   # seat_id -> (rid, user_id, confirmed_at_ms)
            "rids": {},   # rid -> (status, seat_id)
        }

    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult:
        import uuid
        ev = self.events.get(event_id)
        if not ev:
            await self.seed_event(event_id, [f"S{i:03d}" for i in range(1, 201)])
            ev = self.events[event_id]

        self._reap_event(ev)

        if seat_id is None:
            if not ev["free"]:
                return ReserveResult(code="SOLD_OUT")
            seat_id = ev["free"].pop(0)
        else:
            if seat_id in ev["sold"]:
                return ReserveResult(code="SEAT_SOLD", seat_id=seat_id)
            if seat_id in ev["holds"]:
                return ReserveResult(code="SEAT_HELD", seat_id=seat_id)
            if seat_id not in ev["all"]:
                return ReserveResult(code="SEAT_UNKNOWN", seat_id=seat_id)
            if seat_id in ev["free"]:
                ev["free"].remove(seat_id)

        rid = uuid.uuid4().hex
        exp = self._get_now_ms() + self.hold_ttl_ms
        ev["holds"][seat_id] = (rid, exp, user_id)
        ev["rids"][rid] = ("HELD", seat_id)
        return ReserveResult(code="OK", seat_id=seat_id, reservation_id=rid, expires_at_ms=exp)

    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult:
        ev = self.events.get(event_id)
        if not ev:
            return ConfirmResult(code="UNKNOWN")
        self._reap_event(ev)

        st = ev["rids"].get(reservation_id)
        if not st:
            return ConfirmResult(code="UNKNOWN")

        status, seat_id = st
        if status == "CONFIRMED":
            return ConfirmResult(code="ALREADY_CONFIRMED", seat_id=seat_id)
        if status == "EXPIRED":
            return ConfirmResult(code="HOLD_EXPIRED", seat_id=seat_id)
        if status != "HELD":
            return ConfirmResult(code="UNKNOWN", seat_id=seat_id)

        if seat_id in ev["holds"]:
            del ev["holds"][seat_id]
        ev["sold"][seat_id] = (reservation_id, user_id, self._get_now_ms())
        ev["rids"][reservation_id] = ("CONFIRMED", seat_id)
        self.bookings_stream.append({
            "event_id": event_id,
            "seat_id": seat_id,
            "reservation_id": reservation_id,
            "user_id": user_id,
        })
        return ConfirmResult(code="OK", seat_id=seat_id)

    async def release(self, event_id: str, reservation_id: str) -> ReleaseResult:
        ev = self.events.get(event_id)
        if not ev:
            return ReleaseResult(code="UNKNOWN")
        self._reap_event(ev)

        st = ev["rids"].get(reservation_id)
        if not st:
            return ReleaseResult(code="UNKNOWN")

        status, seat_id = st
        if status == "CONFIRMED":
            return ReleaseResult(code="ALREADY_CONFIRMED", seat_id=seat_id)
        if status == "HELD":
            if seat_id in ev["holds"]:
                del ev["holds"][seat_id]
            if seat_id not in ev["free"]:
                ev["free"].append(seat_id)
                ev["free"].sort()
            ev["rids"][reservation_id] = ("RELEASED", seat_id)
            return ReleaseResult(code="OK", seat_id=seat_id)
        return ReleaseResult(code="NOOP", seat_id=seat_id)

    async def get_reservation(self, event_id: str, reservation_id: str) -> dict | None:
        ev = self.events.get(event_id)
        if not ev:
            return None
        self._reap_event(ev)

        st = ev["rids"].get(reservation_id)
        if not st:
            return None

        status, seat_id = st
        hold_tuple = ev["holds"].get(seat_id)
        exp = hold_tuple[1] if (hold_tuple and status == "HELD") else None
        now = self._get_now_ms()
        ttl = max(0, exp - now) if exp else 0

        return {
            "reservation_id": reservation_id,
            "event_id": event_id,
            "seat_id": seat_id,
            "status": status,
            "expires_at_ms": exp,
            "ttl_ms": ttl,
        }

    async def stats(self, event_id: str) -> dict:
        ev = self.events.get(event_id)
        if not ev:
            return {"event_id": event_id, "total": 0, "free": 0, "held": 0, "sold": 0, "hold_ttl_ms": self.hold_ttl_ms}
        self._reap_event(ev)
        return {
            "event_id": event_id,
            "total": len(ev["all"]),
            "free": len(ev["free"]),
            "held": len(ev["holds"]),
            "sold": len(ev["sold"]),
            "hold_ttl_ms": self.hold_ttl_ms,
        }

    async def seat_map(self, event_id: str) -> dict[str, str]:
        ev = self.events.get(event_id)
        if not ev:
            await self.seed_event(event_id, [f"S{i:03d}" for i in range(1, 201)])
            ev = self.events[event_id]
        self._reap_event(ev)
        res = {}
        for s in ev["all"]:
            if s in ev["sold"]:
                res[s] = "SOLD"
            elif s in ev["holds"]:
                res[s] = "HELD"
            else:
                res[s] = "FREE"
        return res

    async def sold_map(self, event_id: str) -> dict[str, str]:
        ev = self.events.get(event_id)
        if not ev:
            return {}
        return {s: info[0] for s, info in ev["sold"].items()}

    async def allow_request(self, client_key: str) -> tuple[bool, int]:
        return (True, self.rl_capacity)

    async def stream_len(self) -> int:
        return len(self.bookings_stream)


