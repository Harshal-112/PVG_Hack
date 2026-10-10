# Load Test Verification Summary - Target: BASELINE

- **Event ID**: `evt1`
- **Overall Status**: **PASS**

## k6 Load Test Metrics

| Metric | Value |
| --- | --- |
| Total HTTP Requests | 200 |
| Reserve OK (201) | 200 |
| Reserve Conflict (409) | 0 |
| Reserve Rate Limited (429) | 0 |
| Confirm OK (200) | 0 |
| Confirm Expired (410) | 0 |
| Reserve Latency p50 | 492.00 ms |
| Reserve Latency p90 | 1108.00 ms |
| Reserve Latency p95 | 1128.05 ms |
| Reserve Latency p99 | N/A |
| Reserve Latency Avg | 718.03 ms |

## Invariants Verification Table

| Invariant | Expected | Actual | Result |
| --- | --- | --- | --- |
| Baseline Booked Rows Counted | >= 0 | 200 | **PASS** |
| Baseline Distinct Seats | distinct seat IDs | 43 | **PASS** |
| Baseline Double Bookings Recorded | double_bookings recorded (157) | 157 | **PASS** |
