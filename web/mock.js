// FlashSeat Mock API Layer - Owned by [P5]
// This mock is ONLY loaded and active when the page URL contains ?mock=1
(function () {
  'use strict';

  console.log('[FlashSeat Mock API] Mock mode active (?mock=1). Intercepting /api/v1 requests.');
  window.__MOCK_ACTIVE__ = true;

  const TOTAL_SEATS = 200;
  const HOLD_TTL_MS = 30000; // 30s TTL for live UI testing

  // State store for event evt1
  const seats = {};
  for (let i = 1; i <= TOTAL_SEATS; i++) {
    const seatId = 'S' + String(i).padStart(3, '0');
    // Pre-seed a few seats so all 3 states are immediately visible on initial load:
    if (i <= 12) {
      seats[seatId] = 'SOLD';
    } else if (i <= 16) {
      seats[seatId] = 'HELD';
    } else {
      seats[seatId] = 'FREE';
    }
  }

  // Active reservations: rid -> { rid, seat_id, user_id, expires_at_ms, status }
  const reservations = {};
  const owners = {}; // seat_id -> rid
  const soldMap = {}; // seat_id -> rid
  const pgBookings = new Set();

  // Initialize pre-seeded SOLD seats
  for (let i = 1; i <= 12; i++) {
    const sId = 'S' + String(i).padStart(3, '0');
    const rId = 'seed-sold-' + sId;
    soldMap[sId] = rId;
    reservations[rId] = {
      rid: rId,
      seat_id: sId,
      user_id: 'seed-user',
      expires_at_ms: 0,
      status: 'CONFIRMED'
    };
    pgBookings.add(sId);
  }

  // Initialize pre-seeded HELD seats with expirations spaced out
  const seedHeldExpiries = [25000, 20000, 15000, 10000];
  for (let i = 13; i <= 16; i++) {
    const sId = 'S' + String(i).padStart(3, '0');
    const rId = 'seed-held-' + sId;
    const exp = Date.now() + seedHeldExpiries[i - 13];
    owners[sId] = rId;
    reservations[rId] = {
      rid: rId,
      seat_id: sId,
      user_id: 'seed-user-' + (i - 12),
      expires_at_ms: exp,
      status: 'HELD'
    };
  }

  // Token bucket for rate limiting: client_key -> { tokens, last_ms }
  const rateLimitBuckets = {};
  const RL_CAPACITY = 20;
  const RL_REFILL_PER_SEC = 10;

  function checkRateLimit(clientKey) {
    const now = Date.now();
    let bucket = rateLimitBuckets[clientKey];
    if (!bucket) {
      bucket = { tokens: RL_CAPACITY, last_ms: now };
      rateLimitBuckets[clientKey] = bucket;
    }
    const elapsedSec = (now - bucket.last_ms) / 1000;
    bucket.tokens = Math.min(RL_CAPACITY, bucket.tokens + elapsedSec * RL_REFILL_PER_SEC);
    bucket.last_ms = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }
    return { allowed: false, remaining: 0 };
  }

  function reapExpiredHolds() {
    const now = Date.now();
    for (const rid of Object.keys(reservations)) {
      const res = reservations[rid];
      if (res.status === 'HELD' && res.expires_at_ms <= now) {
        res.status = 'EXPIRED';
        const sId = res.seat_id;
        if (owners[sId] === rid) {
          delete owners[sId];
          seats[sId] = 'FREE';
          console.log(`[FlashSeat Mock API] Reaped expired hold on ${sId} (rid: ${rid})`);
        }
      }
    }
  }

  function generateRid() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    return 'r' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  }

  function jsonResponse(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
  }

  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    // Check if relative or host URL matches /api/v1/
    let parsedPath = '';
    try {
      const parsed = new URL(url, window.location.origin);
      parsedPath = parsed.pathname;
    } catch (e) {
      parsedPath = url;
    }

    if (!parsedPath.startsWith('/api/v1/')) {
      return originalFetch.apply(this, arguments);
    }

    // Always reap expired holds before handling any request (matches Redis Lua reap snippet)
    reapExpiredHolds();

    // 1. GET /api/v1/events/{e}/seats
    const seatsMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/seats$/);
    if (seatsMatch && method === 'GET') {
      return jsonResponse({ seats: { ...seats } }, 200);
    }

    // 2. POST /api/v1/events/{e}/reserve
    const reserveMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/reserve$/);
    if (reserveMatch && method === 'POST') {
      let body = {};
      try {
        body = init && init.body ? JSON.parse(init.body) : {};
      } catch (e) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'Payload must be valid JSON' }, 422);
      }

      const userId = body.user_id;
      let seatId = body.seat_id;

      if (!userId || typeof userId !== 'string') {
        return jsonResponse({ error: 'MISSING_USER_ID', message: 'Field user_id is required' }, 422);
      }

      // Check token bucket rate limit
      const rl = checkRateLimit(userId);
      if (!rl.allowed) {
        return jsonResponse(
          { error: 'RATE_LIMITED', message: 'Token bucket capacity exceeded. Please retry.' },
          429,
          { 'Retry-After': '1' }
        );
      }

      if (!seatId) {
        // Any seat (SPOP)
        const freeSeats = Object.keys(seats).filter(s => seats[s] === 'FREE');
        if (freeSeats.length === 0) {
          return jsonResponse({ error: 'SOLD_OUT', message: 'Event is completely sold out' }, 409);
        }
        seatId = freeSeats[Math.floor(Math.random() * freeSeats.length)];
      }

      if (!seats[seatId]) {
        return jsonResponse({ error: 'SEAT_UNKNOWN', message: `Seat ${seatId} does not exist` }, 404);
      }

      if (seats[seatId] === 'SOLD') {
        return jsonResponse({ error: 'SEAT_SOLD', message: `Seat ${seatId} has already been purchased` }, 409);
      }

      if (seats[seatId] === 'HELD') {
        return jsonResponse({ error: 'SEAT_HELD', message: `Seat ${seatId} is currently held by another customer` }, 409);
      }

      // Reserve the seat
      seats[seatId] = 'HELD';
      const rid = generateRid();
      const expiresAt = Date.now() + HOLD_TTL_MS;

      reservations[rid] = {
        rid,
        seat_id: seatId,
        user_id: userId,
        expires_at_ms: expiresAt,
        status: 'HELD'
      };
      owners[seatId] = rid;

      return jsonResponse({
        reservation_id: rid,
        seat_id: seatId,
        expires_at_ms: expiresAt,
        ttl_ms: HOLD_TTL_MS
      }, 201);
    }

    // 3. POST /api/v1/events/{e}/reservations/{rid}/confirm
    const confirmMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/reservations\/([^/]+)\/confirm$/);
    if (confirmMatch && method === 'POST') {
      let body = {};
      try {
        body = init && init.body ? JSON.parse(init.body) : {};
      } catch (e) {
        return jsonResponse({ error: 'INVALID_JSON', message: 'Payload must be valid JSON' }, 422);
      }

      const rid = confirmMatch[2];
      const res = reservations[rid];

      if (!res) {
        return jsonResponse({ error: 'UNKNOWN', message: 'Reservation ID was not found' }, 404);
      }

      if (res.status === 'CONFIRMED') {
        // Idempotent confirmation retry
        return jsonResponse({
          status: 'CONFIRMED',
          seat_id: res.seat_id,
          idempotent: true
        }, 200);
      }

      if (res.status !== 'HELD' || res.expires_at_ms <= Date.now()) {
        return jsonResponse({ error: 'HOLD_EXPIRED', message: 'Reservation hold has expired' }, 410);
      }

      // Confirm seat
      res.status = 'CONFIRMED';
      seats[res.seat_id] = 'SOLD';
      soldMap[res.seat_id] = rid;
      delete owners[res.seat_id];

      // Simulate async writer worker: persisted lands in Postgres
      setTimeout(() => {
        pgBookings.add(res.seat_id);
      }, 1200);

      return jsonResponse({
        status: 'CONFIRMED',
        seat_id: res.seat_id,
        idempotent: false
      }, 200);
    }

    // 4. DELETE /api/v1/events/{e}/reservations/{rid}
    const releaseMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/reservations\/([^/]+)$/);
    if (releaseMatch && method === 'DELETE') {
      const rid = releaseMatch[2];
      const res = reservations[rid];

      if (!res) {
        return jsonResponse({ error: 'UNKNOWN', message: 'Reservation ID was not found' }, 404);
      }

      if (res.status === 'CONFIRMED') {
        return jsonResponse({ error: 'ALREADY_CONFIRMED', message: 'Cannot release a seat that is already confirmed' }, 409);
      }

      if (res.status !== 'HELD') {
        return jsonResponse({ status: 'NOOP', seat_id: res.seat_id }, 200);
      }

      // Release seat
      res.status = 'RELEASED';
      seats[res.seat_id] = 'FREE';
      delete owners[res.seat_id];

      return jsonResponse({ status: 'RELEASED', seat_id: res.seat_id }, 200);
    }

    // 5. GET /api/v1/events/{e}/stats
    const statsMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/stats$/);
    if (statsMatch && method === 'GET') {
      const eId = statsMatch[1];
      let free = 0;
      let held = 0;
      let sold = 0;

      for (const s of Object.values(seats)) {
        if (s === 'FREE') free++;
        else if (s === 'HELD') held++;
        else if (s === 'SOLD') sold++;
      }

      const persisted = pgBookings.size;
      const backlog = Math.max(0, sold - persisted);

      return jsonResponse({
        event_id: eId,
        total: TOTAL_SEATS,
        free,
        held,
        sold,
        persisted,
        backlog,
        hold_ttl_ms: HOLD_TTL_MS
      }, 200);
    }

    // 6. GET /api/v1/events/{e}/verify
    const verifyMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/verify$/);
    if (verifyMatch && method === 'GET') {
      const eId = verifyMatch[1];

      let sold = 0;
      for (const s of Object.values(seats)) {
        if (s === 'SOLD') sold++;
      }

      for (const sId of Object.keys(soldMap)) {
        pgBookings.add(sId);
      }

      const pgCount = pgBookings.size;
      const drained = sold === pgCount;

      return jsonResponse({
        event_id: eId,
        redis_sold: sold,
        pg_bookings: pgCount,
        drained: drained,
        duplicate_seat_rows: 0,
        missing_in_pg: [],
        extra_in_pg: [],
        consistent: drained && sold === pgCount,
        no_double_booking: true
      }, 200);
    }

    // 7. Auth Mock Endpoints
    if (parsedPath === '/api/v1/auth/login' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const username = body.username || 'demo_user';
      return jsonResponse({
        ok: true,
        user_id: 'u-' + username.toLowerCase().replace(/[^a-z0-9]/g, ''),
        username: username,
        mfa_required: true,
        demo_otp: '749102'
      }, 200);
    }

    if (parsedPath === '/api/v1/auth/register' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const username = body.username || 'new_user';
      return jsonResponse({
        ok: true,
        user_id: 'u-' + username.toLowerCase().replace(/[^a-z0-9]/g, ''),
        username: username,
        email: body.email,
        mfa_enabled: body.mfa_enabled !== false
      }, 201);
    }

    if (parsedPath === '/api/v1/auth/verify-mfa' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      if (body.otp === '749102' || body.otp === '123456') {
        return jsonResponse({ ok: true, verified: true, token: 'mock-jwt-token-' + Date.now() }, 200);
      }
      return jsonResponse({ error: 'INVALID_OTP', message: 'Security code is invalid or expired' }, 401);
    }

    // 8. Admin Reset
    if (parsedPath.match(/^\/api\/v1\/admin\/events(\/[^/]+\/reset)?$/) && method === 'POST') {
      for (let i = 1; i <= TOTAL_SEATS; i++) {
        const sId = 'S' + String(i).padStart(3, '0');
        seats[sId] = 'FREE';
      }
      for (const k of Object.keys(owners)) delete owners[k];
      for (const k of Object.keys(reservations)) delete reservations[k];
      for (const k of Object.keys(soldMap)) delete soldMap[k];
      pgBookings.clear();

      return jsonResponse({ event_id: 'evt1', seat_count: TOTAL_SEATS }, 200);
    }

    return jsonResponse({ error: 'NOT_FOUND', message: 'Endpoint not found in mock API' }, 404);
  };
})();
