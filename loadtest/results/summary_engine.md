# Load Test Verification Summary - Target: ENGINE

- **Event ID**: `evt1`
- **Overall Status**: **PASS**

## k6 Load Test Metrics

| Metric | Value |
| --- | --- |
| Total HTTP Requests | 373 |
| Reserve OK (201) | 200 |
| Reserve Conflict (409) | 0 |
| Reserve Rate Limited (429) | 0 |
| Confirm OK (200) | 173 |
| Confirm Expired (410) | 0 |
| Reserve Latency p50 | 1722.07 ms |
| Reserve Latency p90 | 2476.64 ms |
| Reserve Latency p95 | 2497.67 ms |
| Reserve Latency p99 | 2545.60 ms |
| Reserve Latency Avg | 1810.43 ms |

## Invariants Verification Table

| Invariant | Expected | Actual | Result |
| --- | --- | --- | --- |
| A2: Drained to DB | True | True | **PASS** |
| A3: Zero Duplicate Seat Rows in DB | 0 | 0 | **PASS** |
| Redis Sold == Postgres Bookings | 173 | 173 | **PASS** |
| Redis/Postgres Consistency | True | True | **PASS** |
| No Double Booking (Zero Overbooking) | True | True | **PASS** |
| No Missing Rows in DB | [] | [] | **PASS** |
