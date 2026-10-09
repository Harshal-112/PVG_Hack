// k6 load test script for FlashSeat engine. Owned by [P4].
// Implements SPEC.md section 12.

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Environment knobs
const BASE_URL = __ENV.BASE_URL || 'http://app:8000';
const EVENT_ID = __ENV.EVENT_ID || 'evt1';
const VUS = parseInt(__ENV.VUS || '5000', 10);
const MODE = __ENV.MODE || 'any'; // 'any' | 'hot'
const CONFIRM_RATIO = parseFloat(__ENV.CONFIRM_RATIO || '0.9');
const TARGET = __ENV.TARGET || 'engine'; // 'engine' | 'baseline'
const MODE_BASELINE = __ENV.MODE_BASELINE || 'naive'; // 'naive' | 'pessimistic'

// Custom metrics
const reserveOk = new Counter('reserve_ok');
const reserveConflict = new Counter('reserve_conflict');
const reserveRateLimited = new Counter('reserve_rate_limited');
const confirmOk = new Counter('confirm_ok');
const confirmExpired = new Counter('confirm_expired');
const reserveLatency = new Trend('reserve_latency_ms');

// Configure expected statuses so 409, 410, 429, 503 are not treated as k6 request failures
http.setResponseCallback(http.expectedStatuses(200, 201, 409, 410, 429, 503));

export const options = {
  scenarios: {
    flash_reserve: {
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

  if (TARGET === 'baseline') {
    // Baseline test scenario
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
    // Baseline never calls confirm
    return;
  }

  // Engine test scenario
  let seatId = null;
  if (MODE === 'hot') {
    // Pick random seat S001..S200
    const seatNum = Math.floor(Math.random() * 200) + 1;
    seatId = `S${String(seatNum).padStart(3, '0')}`;
  }

  const reserveUrl = `${BASE_URL}/api/v1/events/${EVENT_ID}/reserve`;
  const reservePayload = JSON.stringify({
    user_id: userId,
    seat_id: seatId,
  });

  const startTime = Date.now();
  const res = http.post(reserveUrl, reservePayload, { headers });
  const duration = Date.now() - startTime;
  reserveLatency.add(duration);

  if (res.status === 201) {
    reserveOk.add(1);

    let reservationId = null;
    try {
      const body = JSON.parse(res.body);
      reservationId = body.reservation_id;
    } catch (e) {
      // JSON parse error
    }

    if (reservationId) {
      // With probability CONFIRM_RATIO, call confirm
      if (Math.random() < CONFIRM_RATIO) {
        const confirmUrl = `${BASE_URL}/api/v1/events/${EVENT_ID}/reservations/${reservationId}/confirm`;
        const confirmPayload = JSON.stringify({ user_id: userId });
        const confirmRes = http.post(confirmUrl, confirmPayload, { headers });

        if (confirmRes.status === 200) {
          confirmOk.add(1);
        } else if (confirmRes.status === 410) {
          confirmExpired.add(1);
        }
      }
    }
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
