# Virtual Waiting Room 5,000 Concurrent VUs Load Test Summary

- **Target**: Virtual Waiting Room & FlashSeat Core Engine (`loadtest/test_waiting_room_load.py`)
- **Event ID**: `evt1` (200 Seats Total)
- **Concurrency**: 5,000 Simultaneous Clients
- **Overall Result**: **PASS (Zero Violations)**

## Test Execution Results

| Phase | Description | Result / Metric | Status |
| :--- | :--- | :--- | :---: |
| **Phase 1: Security Bypass Block** | 100 direct reserve attempts without admission token | 100 / 100 blocked with HTTP 403 `QUEUE_ADMISSION_REQUIRED` | **PASS** |
| **Phase 2: 5,000 Concurrent Joins** | Simultaneous FIFO queue joins under high flash spike | 5,000 requests processed in 9.61s (520.2 req/s throughput) | **PASS** |
| **Phase 3: Queue Admission Ceilings** | Enforce global admitted session cap | 50 admitted immediately, 4,950 queued in FIFO waiting line | **PASS** |
| **Phase 4: Authorized Booking** | Admitted users booking free seats with cryptographic token | 40 / 40 seats reserved successfully (HTTP 201) | **PASS** |
| **Phase 5: High-Contention Collision** | 50 competing admitted clients targeting single seat `S099` | 1 Winner (201 Created), 49 Conflicts (409 Conflict), **0 Double-Bookings** | **PASS** |
| **Phase 6: Real-Time Telemetry** | Waiting room operational statistics | Admitted: 50, Waiting: 4,950, Admission Rate: 25/s, Wait: 198s | **PASS** |

## Latency Profile (5,000 Simultaneous Clients)

| Metric | Measured Value |
| :--- | :--- |
| **Total Concurrent Requests** | 5,000 |
| **Effective Throughput** | 520.2 requests / sec |
| **Mean Latency** | 7,731.97 ms |
| **p50 Latency** | 7,695.88 ms |
| **p90 Latency** | 8,790.51 ms |
| **p95 Latency** | 8,919.04 ms |
| **p99 Latency** | 9,007.05 ms |
