# FlashSeat: Antigravity prompts (one per person)

## Before anyone starts

1. Lead (P1) creates a GitHub repo `flashseat`, adds `SPEC.md` and `AGENTS.md` to the root, pushes, and adds the 4 teammates as collaborators.
2. Everyone clones the repo and opens the folder in Antigravity.
3. Everyone installs Docker Desktop and Git (check: `docker --version`, `git --version`).
4. Lead runs PROMPT 0 first (scaffold, about 30 to 40 minutes). Teammates wait for the "scaffold pushed" message, and meanwhile read SPEC.md sections 1, 2 and their own section.
5. If Antigravity does not auto-load `AGENTS.md`, start every new agent session with: "Read AGENTS.md and SPEC.md fully first."

## Git for beginners (give this to teammates as is)

Each person works on their own branch and only touches their own folders.

```
git pull
git checkout -b p2-api            # use your own branch name: p2-api, p3-db, p4-loadtest, p5-ui
# ...work with Antigravity...
git add .
git commit -m "api: reserve endpoint"
git push -u origin p2-api
```
Commit and push at least every hour. Lead merges branches into `main` at hours 8, 14, 20. After a merge announcement, everyone runs `git checkout main && git pull && git checkout <your-branch> && git merge main`.

## Timeline (24 h)

| Hours | What |
|---|---|
| 0 to 1 | P1 scaffold (PROMPT 0). Others set up Docker and read the spec |
| 1 to 8 | Everyone builds their part against SPEC contracts. P1 finishes Lua + InventoryService first |
| 8 | MERGE 1: run `docker compose up --build`, reserve and confirm one seat end to end |
| 8 to 14 | Writer worker, verify endpoint, k6 script, seat grid UI, baseline |
| 14 | MERGE 2: first full 5,000 VU run, fix what breaks |
| 14 to 20 | Dashboard, baseline comparison, A1 to A14 acceptance checks, README |
| 20 to 22 | Polish, record the backup video |
| 22 to 24 | Rehearse the demo 3 times. No new features |

---

## PROMPT 0 + PROMPT 1: P1 (LEAD): scaffold, then the core engine

```
You are building FlashSeat inside this repo. First read AGENTS.md and SPEC.md completely and follow them strictly. SPEC.md is the single source of truth; do not invent endpoints, keys, env vars, or signatures.

I am P1 (lead). My owned paths are in SPEC.md section 4 under [P1], plus the initial scaffold below.

PHASE 0: SCAFFOLD (do this first, I will push it so teammates can start)
Create the full folder structure from SPEC.md section 4 with:
- Empty-but-importable Python modules (with module docstrings and the exact function/class signatures from SPEC.md sections 8, 9 and 10 raising NotImplementedError), so teammates can code against them immediately.
- requirements.txt with the libraries from SPEC.md section 3 (do not pin versions you have not verified; check what pip resolves and pin those).
- Dockerfile (python:3.12-slim) and docker-compose.yml with services: redis (redis:7-alpine), postgres (postgres:16-alpine, user/password/db all "flash"), app (uvicorn app.main:app with 4 workers), worker (python -m app.worker.writer), and a k6 service using grafana/k6 behind a compose profile "loadtest". Add healthchecks for redis and postgres, and make app and worker wait for them.
- .env.example with every variable in SPEC.md section 5, .gitignore, and a minimal README with the run commands.
- app/main.py with only GET /healthz so `docker compose up --build` works from the start.
Verify: `docker compose up --build -d` then `curl localhost:8000/healthz` returns {"ok": true}. Paste the output. Then stop and tell me "scaffold ready to push".

PHASE 1: CORE ENGINE (my real work)
1. Create app/lua/reserve.lua, confirm.lua, release.lua, token_bucket.lua using the reference implementations in SPEC.md section 7. Keep the return contracts exactly. Include the reap snippet in each script.
2. Implement app/services/inventory.py exactly per SPEC.md section 8 using redis.asyncio and register_script. Generate reservation_id as uuid4().hex in Python. Build keys exactly as in SPEC.md section 6.
3. Implement app/config.py (read env vars from SPEC.md section 5 with the stated defaults) and app/redis_client.py (get_redis()).
4. Write tests/test_lua_atomicity.py and tests/test_inventory.py that prove SPEC.md acceptance rows A5, A6, A7, A8, A9 (use asyncio.gather for 1,000 concurrent reserves on one seat; expect exactly 1 OK).
Verify: run pytest against the compose redis and paste the real output. Do not claim success without it.

Constraints: do not touch files owned by P2 to P5. Do not change signatures in SPEC.md. If you believe the spec has a bug (for example in a Lua script), explain it to me before changing it.
```

---

## PROMPT 2: P2: API layer, rate limiting, metrics, Docker

```
Read AGENTS.md and SPEC.md completely and follow them strictly. SPEC.md is the single source of truth.

I am P2. My owned paths (SPEC.md section 4, [P2]): docker-compose.yml, Dockerfile, requirements.txt, app/main.py, app/routes/reservations.py, app/routes/events.py, app/routes/admin.py, app/ratelimit.py, app/metrics.py. Do not edit anything else.

The InventoryService (P1) and app/db.py (P3) are being written in parallel. Code against their interfaces in SPEC.md sections 8 and 10 exactly. While they are still stubs, you may write a throwaway FakeInventory inside tests/ only (not in app/) to test your routes.

Tasks:
1. FastAPI app in app/main.py: lifespan creates the Redis client, InventoryService, calls db.init_pool(); closes both on shutdown. Mount the folder `web/` with StaticFiles at /ui. Add GET /healthz and GET /metrics.
2. Implement every endpoint in SPEC.md section 9 EXCEPT the baseline ones (P3 owns those): reserve, confirm, release, stats, seats, verify, admin create/reset. Status codes, JSON shapes and error bodies must match the table exactly. Use pydantic v2 models.
3. app/ratelimit.py: a FastAPI dependency using InventoryService.allow_request(client_key) with client_key = user_id for reserve (fall back to client IP). Respect RL_ENABLED. On denial return 429 RATE_LIMITED with a Retry-After header.
4. app/metrics.py: prometheus counters/histograms: reserve_total{result}, confirm_total{result}, request_latency_seconds{route}. Wire them in via middleware or in the routes.
5. verify endpoint logic: poll stats until backlog == 0 or 5 seconds pass, then compute the response in SPEC.md section 9 (use inventory.sold_map and db.booked_seats and db.duplicate_seat_rows).
6. Make sure uvicorn runs with 4 workers in docker-compose and that the app is stateless.
Verify: with the stack up, use curl to reserve, confirm (twice, second must be idempotent) and release; paste the responses. Run `curl localhost:8000/metrics | head`. Do not claim anything works without pasting real output.
```

---

## PROMPT 3: P3: Postgres, async writer worker, baseline

```
Read AGENTS.md and SPEC.md completely and follow them strictly. SPEC.md is the single source of truth.

I am P3. My owned paths (SPEC.md section 4, [P3]): app/db.py, app/schema.sql, app/worker/writer.py, app/routes/baseline.py. Do not edit anything else.

Tasks:
1. app/schema.sql: exactly the DDL from SPEC.md section 10.
2. app/db.py with asyncpg: init_pool() (pool size PG_POOL_MAX, runs schema.sql), close_pool(), reset_event, seed_baseline, count_bookings, booked_seats, duplicate_seat_rows. Signatures must match SPEC.md section 10 exactly. The baseline uses a SEPARATE small pool sized BASELINE_POOL_MAX.
3. app/worker/writer.py, runnable as `python -m app.worker.writer`, per SPEC.md section 10: consumer group "pg-writers" on stream "fr:bookings"; XREADGROUP batches; one transaction per batch with ON CONFLICT (reservation_id) DO NOTHING; XACK only after commit; XAUTOCLAIM for stuck entries; booking_conflicts handling for the UNIQUE(event_id, seat_id) violation; safe with 2 instances running. Use redis.asyncio and asyncpg. Convert confirmed_at_ms to timestamptz.
4. app/routes/baseline.py exposing an APIRouter with the baseline endpoints from SPEC.md section 9 and the two modes (naive, pessimistic) from SPEC.md section 11. Export the router as `router`; P2 will include it in main.py (tell the human to ask P2 to add `app.include_router(baseline.router, prefix="/api/v1")` if it is not there yet). Be honest: the pessimistic mode must be a correct, normal implementation with SELECT ... FOR UPDATE; the pool timeout and statement_timeout are what make it fail under load.
Verify: (a) start redis and postgres, XADD 3 fake entries to fr:bookings by hand using redis-cli, run the writer, and show 3 rows in the bookings table via psql; (b) kill the writer, XADD 5 more, restart it, show 8 rows total and no duplicates; (c) call the baseline naive endpoint with 200 concurrent requests using a small Python asyncio script and show double_bookings from the baseline verify endpoint. Paste real output for each.
```

---

## PROMPT 4: P4: load test, verification, API tests, demo scripts

```
Read AGENTS.md and SPEC.md completely and follow them strictly. SPEC.md is the single source of truth.

I am P4. My owned paths (SPEC.md section 4, [P4]): loadtest/*, tests/test_api.py, scripts/demo.sh, scripts/seed.sh. Do not edit anything else.

Tasks:
1. loadtest/k6_flash.js exactly per SPEC.md section 12: env knobs BASE_URL, EVENT_ID, VUS, MODE (any|hot), CONFIRM_RATIO, TARGET (engine|baseline); per-vu-iterations with 1 iteration per VU; user_id = "u-" + __VU; expected statuses configured so 409 is not a failure; custom counters and the reserve_latency_ms trend; summary export to loadtest/results/. When TARGET=baseline it calls /api/v1/baseline/events/{e}/reserve?mode=... (add a MODE_BASELINE env: naive|pessimistic) and never calls confirm.
2. loadtest/verify.py (plain Python with httpx, no extra deps): call /api/v1/events/{e}/verify (engine) or /api/v1/baseline/events/{e}/verify (baseline), print PASS/FAIL per invariant from SPEC.md section 13, and write loadtest/results/summary.md including counts and latency percentiles taken from the k6 summary JSON.
3. scripts/seed.sh (POST /api/v1/admin/events to create/reset evt1 with 200 seats) and scripts/demo.sh that runs the full demo sequence in SPEC.md section 14 in order, with clear echo banners between steps.
4. tests/test_api.py: httpx-based tests against a running stack for SPEC.md rows A7, A8 (needs HOLD_TTL_MS small: document how to run), A9.
5. loadtest/README.md: exact commands to run each scenario using `docker compose --profile loadtest run --rm k6 run ...`, including advice if a laptop cannot sustain 5,000 VUs (lower VUS to what works and report the real number honestly).
Until P2's API and P1's engine are merged, develop against the endpoints in SPEC.md section 9 and test your scripts with a tiny local mock server if needed (put the mock in loadtest/mock_server.py).
Verify: run the k6 script with VUS=50 against whatever is running and paste the real output; then run verify.py and paste its output.
```

---

## PROMPT 5: P5: web UI (seat grid + live dashboard)

```
Read AGENTS.md and SPEC.md completely and follow them strictly. SPEC.md is the single source of truth.

I am P5. My owned paths (SPEC.md section 4, [P5]): web/index.html, web/dashboard.html, web/app.js, web/style.css. Do not edit anything else. NO npm, NO frameworks, NO build step: plain HTML + vanilla JS. The folder is served by FastAPI at /ui, so pages call the API with relative URLs like /api/v1/....

Tasks:
1. web/index.html (seat grid): fetch GET /api/v1/events/evt1/seats every 1 second and render 200 seats as a grid, colored FREE (green), HELD (amber), SOLD (red). Clicking a FREE seat calls POST /reserve with a random user_id stored in the page and seat_id set; on 201 show a visible countdown to expires_at_ms and Confirm and Release buttons wired to the confirm and release endpoints. Show clear messages for 409, 410 and 429 using the "error" field of the response body.
2. web/dashboard.html: poll GET /api/v1/events/evt1/stats every 1 second and show big numbers for total, free, held, sold, persisted, backlog, plus a simple line chart of free/held/sold over the last 60 seconds. Draw the chart with a plain <canvas> (no chart library, so it works offline). Highlight "backlog" in a different color when it is above 0 and show "CONSISTENT" in green when backlog is 0 and sold equals persisted.
3. A "Verify" button on the dashboard calling GET /api/v1/events/evt1/verify and showing each field with a green tick or red cross.
4. Large, projector-friendly fonts and a dark theme; this is a demo screen.
Until the backend exists, develop against a tiny mock in web/mock.js that is only loaded when the URL contains ?mock=1 (the mock must follow the exact JSON shapes in SPEC.md section 9).
Verify: open both pages in the browser (with ?mock=1 if the backend is not ready) and describe what you actually see; list anything that does not work.
```
