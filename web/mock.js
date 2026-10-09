// FlashSeat Mock API Layer - Owned by [P5]
// This mock is ONLY loaded and active when the page URL contains ?mock=1
(function () {
  'use strict';

  console.log('[FlashSeat Mock API] Mock mode active (?mock=1). Intercepting /api/v1 requests.');
  window.__MOCK_ACTIVE__ = true;

  const TOTAL_SEATS = 200;
  const HOLD_TTL_MS = 30000; // 30s TTL for live UI testing

  // Multi-Event State Stores for BookMyShow Catalog
  const MOVIE_CATALOG_DATA = {
    evt1: {
      event_id: 'evt1',
      name: 'Spider-Man: No Way Home',
      category: 'Action',
      tags: ['Action', 'Sci-Fi', 'Adventure'],
      rating: 'UA 16+',
      runtime: '148 min',
      language: 'English, Hindi',
      format: 'IMAX 2D',
      date: '2026-01-31T11:15:00Z',
      startTime: '11:15 AM',
      endTime: '1:45 PM',
      theater: 'Cinema 3 &bull; Dolby Atmos',
      venue: 'PVR: Inorbit Mall, Cyberabad',
      price: 50.00,
      currency: 'USD',
      poster: 'spiderman_poster.svg',
      shows: ['11:15 AM', '02:30 PM', '06:00 PM', '09:30 PM'],
      description: 'With Spider-Man\'s identity revealed, Peter asks Doctor Strange for help. When a spell goes wrong, multiverse foes emerge.'
    },
    evt2: {
      event_id: 'evt2',
      name: 'Dune: Part Two',
      category: 'Sci-Fi',
      tags: ['Sci-Fi', 'Adventure', 'Drama'],
      rating: 'UA 13+',
      runtime: '166 min',
      language: 'English, Hindi',
      format: 'IMAX 70mm',
      date: '2026-01-31T14:30:00Z',
      startTime: '02:30 PM',
      endTime: '05:15 PM',
      theater: 'Cinema 1 &bull; Grand Laser IMAX',
      venue: 'INOX: Megaplex Arena',
      price: 55.00,
      currency: 'USD',
      poster: 'dune_poster.svg',
      shows: ['01:00 PM', '02:30 PM', '07:00 PM', '10:30 PM'],
      description: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.'
    },
    evt3: {
      event_id: 'evt3',
      name: 'Deadpool & Wolverine',
      category: 'Action',
      tags: ['Action', 'Comedy', 'Superhero'],
      rating: 'A 18+',
      runtime: '128 min',
      language: 'English, Hindi, Telugu',
      format: '4DX 3D',
      date: '2026-01-31T18:00:00Z',
      startTime: '06:00 PM',
      endTime: '08:10 PM',
      theater: 'Cinema 2 &bull; Prime Lounge',
      venue: 'Cinepolis: Grand VIP Lounge',
      price: 48.00,
      currency: 'USD',
      poster: 'deadpool_poster.svg',
      shows: ['12:30 PM', '03:45 PM', '06:00 PM', '09:15 PM'],
      description: 'Wolverine is recovering from his injuries when he crosses paths with the loudmouth Deadpool to defeat a common enemy.'
    },
    evt4: {
      event_id: 'evt4',
      name: 'Oppenheimer',
      category: 'Drama',
      tags: ['Biography', 'Drama', 'History'],
      rating: 'R / UA',
      runtime: '180 min',
      language: 'English',
      format: 'IMAX 70mm',
      date: '2026-01-31T20:30:00Z',
      startTime: '08:30 PM',
      endTime: '11:30 PM',
      theater: 'Cinema 4 &bull; 70mm Film Dome',
      venue: 'PVR Director\'s Cut',
      price: 60.00,
      currency: 'USD',
      poster: 'oppenheimer_poster.svg',
      shows: ['10:45 AM', '02:45 PM', '08:30 PM'],
      description: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.'
    },
    evt5: {
      event_id: 'evt5',
      name: 'Interstellar (10th Anniv. IMAX)',
      category: 'Sci-Fi',
      tags: ['Sci-Fi', 'Mystery', 'Adventure'],
      rating: 'UA 13+',
      runtime: '169 min',
      language: 'English',
      format: 'IMAX 2D',
      date: '2026-02-01T21:45:00Z',
      startTime: '09:45 PM',
      endTime: '12:35 AM',
      theater: 'Cinema 5 &bull; Laser Audi',
      venue: 'Miraj Cinemas: IMAX Dome',
      price: 50.00,
      currency: 'USD',
      poster: 'interstellar_poster.svg',
      shows: ['11:00 AM', '04:00 PM', '09:45 PM'],
      description: 'When Earth becomes uninhabitable, an ex-NASA pilot is tasked with piloting a spacecraft along with a team of researchers.'
    }
  };

  const eventStores = {};
  const INITIAL_BOOKED = {
    evt1: ['S008', 'S009', 'S020'],
    evt2: ['S005', 'S006', 'S012', 'S013', 'S025', 'S026'],
    evt3: ['S001', 'S002', 'S010', 'S011', 'S040', 'S041'],
    evt4: ['S015', 'S016', 'S017'],
    evt5: ['S003', 'S004', 'S021', 'S022']
  };

  function getStore(eId) {
    const id = eId || 'evt1';
    if (!eventStores[id]) {
      const s = {};
      for (let i = 1; i <= TOTAL_SEATS; i++) {
        const seatId = 'S' + String(i).padStart(3, '0');
        s[seatId] = 'FREE';
      }
      const initialBooked = INITIAL_BOOKED[id] || [];
      const pgSet = new Set();
      const sold = {};
      initialBooked.forEach(sid => {
        if (s[sid]) {
          s[sid] = 'SOLD';
          sold[sid] = 'init_' + sid;
          pgSet.add(sid);
        }
      });
      eventStores[id] = {
        seats: s,
        reservations: {},
        owners: {},
        soldMap: sold,
        pgBookings: pgSet
      };
    }
    return eventStores[id];
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

  function reapExpiredHolds(store) {
    if (!store) return;
    const now = Date.now();
    for (const rid of Object.keys(store.reservations)) {
      const res = store.reservations[rid];
      if (res.status === 'HELD' && res.expires_at_ms <= now) {
        res.status = 'EXPIRED';
        const sId = res.seat_id;
        if (store.owners[sId] === rid) {
          delete store.owners[sId];
          store.seats[sId] = 'FREE';
          console.log(`[FlashSeat Mock API] Reaped expired hold on ${sId} (rid: ${rid})`);
        }
      }
    }
  }

  function reapAllStores() {
    for (const st of Object.values(eventStores)) {
      reapExpiredHolds(st);
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

    // Always reap expired holds across all stores before handling any request
    reapAllStores();

    // 1. GET /api/v1/events/{e}/seats
    const seatsMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/seats$/);
    if (seatsMatch && method === 'GET') {
      const eId = seatsMatch[1];
      const store = getStore(eId);
      reapExpiredHolds(store);
      return jsonResponse({ seats: { ...store.seats } }, 200);
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

      const eId = reserveMatch[1];
      const store = getStore(eId);
      reapExpiredHolds(store);

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
        const freeSeats = Object.keys(store.seats).filter(s => store.seats[s] === 'FREE');
        if (freeSeats.length === 0) {
          return jsonResponse({ error: 'SOLD_OUT', message: 'Event is completely sold out' }, 409);
        }
        seatId = freeSeats[Math.floor(Math.random() * freeSeats.length)];
      }

      if (!store.seats[seatId]) {
        return jsonResponse({ error: 'SEAT_UNKNOWN', message: `Seat ${seatId} does not exist` }, 404);
      }

      if (store.seats[seatId] === 'SOLD') {
        return jsonResponse({ error: 'SEAT_SOLD', message: `Seat ${seatId} has already been purchased` }, 409);
      }

      if (store.seats[seatId] === 'HELD') {
        return jsonResponse({ error: 'SEAT_HELD', message: `Seat ${seatId} is currently held by another customer` }, 409);
      }

      // Reserve the seat
      store.seats[seatId] = 'HELD';
      const rid = generateRid();
      const expiresAt = Date.now() + HOLD_TTL_MS;

      store.reservations[rid] = {
        rid,
        seat_id: seatId,
        user_id: userId,
        expires_at_ms: expiresAt,
        status: 'HELD'
      };
      store.owners[seatId] = rid;

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

      const eId = confirmMatch[1];
      const rid = confirmMatch[2];
      const store = getStore(eId);
      const res = store.reservations[rid];

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
      store.seats[res.seat_id] = 'SOLD';
      store.soldMap[res.seat_id] = rid;
      delete store.owners[res.seat_id];

      // Simulate async writer worker: persisted lands in Postgres
      setTimeout(() => {
        store.pgBookings.add(res.seat_id);
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
      const eId = releaseMatch[1];
      const rid = releaseMatch[2];
      const store = getStore(eId);
      const res = store.reservations[rid];

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
      store.seats[res.seat_id] = 'FREE';
      delete store.owners[res.seat_id];

      return jsonResponse({ status: 'RELEASED', seat_id: res.seat_id }, 200);
    }

    // 5. GET /api/v1/events/{e}/stats
    const statsMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/stats$/);
    if (statsMatch && method === 'GET') {
      const eId = statsMatch[1];
      const store = getStore(eId);
      reapExpiredHolds(store);

      let free = 0;
      let held = 0;
      let sold = 0;

      for (const s of Object.values(store.seats)) {
        if (s === 'FREE') free++;
        else if (s === 'HELD') held++;
        else if (s === 'SOLD') sold++;
      }

      const persisted = store.pgBookings.size;
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
      const store = getStore(eId);

      let sold = 0;
      for (const s of Object.values(store.seats)) {
        if (s === 'SOLD') sold++;
      }

      for (const sId of Object.keys(store.soldMap)) {
        store.pgBookings.add(sId);
      }

      const pgCount = store.pgBookings.size;
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

    // 7. Authentic User Authentication & Real Multi-Factor Authentication (MFA)
    function getStoredUsers() {
      try {
        const u = localStorage.getItem('flashseat_users_db');
        return u ? JSON.parse(u) : {};
      } catch (e) {
        return {};
      }
    }

    function saveStoredUsers(users) {
      try {
        localStorage.setItem('flashseat_users_db', JSON.stringify(users));
      } catch (e) {}
    }

    // Active MFA challenges: user_id -> { code, expires_at, attempts }
    if (!window.__MFA_CHALLENGES__) {
      window.__MFA_CHALLENGES__ = {};
    }
    const mfaChallenges = window.__MFA_CHALLENGES__;

    if (parsedPath === '/api/v1/auth/register' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const username = (body.username || '').trim();
      const password = body.password || '';

      if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return jsonResponse({
          error: 'INVALID_USERNAME',
          message: 'Username must be 3-20 characters long and contain only letters, numbers, or underscores.'
        }, 422);
      }
      if (!password || password.length < 6) {
        return jsonResponse({
          error: 'WEAK_PASSWORD',
          message: 'Password must be at least 6 characters long.'
        }, 422);
      }

      const users = getStoredUsers();
      const userKey = username.toLowerCase();
      if (users[userKey]) {
        return jsonResponse({
          error: 'USER_EXISTS',
          message: 'Username is already registered. Please sign in or use a different username.'
        }, 409);
      }

      const userId = 'u-' + userKey;
      const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let totpSecret = '';
      for (let i = 0; i < 16; i++) {
        totpSecret += base32Chars[Math.floor(Math.random() * base32Chars.length)];
      }

      users[userKey] = {
        user_id: userId,
        username: username,
        password: password,
        mfa_enabled: body.mfa_enabled !== false,
        totp_secret: totpSecret,
        created_at: Date.now()
      };
      saveStoredUsers(users);

      return jsonResponse({
        ok: true,
        user_id: userId,
        username: username,
        mfa_enabled: users[userKey].mfa_enabled,
        totp_secret: totpSecret,
        message: 'Account registered successfully.'
      }, 201);
    }

    if (parsedPath === '/api/v1/auth/login' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const username = (body.username || '').trim();
      const password = body.password || '';

      if (!username || !password) {
        return jsonResponse({
          error: 'MISSING_FIELDS',
          message: 'Please provide both username and password.'
        }, 422);
      }

      const users = getStoredUsers();
      const userKey = username.toLowerCase();
      const user = users[userKey];

      if (!user || user.password !== password) {
        return jsonResponse({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password.'
        }, 401);
      }

      if (user.mfa_enabled) {
        // Generate authentic cryptographic 6-digit challenge code
        let challengeCode;
        if (window.crypto && window.crypto.getRandomValues) {
          const arr = new Uint32Array(1);
          window.crypto.getRandomValues(arr);
          challengeCode = String((arr[0] % 900000) + 100000);
        } else {
          challengeCode = String(Math.floor(100000 + Math.random() * 900000));
        }

        const expiresAt = Date.now() + 60000;
        mfaChallenges[user.user_id] = {
          code: challengeCode,
          expires_at: expiresAt,
          attempts: 0
        };

        return jsonResponse({
          ok: true,
          mfa_required: true,
          user_id: user.user_id,
          username: user.username,
          totp_secret: user.totp_secret,
          challenge_code: challengeCode,
          expires_at_ms: expiresAt
        }, 200);
      }

      return jsonResponse({
        ok: true,
        mfa_required: false,
        user_id: user.user_id,
        username: user.username,
        token: 'fs-token-' + Date.now()
      }, 200);
    }

    if (parsedPath === '/api/v1/auth/resend-mfa' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const userId = body.user_id;
      if (!userId) {
        return jsonResponse({ error: 'MISSING_USER', message: 'User ID is required.' }, 422);
      }
      let challengeCode;
      if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        challengeCode = String((arr[0] % 900000) + 100000);
      } else {
        challengeCode = String(Math.floor(100000 + Math.random() * 900000));
      }
      const expiresAt = Date.now() + 60000;
      mfaChallenges[userId] = {
        code: challengeCode,
        expires_at: expiresAt,
        attempts: 0
      };
      return jsonResponse({
        ok: true,
        challenge_code: challengeCode,
        expires_at_ms: expiresAt
      }, 200);
    }

    if (parsedPath === '/api/v1/auth/verify-mfa' && method === 'POST') {
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
      const userId = body.user_id;
      const otp = (body.otp || '').trim();

      if (!otp || !/^\d{6}$/.test(otp)) {
        return jsonResponse({
          error: 'INVALID_FORMAT',
          message: 'Security code must be exactly 6 numeric digits.'
        }, 422);
      }

      const challenge = mfaChallenges[userId];
      if (!challenge) {
        return jsonResponse({
          error: 'NO_CHALLENGE',
          message: 'No active MFA challenge found. Please sign in again.'
        }, 404);
      }

      if (Date.now() > challenge.expires_at) {
        return jsonResponse({
          error: 'CODE_EXPIRED',
          message: 'Security code has expired. Please request a new code.'
        }, 410);
      }

      if (challenge.attempts >= 3) {
        delete mfaChallenges[userId];
        return jsonResponse({
          error: 'TOO_MANY_ATTEMPTS',
          message: 'Maximum verification attempts exceeded. Please sign in again.'
        }, 429);
      }

      if (otp === challenge.code) {
        delete mfaChallenges[userId];
        return jsonResponse({
          ok: true,
          verified: true,
          token: 'fs-auth-token-' + Date.now()
        }, 200);
      } else {
        challenge.attempts += 1;
        const remaining = 3 - challenge.attempts;
        return jsonResponse({
          error: 'INVALID_OTP',
          message: `Incorrect security code. ${remaining} attempt(s) remaining.`
        }, 401);
      }
    }

    // 8. Admin Reset
    const adminResetMatch = parsedPath.match(/^\/api\/v1\/admin\/events(?:\/([^/]+)\/reset)?$/);
    if (adminResetMatch && method === 'POST') {
      const eId = adminResetMatch[1] || 'evt1';
      const store = getStore(eId);
      for (let i = 1; i <= TOTAL_SEATS; i++) {
        const sId = 'S' + String(i).padStart(3, '0');
        store.seats[sId] = 'FREE';
      }
      for (const k of Object.keys(store.owners)) delete store.owners[k];
      for (const k of Object.keys(store.reservations)) delete store.reservations[k];
      for (const k of Object.keys(store.soldMap)) delete store.soldMap[k];
      store.pgBookings.clear();

      return jsonResponse({ event_id: eId, seat_count: TOTAL_SEATS }, 200);
    }

    // 9. GET /api/v1/events (Discovery & Search)
    if (parsedPath === '/api/v1/events' && method === 'GET') {
      const u = new URL(url, window.location.origin);
      const search = (u.searchParams.get('search') || '').trim().toLowerCase();
      const category = (u.searchParams.get('category') || '').trim().toLowerCase();

      let list = Object.values(MOVIE_CATALOG_DATA).map(m => {
        const store = getStore(m.event_id);
        reapExpiredHolds(store);
        let freeCount = 0, soldCount = 0, heldCount = 0;
        for (const s of Object.values(store.seats)) {
          if (s === 'FREE') freeCount++;
          else if (s === 'SOLD') soldCount++;
          else if (s === 'HELD') heldCount++;
        }
        return {
          ...m,
          total: TOTAL_SEATS,
          seat_count: TOTAL_SEATS,
          free: freeCount,
          held: heldCount,
          sold: soldCount
        };
      });

      if (category) {
        list = list.filter(e => (e.category || '').toLowerCase() === category);
      }
      if (search) {
        list = list.filter(e =>
          (e.name || '').toLowerCase().includes(search) ||
          (e.venue || '').toLowerCase().includes(search) ||
          (e.description || '').toLowerCase().includes(search) ||
          (e.format || '').toLowerCase().includes(search) ||
          (e.tags || []).some(t => t.toLowerCase().includes(search))
        );
      }

      return jsonResponse({ events: list, total_events: list.length }, 200);
    }

    // 10. GET /api/v1/events/:id (Single Event Detail)
    const eventDetailMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)$/);
    if (eventDetailMatch && method === 'GET') {
      const eId = eventDetailMatch[1];
      const store = getStore(eId);
      reapExpiredHolds(store);

      let freeCount = 0, soldCount = 0, heldCount = 0;
      for (const s of Object.values(store.seats)) {
        if (s === 'FREE') freeCount++;
        else if (s === 'SOLD') soldCount++;
        else if (s === 'HELD') heldCount++;
      }

      const m = MOVIE_CATALOG_DATA[eId] || {
        event_id: eId,
        name: `Event ${eId.toUpperCase()}`,
        venue: 'Grand Pavilion Arena',
        date: '2026-01-31T11:15:00Z',
        category: 'Cinema',
        description: 'Live flash-sale event with 200 real-time contention-free seats and sub-second locking.',
        price: 50.00,
        currency: 'USD'
      };

      return jsonResponse({
        ...m,
        total: TOTAL_SEATS,
        seat_count: TOTAL_SEATS,
        free: freeCount,
        held: heldCount,
        sold: soldCount
      }, 200);
    }

    // 11. GET /api/v1/events/:id/reservations/:rid (Inspect Reservation)
    const getResMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/reservations\/([^/]+)$/);
    if (getResMatch && method === 'GET') {
      const eId = getResMatch[1];
      const rid = getResMatch[2];
      const store = getStore(eId);
      const res = store.reservations[rid];
      if (!res) {
        return jsonResponse({ error: 'UNKNOWN', message: 'Reservation not found' }, 404);
      }
      const now = Date.now();
      const ttl = Math.max(0, res.expires_at_ms - now);
      return jsonResponse({
        reservation_id: rid,
        event_id: eId,
        seat_id: res.seat_id,
        status: res.status,
        expires_at_ms: res.expires_at_ms,
        ttl_ms: ttl
      }, 200);
    }

    // 12. GET /api/v1/events/:id/tickets/:rid/verify or /api/v1/tickets/verify
    const ticketVerifyMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/tickets\/([^/]+)\/verify$/);
    if ((ticketVerifyMatch || parsedPath === '/api/v1/tickets/verify') && method === 'GET') {
      let eId = 'evt1';
      let rid = '';
      if (ticketVerifyMatch) {
        eId = ticketVerifyMatch[1];
        rid = ticketVerifyMatch[2];
      } else {
        const u = new URL(url, window.location.origin);
        eId = u.searchParams.get('event_id') || 'evt1';
        rid = u.searchParams.get('reservation_id') || '';
      }

      const store = getStore(eId);
      const res = store.reservations[rid];
      if (!res || res.status !== 'CONFIRMED') {
        return jsonResponse({
          valid: false,
          error: 'TICKET_INVALID_OR_NOT_CONFIRMED',
          message: 'Ticket is either not found, unconfirmed, or expired.'
        }, 404);
      }

      return jsonResponse({
        valid: true,
        event_id: eId,
        reservation_id: rid,
        seat_id: res.seat_id,
        status: 'CONFIRMED',
        verification_code: 'TKT-MOCK-' + rid.substring(0, 8).toUpperCase(),
        verified_at: new Date().toISOString()
      }, 200);
    }

    // 13. GET /api/v1/admin/overview
    if (parsedPath === '/api/v1/admin/overview' && method === 'GET') {
      const u = new URL(url, window.location.origin);
      const eId = u.searchParams.get('event_id') || 'evt1';
      const store = getStore(eId);
      let free = 0, held = 0, sold = 0;
      for (const s of Object.values(store.seats)) {
        if (s === 'FREE') free++;
        else if (s === 'HELD') held++;
        else if (s === 'SOLD') sold++;
      }
      return jsonResponse({
        refreshed_at: new Date().toISOString(),
        event_id: eId,
        inventory: {
          total: TOTAL_SEATS,
          free,
          held,
          sold,
          hold_ttl_ms: HOLD_TTL_MS
        },
        persistence: {
          persisted_bookings: store.pgBookings.size,
          backlog: Math.max(0, sold - store.pgBookings.size),
          stream_len: sold,
          worker_status: 'HEALTHY',
          consistent: sold === store.pgBookings.size
        },
        telemetry: {
          reserves: { ok: sold + held, seat_held: 3, seat_sold: 2 },
          confirms: { ok: sold, hold_expired: 1 },
          rate_limiting: { enabled: true, capacity: 20, refill_per_sec: 10 },
          waiting_room: { enabled: false, max_admitted: 50 }
        }
      }, 200);
    }

    // 14. Virtual Waiting Room Mock Routes (Feature 6)
    let mockQueueSimPosition = 3;

    if (parsedPath.match(/^\/api\/v1\/events\/[^/]+\/(queue|waiting-room)\/join$/) && method === 'POST') {
      const isSimQueue = window.location.search.includes('mock_queue=1');
      if (isSimQueue) {
        mockQueueSimPosition = 3;
        return jsonResponse({
          enabled: true,
          admitted: false,
          status: 'WAITING',
          queue_entry_id: 'mock-entry-1',
          admission_token: null,
          position: mockQueueSimPosition,
          users_ahead: mockQueueSimPosition - 1,
          estimated_wait_seconds: 6,
          poll_interval_ms: 2000
        }, 200);
      }
      return jsonResponse({
        enabled: false,
        admitted: true,
        status: 'BYPASS',
        queue_entry_id: 'mock-entry-bypass',
        admission_token: null,
        position: 0,
        users_ahead: 0,
        estimated_wait_seconds: 0,
        poll_interval_ms: 2000
      }, 200);
    }

    if (parsedPath.match(/^\/api\/v1\/events\/[^/]+\/(queue|waiting-room)\/status$/) && method === 'GET') {
      const isSimQueue = window.location.search.includes('mock_queue=1');
      if (isSimQueue) {
        if (mockQueueSimPosition > 1) {
          mockQueueSimPosition--;
          return jsonResponse({
            enabled: true,
            admitted: false,
            status: 'WAITING',
            queue_entry_id: 'mock-entry-1',
            admission_token: null,
            position: mockQueueSimPosition,
            users_ahead: mockQueueSimPosition - 1,
            estimated_wait_seconds: mockQueueSimPosition * 2,
            poll_interval_ms: 2000
          }, 200);
        } else {
          return jsonResponse({
            enabled: true,
            admitted: true,
            status: 'ADMITTED',
            queue_entry_id: 'mock-entry-1',
            admission_token: 'mock-adm-token-' + Date.now(),
            position: 0,
            users_ahead: 0,
            expires_at_ms: Date.now() + 120000,
            estimated_wait_seconds: 0,
            poll_interval_ms: 2000
          }, 200);
        }
      }
      return jsonResponse({
        enabled: false,
        admitted: true,
        status: 'BYPASS',
        queue_entry_id: 'mock-entry-bypass',
        admission_token: null,
        position: 0,
        users_ahead: 0,
        estimated_wait_seconds: 0,
        poll_interval_ms: 2000
      }, 200);
    }

    if (parsedPath.match(/^\/api\/v1\/events\/[^/]+\/(queue|waiting-room)\/leave$/) && method === 'POST') {
      mockQueueSimPosition = 3;
      return jsonResponse({ ok: true, status: 'LEFT' }, 200);
    }

    if (parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/(queue|waiting-room)\/stats$/) && method === 'GET') {
      const eMatch = parsedPath.match(/^\/api\/v1\/events\/([^/]+)\/(queue|waiting-room)\/stats$/);
      const eId = eMatch ? eMatch[1] : 'evt1';
      return jsonResponse({
        event_id: eId,
        enabled: false,
        waiting_count: 0,
        admitted_count: 0,
        max_admitted: 50,
        admission_rate_per_sec: 10,
        max_queue_size: 10000,
        token_ttl_sec: 120,
        poll_interval_ms: 2000,
        admissions_total: 0,
        expired_total: 0,
        rejected_total: 0,
        left_total: 0,
        avg_wait_seconds: 0,
        queue_status: 'DISABLED'
      }, 200);
    }

    return jsonResponse({ error: 'NOT_FOUND', message: 'Endpoint not found in mock API' }, 404);
  };
})();
