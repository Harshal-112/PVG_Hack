// k6 load test script for baseline comparison. Owned by [P4].
// Delegates to baseline target logic per SPEC.md section 12.

import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://app:8000';
const EVENT_ID = __ENV.EVENT_ID || 'evt1';
const VUS = parseInt(__ENV.VUS || '5000', 10);
const MODE_BASELINE = __ENV.MODE_BASELINE || 'naive'; // 'naive' | 'pessimistic'

const reserveOk = new Counter('reserve_ok');
const reserveConflict = new Counter('reserve_conflict');
const reserveRateLimited = new Counter('reserve_rate_limited');
const reserveLatency = new Trend('reserve_latency_ms');

http.setResponseCallback(http.expectedStatuses(200, 201, 409, 410, 429, 503));

export const options = {
  scenarios: {
    baseline_reserve: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    reserve_latency_ms: ['p(95)<1000'],
  },
};

export default function () {
  const userId = `u-${__VU}`;
  const headers = { 'Content-Type': 'application/json' };

  const url = `${BASE_URL}/api/v1/baseline/events/${EVENT_ID}/reserve?mode=${MODE_BASELINE}`;
  const payload = JSON.stringify({ user_id: userId });

  const startTime = Date.now();
  const res = http.post(url, payload, { headers });
  const duration = Date.now() - startTime;
  reserveLatency.add(duration);

  if (res.status === 201) {
    reserveOk.add(1);
  } else if (res.status === 409) {
    reserveConflict.add(1);
  } else if (res.status === 429) {
    reserveRateLimited.add(1);
  }
}

export function handleSummary(data) {
  const summaryFile = __ENV.SUMMARY_FILE || 'loadtest/results/summary.json';
  return {
    [summaryFile]: JSON.stringify(data, null, 2),
    '/loadtest/results/summary.json': JSON.stringify(data, null, 2),
  };
}
