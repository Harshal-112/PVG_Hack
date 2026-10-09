"""Python fallback runner for load test when k6 / docker is not available on host system (owned by P4).

Executes concurrent requests matching k6_flash.js behavior and exports k6-compatible summary JSON to loadtest/results/summary.json.
"""

import asyncio
import json
import os
import random
import time
import httpx


async def run_vu(client: httpx.AsyncClient, vu_id: int, base_url: str, event_id: str, mode: str, confirm_ratio: float, target: str, mode_baseline: str, stats: dict):
    user_id = f"u-{vu_id}"
    seat_id = None
    if mode == "hot":
        seat_num = random.randint(1, 200)
        seat_id = f"S{seat_num:03d}"

    headers = {"Content-Type": "application/json"}
    t0 = time.time()

    if target == "baseline":
        url = f"{base_url.rstrip('/')}/api/v1/baseline/events/{event_id}/reserve?mode={mode_baseline}"
        try:
            resp = await client.post(url, json={"user_id": user_id}, headers=headers)
            dur = (time.time() - t0) * 1000
            stats["latencies"].append(dur)
            stats["http_reqs"] += 1

            if resp.status_code == 201:
                stats["reserve_ok"] += 1
            elif resp.status_code == 409:
                stats["reserve_conflict"] += 1
            elif resp.status_code == 429:
                stats["reserve_rate_limited"] += 1
        except Exception as e:
            stats["errors"].append(str(e))
        return

    # Engine target
    url = f"{base_url.rstrip('/')}/api/v1/events/{event_id}/reserve"
    try:
        resp = await client.post(url, json={"user_id": user_id, "seat_id": seat_id}, headers=headers)
        dur = (time.time() - t0) * 1000
        stats["latencies"].append(dur)
        stats["http_reqs"] += 1

        if resp.status_code == 201:
            stats["reserve_ok"] += 1
            data = resp.json()
            rid = data.get("reservation_id")
            if rid and random.random() < confirm_ratio:
                confirm_url = f"{base_url.rstrip('/')}/api/v1/events/{event_id}/reservations/{rid}/confirm"
                c_resp = await client.post(confirm_url, json={"user_id": user_id}, headers=headers)
                stats["http_reqs"] += 1
                if c_resp.status_code == 200:
                    stats["confirm_ok"] += 1
                elif c_resp.status_code == 410:
                    stats["confirm_expired"] += 1
        elif resp.status_code == 409:
            stats["reserve_conflict"] += 1
        elif resp.status_code == 429:
            stats["reserve_rate_limited"] += 1
    except Exception as e:
        stats["errors"].append(str(e))


async def main():
    base_url = os.getenv("BASE_URL", "http://localhost:8000")
    event_id = os.getenv("EVENT_ID", "evt1")
    vus = int(os.getenv("VUS", "50"))
    mode = os.getenv("MODE", "any")
    confirm_ratio = float(os.getenv("CONFIRM_RATIO", "0.9"))
    target = os.getenv("TARGET", "engine")
    mode_baseline = os.getenv("MODE_BASELINE", "naive")

    print(f"=== Running Python Load Test Runner (VUS={vus}, TARGET={target}, EVENT={event_id}) ===")

    stats = {
        "http_reqs": 0,
        "reserve_ok": 0,
        "reserve_conflict": 0,
        "reserve_rate_limited": 0,
        "confirm_ok": 0,
        "confirm_expired": 0,
        "latencies": [],
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        tasks = [
            run_vu(client, i + 1, base_url, event_id, mode, confirm_ratio, target, mode_baseline, stats)
            for i in range(vus)
        ]
        await asyncio.gather(*tasks)

    # Compute percentiles
    lats = sorted(stats["latencies"]) if stats["latencies"] else [0.0]
    n = len(lats)

    def p(pct):
        idx = int(n * pct / 100.0)
        return lats[min(idx, n - 1)]

    summary = {
        "metrics": {
            "http_reqs": {"values": {"count": stats["http_reqs"]}},
            "reserve_ok": {"values": {"count": stats["reserve_ok"]}},
            "reserve_conflict": {"values": {"count": stats["reserve_conflict"]}},
            "reserve_rate_limited": {"values": {"count": stats["reserve_rate_limited"]}},
            "confirm_ok": {"values": {"count": stats["confirm_ok"]}},
            "confirm_expired": {"values": {"count": stats["confirm_expired"]}},
            "reserve_latency_ms": {
                "values": {
                    "avg": sum(lats) / max(n, 1),
                    "min": lats[0],
                    "med": p(50),
                    "max": lats[-1],
                    "p(50)": p(50),
                    "p(90)": p(90),
                    "p(95)": p(95),
                    "p(99)": p(99),
                }
            },
        }
    }

    os.makedirs("loadtest/results", exist_ok=True)
    summary_path = "loadtest/results/summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"\nLoad test completed: {stats['reserve_ok']} reserves OK, {stats['confirm_ok']} confirms OK.")
    print(f"Summary exported to `{summary_path}`.")


if __name__ == "__main__":
    asyncio.run(main())
