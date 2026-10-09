# Load Test Verification Summary - Target: BASELINE

- **Event ID**: `evt_base`
- **Overall Status**: **PASS**

## k6 Load Test Metrics

| Metric | Value |
| --- | --- |
| Total HTTP Requests | 250 |
| Reserve OK (201) | 250 |
| Reserve Conflict (409) | 0 |
| Reserve Rate Limited (429) | 0 |
| Confirm OK (200) | 0 |
| Confirm Expired (410) | 0 |
| Reserve Latency p50 | 1989.88 ms |
| Reserve Latency p90 | 2159.33 ms |
| Reserve Latency p95 | 2167.81 ms |
| Reserve Latency p99 | 2179.17 ms |
| Reserve Latency Avg | 1846.05 ms |

## Invariants Verification Table

| Invariant | Expected | Actual | Result |
| --- | --- | --- | --- |
| Baseline Booked Rows Counted | >= 0 | 250 | **PASS** |
| Baseline Distinct Seats | distinct seat IDs | 200 | **PASS** |
| Baseline Double Bookings Recorded | double_bookings recorded (50) | 50 | **PASS** |
