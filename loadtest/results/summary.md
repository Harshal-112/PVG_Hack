# Load Test Verification Summary - Target: BASELINE

- **Event ID**: `evt1`
- **Overall Status**: **PASS**

## k6 Load Test Metrics

| Metric | Value |
| --- | --- |
| Total HTTP Requests | 50 |
| Reserve OK (201) | 50 |
| Reserve Conflict (409) | 0 |
| Reserve Rate Limited (429) | 0 |
| Confirm OK (200) | 0 |
| Confirm Expired (410) | 0 |
| Reserve Latency p50 | 555.34 ms |
| Reserve Latency p90 | 573.41 ms |
| Reserve Latency p95 | 575.18 ms |
| Reserve Latency p99 | 652.66 ms |
| Reserve Latency Avg | 556.08 ms |

## Invariants Verification Table

| Invariant | Expected | Actual | Result |
| --- | --- | --- | --- |
| Baseline Booked Rows Counted | >= 0 | 50 | **PASS** |
| Baseline Distinct Seats | distinct seat IDs | 50 | **PASS** |
| Baseline Double Bookings Recorded | double_bookings recorded (0) | 0 | **PASS** |
