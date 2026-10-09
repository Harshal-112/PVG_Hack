# FlashSeat: SPEC.md (SINGLE SOURCE OF TRUTH)

Hack-a-Night 2026, Problem 9: High-Contention Flash-Reservation & Seat Inventory Locking Engine.
If anything in a prompt, chat, or your own assumptions conflicts with this file, THIS FILE WINS.
If something is not specified here, do not invent it. Add a `TODO(question): ...` comment and tell the human.

---

## 1. Goal and judging criteria (from the problem statement)

Build an application-tier reservation engine that:
1. Takes write traffic OFF the relational DB by using an in-memory transactional inventory broker (Redis + Lua scripts).
2. Enforces temporary holds with TTL; abandoned or timed-out holds are released instantly.
3. Eliminates race conditions: zero double-bookings.
4. Writes finalized bookings to Postgres asynchronously (eventual consistency, guaranteed).
5. Includes a token-bucket rate limiter.
6. Is proven by a headless load test: 5,000+ concurrent requests competing for 200 inventory units, with zero double-bookings, strict first-come-first-served, sub-second hold locks, instant release on timeout/abandonment, and Redis/Postgres consistency after the queue drains.

Our differentiator: a BASELINE (naive DB locking) that fails under the same load, shown side by side with our engine.

---

## 2. Architecture

```
 k6 (5000 VUs) / Web UI
        |
        v
 FastAPI (uvicorn, N workers, stateless)  --- Prometheus /metrics
        |  1 Lua call per operation (atomic)
        v
 Redis 7 (single instance)  <-- inventory, holds, rate-limit buckets, Stream "fr:bookings"
        |  XADD happens INSIDE the confirm Lua script (atomic with the state change)
        v
 Writer worker(s) (consumer group "pg-writers") --batch INSERT--> Postgres 16
```

Hard rules:
- Every inventory state change goes through ONE Lua script. Never read-then-write inventory from Python.
- Postgres is never on the reserve/hold path. It is touched only by the writer worker, the verify endpoint, the baseline endpoints, and admin reset.
- API processes hold no state in memory (we run multiple workers).
- Single Redis instance only (no cluster). Lua scripts rely on that.

---

## 3. Tech stack (fixed, do not substitute)

| Layer | Choice |
|---|---|
| Language | Python 3.12 |
| API | FastAPI + uvicorn[standard] (run with 4 workers in compose) |
| Redis client | `redis` (redis-py) >= 5, use `redis.asyncio`. Load Lua with `register_script` |
| Postgres client | `asyncpg` >= 0.29 |
| Models | pydantic v2 |
| Metrics | `prometheus-client` |
| Tests | pytest, pytest-asyncio, httpx |
| Infra | Docker Compose: `redis:7-alpine`, `postgres:16-alpine`, app image, worker image, `grafana/k6` |
| Load test | k6 (JavaScript scripts) |
| Frontend | Plain HTML + vanilla JS, NO build step, NO npm. Served by FastAPI StaticFiles at `/ui` |

Before using any library API, check the installed version (`pip show <pkg>`) and use only APIs that exist in it. Do not guess method names.

---

## 4. Repo layout and OWNERSHIP

Each person edits ONLY their own paths (this avoids merge conflicts).

```
flashseat/
  SPEC.md, AGENTS.md, README.md, .env.example, .gitignore
  docker-compose.yml, Dockerfile, requirements.txt          [P2]
  app/
    __init__.py
    config.py            settings from env                    [P1]
    redis_client.py      get_redis()                          [P1]
    lua/
      reap.lua           (shared snippet, inlined, see 7)     [P1]
      reserve.lua  confirm.lua  release.lua  token_bucket.lua [P1]
    services/
      inventory.py       InventoryService (section 8)         [P1]
    main.py              FastAPI app, lifespan, static mount  [P2]
    routes/
      reservations.py    reserve/confirm/release              [P2]
      events.py          stats, seats, verify                 [P2]
      admin.py           seed/reset                           [P2]
      baseline.py        baseline endpoints                   [P3]
    ratelimit.py         dependency using allow_request       [P2]
    metrics.py           prometheus counters/histograms       [P2]
    db.py                asyncpg pool + queries (section 10)  [P3]
    schema.sql           Postgres DDL                         [P3]
    worker/
      writer.py          stream consumer -> Postgres          [P3]
  loadtest/
    k6_flash.js  k6_baseline.js  verify.py  README.md         [P4]
    results/             (gitignored except .gitkeep)
  tests/
    test_lua_atomicity.py  test_inventory.py                  [P1]
    test_api.py                                               [P4]
  scripts/
    demo.sh  seed.sh                                          [P4]
  web/
    index.html  dashboard.html  app.js  style.css             [P5]
```

---

## 5. Environment variables (exact names)

| Var | Default | Meaning |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379/0` | |
| `DATABASE_URL` | `postgresql://flash:flash@postgres:5432/flash` | |
| `HOLD_TTL_MS` | `120000` | hold duration. Use `5000` for the timeout demo |
| `RL_ENABLED` | `true` | token bucket on/off |
| `RL_CAPACITY` | `20` | bucket size per client key |
| `RL_REFILL_PER_SEC` | `10` | refill rate |
| `PG_POOL_MAX` | `10` | app pool for Postgres |
| `BASELINE_POOL_MAX` | `10` | deliberately small pool for the baseline |
| `WRITER_BATCH` | `200` | stream read batch |
| `WRITER_BLOCK_MS` | `500` | |
| `DEFAULT_EVENT_ID` | `evt1` | |
| `DEFAULT_SEAT_COUNT` | `200` | |

Seat ids are `S001` ... `S200` (zero padded to 3 digits). `user_id` is a string, 1 to 64 chars.

---

## 6. Redis data model (single instance, prefix `fr:`)

Per event `{e}`:

| Key | Type | Content |
|---|---|---|
| `fr:{e}:free` | SET | seat ids currently available |
| `fr:{e}:holds` | ZSET | member = seat id, score = hold expiry (epoch ms) |
| `fr:{e}:owners` | HASH | seat id -> reservation_id currently holding it |
| `fr:{e}:sold` | HASH | seat id -> reservation_id that confirmed it |
| `fr:{e}:rids` | HASH | reservation_id -> `STATUS\|seat` with STATUS in HELD, CONFIRMED, RELEASED, EXPIRED |
| `fr:{e}:all` | SET | all seat ids of the event (for seat map) |

Global:

| Key | Type | Content |
|---|---|---|
| `fr:bookings` | STREAM | confirmed bookings. Fields: `event_id, seat_id, reservation_id, user_id, confirmed_at_ms` |
| `fr:rl:{client_key}` | HASH | token bucket state `tokens, ts` |

Invariant: every seat of an event is in EXACTLY ONE of: `free`, `owners` (held), `sold`.

Expiry design: Redis key TTLs cannot return a seat to the free set, so holds live in the ZSET `holds` with an expiry score. Every Lua script begins by "reaping" expired holds (moving them back to `free`). Therefore a timed-out seat is reservable again at the very next request: instant release, no dependency on a background timer. (Optional: a reaper loop in the API calling the reap-only path every 500 ms keeps the dashboard numbers fresh. It is not needed for correctness.)

---

## 7. Lua scripts (reference implementations; P1 may refine but MUST keep the return contract)

Common: time is taken from Redis (`TIME`), never from the client. All scripts return arrays of strings.

### reap snippet (pasted at the top of reserve, confirm, release)

```lua
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local function reap(free, holds, owners, rids)
  local expired = redis.call('ZRANGEBYSCORE', holds, '-inf', now)
  for _, seat in ipairs(expired) do
    local rid = redis.call('HGET', owners, seat)
    redis.call('ZREM', holds, seat)
    redis.call('HDEL', owners, seat)
    redis.call('SADD', free, seat)
    if rid then redis.call('HSET', rids, rid, 'EXPIRED|' .. seat) end
  end
end
```

### reserve.lua
KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids. ARGV: 1 rid, 2 ttl_ms, 3 seat (empty string = any seat).

```lua
reap(KEYS[1], KEYS[2], KEYS[3], KEYS[5])   -- (free, holds, owners, rids)
local seat = ARGV[3]
if seat == '' then
  seat = redis.call('SPOP', KEYS[1])
  if not seat then return {'SOLD_OUT'} end
else
  if redis.call('SREM', KEYS[1], seat) == 0 then
    if redis.call('HEXISTS', KEYS[4], seat) == 1 then return {'SEAT_SOLD'} end
    if redis.call('HEXISTS', KEYS[3], seat) == 1 then return {'SEAT_HELD'} end
    return {'SEAT_UNKNOWN'}
  end
end
local exp = now + tonumber(ARGV[2])
redis.call('ZADD', KEYS[2], exp, seat)
redis.call('HSET', KEYS[3], seat, ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], 'HELD|' .. seat)
return {'OK', seat, tostring(exp)}
```
Returns: `{'OK', seat, expires_at_ms}` | `{'SOLD_OUT'}` | `{'SEAT_SOLD'}` | `{'SEAT_HELD'}` | `{'SEAT_UNKNOWN'}`.

### confirm.lua
KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids, 6 stream (`fr:bookings`). ARGV: 1 rid, 2 user_id, 3 event_id.

```lua
reap(KEYS[1], KEYS[2], KEYS[3], KEYS[5])
local st = redis.call('HGET', KEYS[5], ARGV[1])
if not st then return {'UNKNOWN'} end
local status, seat = string.match(st, '^(%u+)|(.+)$')
if status == 'CONFIRMED' then return {'ALREADY_CONFIRMED', seat} end
if status ~= 'HELD' then return {'HOLD_EXPIRED', seat} end
if redis.call('HGET', KEYS[3], seat) ~= ARGV[1] then return {'HOLD_EXPIRED', seat} end
redis.call('ZREM', KEYS[2], seat)
redis.call('HDEL', KEYS[3], seat)
redis.call('HSET', KEYS[4], seat, ARGV[1])
redis.call('HSET', KEYS[5], ARGV[1], 'CONFIRMED|' .. seat)
redis.call('XADD', KEYS[6], '*', 'event_id', ARGV[3], 'seat_id', seat,
           'reservation_id', ARGV[1], 'user_id', ARGV[2], 'confirmed_at_ms', tostring(now))
return {'OK', seat}
```
Returns: `{'OK', seat}` | `{'ALREADY_CONFIRMED', seat}` (idempotent retry) | `{'HOLD_EXPIRED', seat}` | `{'UNKNOWN'}`.

### release.lua
KEYS: 1 free, 2 holds, 3 owners, 4 sold, 5 rids. ARGV: 1 rid.

```lua
reap(KEYS[1], KEYS[2], KEYS[3], KEYS[5])
local st = redis.call('HGET', KEYS[5], ARGV[1])
if not st then return {'UNKNOWN'} end
local status, seat = string.match(st, '^(%u+)|(.+)$')
if status == 'CONFIRMED' then return {'ALREADY_CONFIRMED', seat} end
if status ~= 'HELD' then return {'NOOP', seat} end
redis.call('ZREM', KEYS[2], seat)
redis.call('HDEL', KEYS[3], seat)
redis.call('SADD', KEYS[1], seat)
redis.call('HSET', KEYS[5], ARGV[1], 'RELEASED|' .. seat)
return {'OK', seat}
```

### token_bucket.lua
KEYS: 1 bucket key. ARGV: 1 capacity, 2 refill_per_sec, 3 cost (1).

```lua
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local cap, rate, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens, ts = tonumber(b[1]), tonumber(b[2])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + (now - ts) * rate / 1000)
local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000) * 2)
return {allowed, math.floor(tokens)}
```

---

## 8. InventoryService interface (P1 implements; P2, P4, P5 depend on it, so DO NOT change signatures)

File `app/services/inventory.py`:

```python
from dataclasses import dataclass

@dataclass
class ReserveResult:
    code: str                    # OK | SOLD_OUT | SEAT_SOLD | SEAT_HELD | SEAT_UNKNOWN
    seat_id: str | None = None
    reservation_id: str | None = None   # uuid4 hex, generated in Python
    expires_at_ms: int | None = None

@dataclass
class ConfirmResult:
    code: str                    # OK | ALREADY_CONFIRMED | HOLD_EXPIRED | UNKNOWN
    seat_id: str | None = None

@dataclass
class ReleaseResult:
    code: str                    # OK | NOOP | ALREADY_CONFIRMED | UNKNOWN
    seat_id: str | None = None

class InventoryService:
    def __init__(self, redis, hold_ttl_ms: int, rl_capacity: int, rl_refill_per_sec: int): ...
    async def seed_event(self, event_id: str, seat_ids: list[str]) -> None   # wipes event keys, fills all+free
    async def reserve(self, event_id: str, user_id: str, seat_id: str | None = None) -> ReserveResult
    async def confirm(self, event_id: str, reservation_id: str, user_id: str) -> ConfirmResult
    async def release(self, event_id: str, reservation_id: str) -> ReleaseResult
    async def stats(self, event_id: str) -> dict
        # {"event_id","total","free","held","sold","hold_ttl_ms"}  (counts from SCARD/ZCARD/HLEN after a reap)
    async def seat_map(self, event_id: str) -> dict[str, str]
        # seat_id -> "FREE" | "HELD" | "SOLD"
    async def sold_map(self, event_id: str) -> dict[str, str]
        # seat_id -> reservation_id (HGETALL sold)
    async def allow_request(self, client_key: str) -> tuple[bool, int]
        # (allowed, tokens_left) via token_bucket.lua
    async def stream_len(self) -> int
```

---

## 9. HTTP API contract (P2 implements; P4 and P5 consume; base path `/api/v1`)

Error body is always `{"error": "<CODE>", "message": "<human text>"}`.

| Method + path | Request | Success | Errors |
|---|---|---|---|
| `POST /events/{e}/reserve` | `{"user_id": str, "seat_id": str \| null}` | `201 {"reservation_id","seat_id","expires_at_ms","ttl_ms"}` | `409 SEAT_HELD / SEAT_SOLD / SOLD_OUT`, `404 SEAT_UNKNOWN`, `429 RATE_LIMITED` (+ `Retry-After` header), `422` bad body |
| `POST /events/{e}/reservations/{rid}/confirm` | `{"user_id": str}` | `200 {"status":"CONFIRMED","seat_id", "idempotent": bool}` | `410 HOLD_EXPIRED`, `404 UNKNOWN` |
| `DELETE /events/{e}/reservations/{rid}` | none | `200 {"status":"RELEASED"\|"NOOP","seat_id"}` | `409 ALREADY_CONFIRMED`, `404 UNKNOWN` |
| `GET /events/{e}/stats` | none | `200 {"event_id","total","free","held","sold","persisted","backlog","hold_ttl_ms"}` where `persisted` = rows in Postgres `bookings` and `backlog = sold - persisted` | |
| `GET /events/{e}/seats` | none | `200 {"seats": {"S001":"FREE", ...}}` | |
| `GET /events/{e}/verify` | none | `200` see below | |
| `POST /admin/events` | `{"event_id": str, "seat_count": int}` | `201 {"event_id","seat_count"}`: seeds Redis, clears Postgres rows for the event, seeds baseline seats | |
| `POST /admin/events/{e}/reset` | none | `200` same effect as seed with existing seat count | |
| `GET /healthz` | none | `200 {"ok": true}` | |
| `GET /metrics` | none | Prometheus text | |

`GET /events/{e}/verify` response (waits up to 5 s for backlog to reach 0, then reports):
```json
{
  "event_id": "evt1",
  "redis_sold": 200,
  "pg_bookings": 200,
  "drained": true,
  "duplicate_seat_rows": 0,
  "missing_in_pg": [],
  "extra_in_pg": [],
  "consistent": true,
  "no_double_booking": true
}
```
`no_double_booking` is true when no seat appears in more than one booking row AND `pg_bookings <= total`.

Baseline endpoints (P3, same `/api/v1` prefix):
- `POST /baseline/events/{e}/reserve?mode=naive|pessimistic`, body `{"user_id": str}`. Responses: `201 {"seat_id"}`, `409 SOLD_OUT`, `503 DB_POOL_TIMEOUT` (pool exhausted or statement timeout).
- `GET /baseline/events/{e}/verify` returns `{"booked_rows", "distinct_seats", "double_bookings"}`.

Reserve semantics: `seat_id = null` means "give me any free seat" (SPOP). A specific `seat_id` means that exact seat.
`reservation_id` is an unguessable secret (uuid4 hex) and acts as the capability for confirm/release.

---

## 10. Postgres and the writer (P3)

`app/schema.sql` (run on startup with `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  seat_id         TEXT NOT NULL,
  reservation_id  TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  confirmed_at    TIMESTAMPTZ NOT NULL,
  persisted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, seat_id)          -- DB-level safety net: a double booking is physically impossible
);
CREATE TABLE IF NOT EXISTS booking_conflicts (
  id BIGSERIAL PRIMARY KEY, event_id TEXT, seat_id TEXT, reservation_id TEXT,
  user_id TEXT, seen_at TIMESTAMPTZ DEFAULT now(), note TEXT
);
CREATE TABLE IF NOT EXISTS baseline_seats (
  event_id TEXT NOT NULL, seat_id TEXT NOT NULL, booked_by TEXT,
  PRIMARY KEY (event_id, seat_id)
);
CREATE TABLE IF NOT EXISTS baseline_bookings (
  id BIGSERIAL PRIMARY KEY, event_id TEXT NOT NULL, seat_id TEXT NOT NULL,
  user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
  -- intentionally NO unique constraint, so the naive mode can show double bookings
);
```

`app/db.py` interface (P2 and P4 call these; do not rename):

```python
async def init_pool() -> None            # creates pool (PG_POOL_MAX) and runs schema.sql
async def close_pool() -> None
async def reset_event(event_id: str) -> None            # delete bookings + baseline rows for event
async def seed_baseline(event_id: str, seat_ids: list[str]) -> None
async def count_bookings(event_id: str) -> int
async def booked_seats(event_id: str) -> dict[str, str]  # seat_id -> reservation_id
async def duplicate_seat_rows(event_id: str) -> int      # seats with >1 row (always 0 for bookings)
```

Writer (`app/worker/writer.py`), runnable as `python -m app.worker.writer`:
- Consumer group `pg-writers` on stream `fr:bookings` (create with `XGROUP CREATE ... MKSTREAM`, ignore BUSYGROUP).
- Loop: `XREADGROUP` with `WRITER_BATCH` and `WRITER_BLOCK_MS`; insert the batch in ONE transaction with `ON CONFLICT (reservation_id) DO NOTHING`; `XACK` only AFTER the commit succeeds.
- On start and every 30 s, run `XAUTOCLAIM` for entries idle > 30 s to recover from a crashed writer.
- If an insert violates `UNIQUE(event_id, seat_id)` with a different reservation_id: write a row to `booking_conflicts`, log CRITICAL, XACK (never loop forever).
- Must be safe to run 2 writer instances at once (distinct consumer names).
- Exposes counters `writer_inserted_total`, `writer_batches_total` (simple log lines are fine if no HTTP server).

---

## 11. Baseline (P3): what we compare against

Both modes use a table `baseline_seats` and the SMALL pool (`BASELINE_POOL_MAX`):
- `naive`: `SELECT seat_id ... WHERE booked_by IS NULL LIMIT 1`, then separately `UPDATE ... SET booked_by=$1 WHERE seat_id=$2`, then `INSERT INTO baseline_bookings`. No locking. Under concurrency this produces double allocations (several users get the same seat).
- `pessimistic`: one transaction, `SELECT ... WHERE booked_by IS NULL ORDER BY seat_id LIMIT 1 FOR UPDATE`, update, insert, commit. Correct but serializes on hot rows, exhausts the pool, and times out at 5,000 concurrent requests. Use `asyncpg` pool acquire timeout 2 s and `statement_timeout` 3 s; map failures to `503 DB_POOL_TIMEOUT`.

Do not make the baseline artificially worse than a normal implementation would be. Judges will probe it. Report honest numbers.

---

## 12. Load test spec (P4)

`loadtest/k6_flash.js`, run via the compose `k6` service on the same Docker network (BASE_URL=`http://app:8000`).

Env knobs: `BASE_URL`, `EVENT_ID` (default `evt1`), `VUS` (default 5000), `MODE` (`any` | `hot`), `CONFIRM_RATIO` (default 0.9), `TARGET` (`engine` | `baseline`).
- Scenario: `per-vu-iterations`, 1 iteration per VU, `VUS` VUs, so 5,000 near-simultaneous reserve attempts.
- `user_id = "u-" + __VU` (unique per VU, so the per-user rate limit does not distort results).
- `MODE=hot`: each VU requests a random seat `S001..S200`. `MODE=any`: `seat_id` null.
- After a successful reserve, with probability `CONFIRM_RATIO` call confirm; otherwise abandon (no call).
- Use `http.setResponseCallback(http.expectedStatuses(200, 201, 409, 410, 429))` so 409 conflicts are not counted as failures.
- Custom counters: `reserve_ok`, `reserve_conflict`, `reserve_rate_limited`, `confirm_ok`, `confirm_expired`; trend `reserve_latency_ms`.
- Thresholds (informational, print them): `reserve_latency_ms p(95) < 1000`.
- `--summary-export loadtest/results/<name>.json`.

`loadtest/verify.py` after a run: calls `/events/{e}/verify`, prints PASS/FAIL for each invariant in section 13, writes `loadtest/results/summary.md` (counts, latencies, PASS/FAIL table).

Abandonment demo (separate run): `HOLD_TTL_MS=5000`, `CONFIRM_RATIO=0.0`, then wait 6 s: `free` must equal `total` again; run a second wave and confirm all 200 are bookable.

---

## 13. Invariants and acceptance tests (the definition of DONE)

| # | Check | Expected |
|---|---|---|
| A1 | After the 5,000 VU run (MODE=any, CONFIRM_RATIO=1.0): `sold` | exactly 200 |
| A2 | Same run: `pg_bookings` after drain | exactly 200, `drained=true` |
| A3 | `duplicate_seat_rows` | 0 |
| A4 | MODE=hot, CONFIRM_RATIO=0.9: `sold` | <= 200 and `no_double_booking=true` |
| A5 | Every seat is in exactly one of free/held/sold | holds at all times (test in `tests/`) |
| A6 | 1,000 concurrent `reserve` on the SAME seat (pytest, asyncio.gather) | exactly 1 `OK`, 999 conflicts |
| A7 | Confirm twice with the same reservation_id | 200 both times, second has `idempotent=true`, ONE row in Postgres |
| A8 | Hold expiry: reserve with 1 s TTL, wait 1.2 s, another user reserves same seat | succeeds |
| A9 | Confirm after expiry | 410 `HOLD_EXPIRED` |
| A10 | Kill the writer, confirm 50 bookings, restart writer | all 50 land in Postgres, no duplicates |
| A11 | `reserve` p95 latency at 5,000 VUs | < 1,000 ms (record the real number even if it misses) |
| A12 | Baseline `naive` at the same load | shows `double_bookings > 0` |
| A13 | Baseline `pessimistic` at the same load | shows 503s and/or much higher p95; zero double bookings |
| A14 | `docker compose up --build` from a clean clone | everything starts, `/healthz` ok, UI loads |

---

## 14. Demo script (5 minutes)

1. Show the problem (30 s): run the baseline naive and pessimistic load; show double bookings and 503s.
2. Show our architecture (30 s): one slide, the diagram in section 2.
3. Live run (2 min): open the dashboard, fire 5,000 VUs at the engine; show free/held/sold moving, then `verify` printing PASS.
4. Abandonment (1 min): TTL 5 s, abandon holds, watch seats return to free instantly.
5. Kill the writer mid-run, restart it, show backlog drain to 0 (eventual consistency).
6. Close (1 min): results table engine vs baseline.

Always have a recorded video of the full run as a fallback.

---

## 15. Out of scope (do NOT build)

Authentication, payments, real seat maps, multi-event pricing, Redis Cluster/Sentinel, Kubernetes, microservice splits, any frontend framework/build tool, any extra database. If time remains after A1 to A14 pass, prefer: Grafana dashboard, then Kubernetes manifests.
