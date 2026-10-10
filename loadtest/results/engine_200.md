# Load Test Verification Summary - Target: ENGINE

- **Event ID**: `evt1`
- **Overall Status**: **PASS**

## k6 Load Test Metrics

| Metric | Value |
| --- | --- |
| Total HTTP Requests | 380 |
| Reserve OK (201) | 200 |
| Reserve Conflict (409) | 0 |
| Reserve Rate Limited (429) | 0 |
| Confirm OK (200) | 180 |
| Confirm Expired (410) | 0 |
| Reserve Latency p50 | 1959.00 ms |
| Reserve Latency p90 | 2344.10 ms |
| Reserve Latency p95 | 2917.85 ms |
| Reserve Latency p99 | N/A |
| Reserve Latency Avg | 2014.80 ms |

## Invariants Verification Table

| Invariant | Expected | Actual | Result |
| --- | --- | --- | --- |
| A2: Drained to DB | True | True | **PASS** |
| A3: Zero Duplicate Seat Rows in DB | 0 | 0 | **PASS** |
| Redis Sold == Postgres Bookings | 180 | 180 | **PASS** |
| Redis/Postgres Consistency | True | True | **PASS** |
| No Double Booking (Zero Overbooking) | True | True | **PASS** |
| No Missing Rows in DB | [] | [] | **PASS** |
