# FlashSeat Load Testing & Verification Guide

Owned by **[P4]**. Follows `SPEC.md` section 12 and section 13 strictly.

## Environment Knobs

| Variable | Default | Options / Description |
| --- | --- | --- |
| `BASE_URL` | `http://app:8000` | Target API base URL |
| `EVENT_ID` | `evt1` | Target event identifier |
| `VUS` | `5000` | Number of concurrent Virtual Users |
| `MODE` | `any` | `any` (random free seat) \| `hot` (competing for random seat S001..S200) |
| `CONFIRM_RATIO` | `0.9` | Ratio of successful holds to confirm (0.0 to 1.0) |
| `TARGET` | `engine` | `engine` (FlashSeat engine) \| `baseline` (Relational DB baseline) |
| `MODE_BASELINE` | `naive` | `naive` (no DB locking) \| `pessimistic` (FOR UPDATE DB locking) |

---

## Running k6 Load Test Scenarios

### 1. Engine Main Load Test (5,000 VUs, MODE=any, CONFIRM_RATIO=0.9)

```bash
docker compose --profile loadtest run --rm \
  -e BASE_URL=http://app:8000 \
  -e EVENT_ID=evt1 \
  -e VUS=5000 \
  -e MODE=any \
  -e CONFIRM_RATIO=0.9 \
  -e TARGET=engine \
  k6 run /loadtest/k6_flash.js
```

### 2. Engine Hot Seat Load Test (5,000 VUs, MODE=hot)

```bash
docker compose --profile loadtest run --rm \
  -e BASE_URL=http://app:8000 \
  -e EVENT_ID=evt1 \
  -e VUS=5000 \
  -e MODE=hot \
  -e CONFIRM_RATIO=0.9 \
  -e TARGET=engine \
  k6 run /loadtest/k6_flash.js
```

### 3. Baseline Naive Load Test

```bash
docker compose --profile loadtest run --rm \
  -e BASE_URL=http://app:8000 \
  -e EVENT_ID=evt1 \
  -e VUS=5000 \
  -e TARGET=baseline \
  -e MODE_BASELINE=naive \
  k6 run /loadtest/k6_flash.js
```

### 4. Baseline Pessimistic Load Test

```bash
docker compose --profile loadtest run --rm \
  -e BASE_URL=http://app:8000 \
  -e EVENT_ID=evt1 \
  -e VUS=5000 \
  -e TARGET=baseline \
  -e MODE_BASELINE=pessimistic \
  k6 run /loadtest/k6_flash.js
```

---

## Running Verification

After completing a load test run, execute `loadtest/verify.py` to check invariants against `SPEC.md` section 13 and generate `loadtest/results/summary.md`:

```bash
python loadtest/verify.py --base-url http://localhost:8000 --event-id evt1 --target engine
```

For baseline verification:

```bash
python loadtest/verify.py --base-url http://localhost:8000 --event-id evt1 --target baseline
```

---

## Advice for Hardware Limits & High VU Testing

If running on a laptop or workstation that cannot allocate or sustain 5,000 VUs due to OS socket/RAM/CPU constraints:
1. Lower `VUS` to a level your machine can sustain (e.g. `VUS=50`, `VUS=200`, `VUS=500`, or `VUS=1000`).
2. Always report the actual VUS used honestly in your benchmarks and logs.
3. The load test engine design (`per-vu-iterations` executor with 1 iteration per VU) ensures full concurrent contention across whatever `VUS` count is configured.
