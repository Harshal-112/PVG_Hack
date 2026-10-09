"""Prometheus metrics definitions. Owned by [P2]."""

from prometheus_client import Counter, Histogram

RESERVE_TOTAL = Counter(
    "reserve_total",
    "Total reservations requested",
    ["result"],
)

CONFIRM_TOTAL = Counter(
    "confirm_total",
    "Total confirmations requested",
    ["result"],
)

REQUEST_LATENCY_SECONDS = Histogram(
    "request_latency_seconds",
    "Request latency in seconds",
    ["route"],
)
