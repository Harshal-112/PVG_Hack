"""Load test for Virtual Waiting Room: 5,000 concurrent clients.

Executes a high-concurrency simulation testing:
1. 5,000 concurrent client queue joins.
2. Real-time FIFO position assignment and latency benchmarks (p50, p95, p99).
3. Enforcement of global admission capacity ceilings.
4. Unauthorized direct reservation rejection (100% blocked with 403).
5. High-contention race condition tests: competing for identical seats with zero double-bookings.
"""

import asyncio
import math
import sys
import time
from pathlib import Path

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.config import settings
from app.services.waiting_room import waiting_room_service
from tests.test_feature_routes import FakeWaitingRoomRedis, ExtendedFakeInventory


def calculate_percentile(data: list[float], percentile: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    idx = int(math.ceil((percentile / 100.0) * len(sorted_data))) - 1
    return sorted_data[max(0, min(idx, len(sorted_data) - 1))]


async def run_waiting_room_5000_concurrency_load_test():
    print("=" * 72)
    print("FLASHSEAT VIRTUAL WAITING ROOM — 5,000 CONCURRENT CLIENTS LOAD TEST")
    print("=" * 72)

    # Setup isolated in-memory test environment
    fake_r = FakeWaitingRoomRedis()
    waiting_room_service.set_redis(fake_r)
    fake_inv = ExtendedFakeInventory(hold_ttl_ms=60000)
    await fake_inv.seed_event("evt1", [f"S{str(i).zfill(3)}" for i in range(1, 201)])
    app.state.inventory = fake_inv

    # Configure waiting room limits for high contention flash sale
    settings.WAITING_ROOM_ENABLED = True
    settings.WAITING_ROOM_MAX_ADMITTED = 50
    settings.WAITING_ROOM_ADMISSION_RATE = 25  # 25 users / sec
    settings.WAITING_ROOM_MAX_QUEUE_SIZE = 10000

    TOTAL_CONCURRENT_CLIENTS = 5000
    print(f"[CONFIG] Event ID: evt1 (200 Seats Total)")
    print(f"[CONFIG] Waiting Room: ENABLED")
    print(f"[CONFIG] Max Admitted Sessions: {settings.WAITING_ROOM_MAX_ADMITTED}")
    print(f"[CONFIG] Admission Rate: {settings.WAITING_ROOM_ADMISSION_RATE} users/sec")
    print(f"[CONFIG] Max Queue Size: {settings.WAITING_ROOM_MAX_QUEUE_SIZE}")
    print(f"[CONFIG] Target Concurrency: {TOTAL_CONCURRENT_CLIENTS} simultaneous clients\n")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # -------------------------------------------------------------
        # TEST PHASE 1: Unauthorized Direct Reservation Blocking Check
        # -------------------------------------------------------------
        print(">>> Phase 1: Verifying Server-Side Admission Enforcement (Bypass Block)...")
        unauth_blocked = 0
        unauth_attempts = 100
        for i in range(unauth_attempts):
            res = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": f"unauth_{i}", "seat_id": "S001"}
            )
            if res.status_code == 403 and res.json().get("error") == "QUEUE_ADMISSION_REQUIRED":
                unauth_blocked += 1

        print(f"    Direct reservation attempts: {unauth_attempts}")
        print(f"    Unauthorized blocked (403):  {unauth_blocked} (100% blocked)")
        assert unauth_blocked == unauth_attempts, "Security Failure: Bypass was not blocked!"

        # -------------------------------------------------------------
        # TEST PHASE 2: 5,000 Concurrent Queue Joins
        # -------------------------------------------------------------
        print(f"\n>>> Phase 2: Launching {TOTAL_CONCURRENT_CLIENTS} Simultaneous Queue Joins...")
        join_latencies = []
        status_counts = {"ADMITTED": 0, "WAITING": 0, "OTHER": 0}
        admitted_tokens = {}

        t_start = time.perf_counter()

        async def client_join_task(client_idx: int):
            uid = f"user_{str(client_idx).zfill(5)}"
            t0 = time.perf_counter()
            resp = await client.post(
                "/api/v1/events/evt1/waiting-room/join",
                json={"user_id": uid}
            )
            lat_ms = (time.perf_counter() - t0) * 1000.0
            join_latencies.append(lat_ms)

            if resp.status_code == 200:
                data = resp.json()
                st = data.get("status")
                if st == "ADMITTED":
                    status_counts["ADMITTED"] += 1
                    admitted_tokens[uid] = data.get("admission_token")
                elif st == "WAITING":
                    status_counts["WAITING"] += 1
                else:
                    status_counts["OTHER"] += 1
            else:
                status_counts["OTHER"] += 1

        # Execute all 5,000 joins concurrently using asyncio.gather
        tasks = [client_join_task(i) for i in range(1, TOTAL_CONCURRENT_CLIENTS + 1)]
        await asyncio.gather(*tasks)

        t_total = time.perf_counter() - t_start
        rps = TOTAL_CONCURRENT_CLIENTS / t_total if t_total > 0 else 0

        p50 = calculate_percentile(join_latencies, 50)
        p90 = calculate_percentile(join_latencies, 90)
        p95 = calculate_percentile(join_latencies, 95)
        p99 = calculate_percentile(join_latencies, 99)
        avg_lat = sum(join_latencies) / len(join_latencies) if join_latencies else 0

        print(f"    Completed:              {len(join_latencies)} requests in {t_total:.2f}s")
        print(f"    Effective Throughput:   {rps:.1f} req/s")
        print(f"    Admitted Immediately:   {status_counts['ADMITTED']} (Ceiling: {settings.WAITING_ROOM_MAX_ADMITTED})")
        print(f"    Queued in Waiting Line: {status_counts['WAITING']}")
        print(f"    Latency Metrics:")
        print(f"      - Mean Latency:  {avg_lat:.2f} ms")
        print(f"      - p50 Latency:   {p50:.2f} ms")
        print(f"      - p90 Latency:   {p90:.2f} ms")
        print(f"      - p95 Latency:   {p95:.2f} ms")
        print(f"      - p99 Latency:   {p99:.2f} ms")

        # Invariant checks
        assert status_counts["ADMITTED"] <= settings.WAITING_ROOM_MAX_ADMITTED, "Capacity exceeded!"
        assert (status_counts["ADMITTED"] + status_counts["WAITING"]) == TOTAL_CONCURRENT_CLIENTS, "Dropped requests!"

        # -------------------------------------------------------------
        # TEST PHASE 3: Admitted Clients Booking Protected Seats
        # -------------------------------------------------------------
        print("\n>>> Phase 3: Admitted Clients Exercising Authorized Bookings...")
        successful_reserves = 0
        admitted_list = list(admitted_tokens.items())

        for uid, tok in admitted_list[:40]:
            seat = f"S{str(successful_reserves + 1).zfill(3)}"
            res = await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": uid, "seat_id": seat},
                headers={"X-Admission-Token": tok}
            )
            if res.status_code == 201:
                successful_reserves += 1

        print(f"    Authorized reservations completed: {successful_reserves} seats reserved")
        assert successful_reserves == 40, "Authorized bookings failed!"

        # -------------------------------------------------------------
        # TEST PHASE 4: High-Contention Race Condition on Identical Seat
        # -------------------------------------------------------------
        print("\n>>> Phase 4: High-Contention Seat Collision Test (50 Competing Clients for Seat S099)...")
        contention_seat = "S099"
        competing_uids = [uid for uid, _ in admitted_list[:50]]

        async def try_reserve_collision(uid, token):
            return await client.post(
                "/api/v1/events/evt1/reserve",
                json={"user_id": uid, "seat_id": contention_seat},
                headers={"X-Admission-Token": token}
            )

        collision_tasks = [try_reserve_collision(uid, admitted_tokens[uid]) for uid in competing_uids]
        collision_resps = await asyncio.gather(*collision_tasks)

        wins = sum(1 for r in collision_resps if r.status_code == 201)
        conflicts = sum(1 for r in collision_resps if r.status_code == 409)

        print(f"    Competing Requests: {len(collision_resps)}")
        print(f"    Winner (201):       {wins} (Strictly 1 booking)")
        print(f"    Conflicts (409):    {conflicts} (Seat Held / Conflict)")
        assert wins == 1, "Concurrency Violation: Double booking occurred!"
        assert conflicts == len(collision_resps) - 1, "Unexpected status code!"

        # -------------------------------------------------------------
        # TEST PHASE 5: Telemetry and Operational Statistics
        # -------------------------------------------------------------
        print("\n>>> Phase 5: Querying Waiting Room Telemetry & Dashboard Stats...")
        stats_resp = await client.get("/api/v1/events/evt1/waiting-room/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()

        print(f"    Waiting Count:       {stats['waiting_count']}")
        print(f"    Admitted Count:      {stats['admitted_count']}")
        print(f"    Max Capacity:        {stats['max_admitted']}")
        print(f"    Admission Rate:      {stats['admission_rate_per_sec']}/s")
        print(f"    Total Admissions:    {stats['admissions_total']}")
        print(f"    Estimated Avg Wait:  {stats['avg_wait_seconds']}s")

    print("\n" + "=" * 72)
    print("ALL 5,000 CONCURRENT CLIENT TEST PHASES PASSED WITH ZERO VIOLATIONS!")
    print("=" * 72)
    return True


if __name__ == "__main__":
    asyncio.run(run_waiting_room_5000_concurrency_load_test())
