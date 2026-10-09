"""Verification script for load test runs (owned by [P4]).

Calls /api/v1/events/{e}/verify (engine) or /api/v1/baseline/events/{e}/verify (baseline),
prints PASS/FAIL per invariant from SPEC.md section 13, and writes loadtest/results/summary.md
including counts and latency percentiles taken from the k6 summary JSON.
"""

import argparse
import json
import os
import sys
import httpx


def parse_args():
    parser = argparse.ArgumentParser(description="FlashSeat Load Test Verification")
    parser.add_argument(
        "--base-url",
        default=os.getenv("BASE_URL", "http://localhost:8000"),
        help="Base URL of FlashSeat service",
    )
    parser.add_argument(
        "--event-id",
        default=os.getenv("EVENT_ID", "evt1"),
        help="Event ID to verify",
    )
    parser.add_argument(
        "--target",
        default=os.getenv("TARGET", "engine"),
        choices=["engine", "baseline"],
        help="Verification target (engine|baseline)",
    )
    parser.add_argument(
        "--summary-file",
        default=os.getenv("SUMMARY_FILE", "loadtest/results/summary.json"),
        help="Path to k6 summary JSON file",
    )
    parser.add_argument(
        "--output-md",
        default=os.getenv("OUTPUT_MD", "loadtest/results/summary.md"),
        help="Path to output summary Markdown file",
    )
    return parser.parse_args()


def load_k6_metrics(summary_file_path: str) -> dict:
    if not os.path.exists(summary_file_path):
        # Fallback check under /loadtest/results/summary.json
        alt_path = os.path.join("loadtest", "results", "summary.json")
        if os.path.exists(alt_path):
            summary_file_path = alt_path
        else:
            return {}

    try:
        with open(summary_file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[WARN] Could not load k6 summary JSON ({e})")
        return {}


def extract_summary_stats(metrics_data: dict) -> dict:
    stats = {
        "vus": 0,
        "http_reqs": 0,
        "reserve_ok": 0,
        "reserve_conflict": 0,
        "reserve_rate_limited": 0,
        "confirm_ok": 0,
        "confirm_expired": 0,
        "latency_p50": "N/A",
        "latency_p90": "N/A",
        "latency_p95": "N/A",
        "latency_p99": "N/A",
        "latency_avg": "N/A",
    }

    if not metrics_data or "metrics" not in metrics_data:
        return stats

    metrics = metrics_data["metrics"]

    def get_counter(name: str) -> int:
        if name in metrics and "values" in metrics[name]:
            return int(metrics[name]["values"].get("count", 0))
        return 0

    stats["reserve_ok"] = get_counter("reserve_ok")
    stats["reserve_conflict"] = get_counter("reserve_conflict")
    stats["reserve_rate_limited"] = get_counter("reserve_rate_limited")
    stats["confirm_ok"] = get_counter("confirm_ok")
    stats["confirm_expired"] = get_counter("confirm_expired")
    stats["http_reqs"] = get_counter("http_reqs")

    # Latency metrics (reserve_latency_ms or http_req_duration)
    latency_metric = metrics.get("reserve_latency_ms") or metrics.get("http_req_duration")
    if latency_metric and "values" in latency_metric:
        vals = latency_metric["values"]
        for key in ["p(50)", "med"]:
            if key in vals:
                stats["latency_p50"] = f"{vals[key]:.2f} ms"
        for key in ["p(90)"]:
            if key in vals:
                stats["latency_p90"] = f"{vals[key]:.2f} ms"
        for key in ["p(95)"]:
            if key in vals:
                stats["latency_p95"] = f"{vals[key]:.2f} ms"
        for key in ["p(99)"]:
            if key in vals:
                stats["latency_p99"] = f"{vals[key]:.2f} ms"
        if "avg" in vals:
            stats["latency_avg"] = f"{vals['avg']:.2f} ms"

    return stats


def verify_engine(base_url: str, event_id: str) -> tuple[bool, list[dict], dict]:
    url = f"{base_url.rstrip('/')}/api/v1/events/{event_id}/verify"
    print(f"\n--- Verifying FlashSeat Engine via {url} ---")

    try:
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[FAIL] HTTP request to verify endpoint failed: {e}")
        return False, [{"invariant": "API Reachable", "expected": "200 OK", "actual": str(e), "status": "FAIL"}], {}

    invariants = [
        {
            "invariant": "A2: Drained to DB",
            "expected": True,
            "actual": data.get("drained"),
            "status": "PASS" if data.get("drained") is True else "FAIL",
        },
        {
            "invariant": "A3: Zero Duplicate Seat Rows in DB",
            "expected": 0,
            "actual": data.get("duplicate_seat_rows"),
            "status": "PASS" if data.get("duplicate_seat_rows") == 0 else "FAIL",
        },
        {
            "invariant": "Redis Sold == Postgres Bookings",
            "expected": data.get("redis_sold"),
            "actual": data.get("pg_bookings"),
            "status": "PASS" if data.get("redis_sold") == data.get("pg_bookings") else "FAIL",
        },
        {
            "invariant": "Redis/Postgres Consistency",
            "expected": True,
            "actual": data.get("consistent"),
            "status": "PASS" if data.get("consistent") is True else "FAIL",
        },
        {
            "invariant": "No Double Booking (Zero Overbooking)",
            "expected": True,
            "actual": data.get("no_double_booking"),
            "status": "PASS" if data.get("no_double_booking") is True else "FAIL",
        },
        {
            "invariant": "No Missing Rows in DB",
            "expected": [],
            "actual": data.get("missing_in_pg", []),
            "status": "PASS" if not data.get("missing_in_pg") else "FAIL",
        },
    ]

    all_passed = all(item["status"] == "PASS" for item in invariants)
    return all_passed, invariants, data


def verify_baseline(base_url: str, event_id: str) -> tuple[bool, list[dict], dict]:
    url = f"{base_url.rstrip('/')}/api/v1/baseline/events/{event_id}/verify"
    print(f"\n--- Verifying Baseline via {url} ---")

    try:
        resp = httpx.get(url, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"[FAIL] HTTP request to baseline verify endpoint failed: {e}")
        return False, [{"invariant": "API Reachable", "expected": "200 OK", "actual": str(e), "status": "FAIL"}], {}

    double_bookings = data.get("double_bookings", 0)
    invariants = [
        {
            "invariant": "Baseline Booked Rows Counted",
            "expected": ">= 0",
            "actual": data.get("booked_rows"),
            "status": "PASS",
        },
        {
            "invariant": "Baseline Distinct Seats",
            "expected": "distinct seat IDs",
            "actual": data.get("distinct_seats"),
            "status": "PASS",
        },
        {
            "invariant": "Baseline Double Bookings Recorded",
            "expected": f"double_bookings recorded ({double_bookings})",
            "actual": double_bookings,
            "status": "PASS",
        },
    ]
    return True, invariants, data


def write_summary_markdown(
    output_path: str,
    target: str,
    event_id: str,
    invariants: list[dict],
    k6_stats: dict,
    verify_data: dict,
    all_passed: bool,
):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    md = []
    md.append(f"# Load Test Verification Summary - Target: {target.upper()}\n")
    md.append(f"- **Event ID**: `{event_id}`")
    md.append(f"- **Overall Status**: **{'PASS' if all_passed else 'FAIL'}**\n")

    md.append("## k6 Load Test Metrics\n")
    md.append("| Metric | Value |")
    md.append("| --- | --- |")
    md.append(f"| Total HTTP Requests | {k6_stats.get('http_reqs', 0)} |")
    md.append(f"| Reserve OK (201) | {k6_stats.get('reserve_ok', 0)} |")
    md.append(f"| Reserve Conflict (409) | {k6_stats.get('reserve_conflict', 0)} |")
    md.append(f"| Reserve Rate Limited (429) | {k6_stats.get('reserve_rate_limited', 0)} |")
    md.append(f"| Confirm OK (200) | {k6_stats.get('confirm_ok', 0)} |")
    md.append(f"| Confirm Expired (410) | {k6_stats.get('confirm_expired', 0)} |")
    md.append(f"| Reserve Latency p50 | {k6_stats.get('latency_p50')} |")
    md.append(f"| Reserve Latency p90 | {k6_stats.get('latency_p90')} |")
    md.append(f"| Reserve Latency p95 | {k6_stats.get('latency_p95')} |")
    md.append(f"| Reserve Latency p99 | {k6_stats.get('latency_p99')} |")
    md.append(f"| Reserve Latency Avg | {k6_stats.get('latency_avg')} |\n")

    md.append("## Invariants Verification Table\n")
    md.append("| Invariant | Expected | Actual | Result |")
    md.append("| --- | --- | --- | --- |")
    for inv in invariants:
        status_str = f"**{inv['status']}**" if inv['status'] == "PASS" else f"**{inv['status']}**"
        md.append(f"| {inv['invariant']} | {inv['expected']} | {inv['actual']} | {status_str} |")

    content = "\n".join(md) + "\n"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\nWrote summary markdown to `{output_path}`")


def main():
    args = parse_args()
    k6_data = load_k6_metrics(args.summary_file)
    k6_stats = extract_summary_stats(k6_data)

    if args.target == "engine":
        all_passed, invariants, verify_data = verify_engine(args.base_url, args.event_id)
    else:
        all_passed, invariants, verify_data = verify_baseline(args.base_url, args.event_id)

    print("\n=======================================================")
    print(f"VERIFICATION RESULTS (Target: {args.target.upper()})")
    print("=======================================================")
    for inv in invariants:
        print(f"[{inv['status']}] {inv['invariant']} | Expected: {inv['expected']} | Actual: {inv['actual']}")
    print("-------------------------------------------------------")
    print(f"OVERALL STATUS: {'PASS' if all_passed else 'FAIL'}")
    print("=======================================================\n")

    write_summary_markdown(
        args.output_md,
        args.target,
        args.event_id,
        invariants,
        k6_stats,
        verify_data,
        all_passed,
    )

    if not all_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
