# FlashSeat

High-Contention Flash-Reservation & Seat Inventory Locking Engine with Real-Time Telemetry and Verifiable Digital Tickets.

---

## 🌟 6 Production Features Implemented

### 1. Interactive Live Seat Selection (`web/index.html`)
- **Real Backend Inventory**: Connects to `GET /api/v1/events/{event_id}/seats` with sub-second polling (1.5s interval with overlap guard).
- **Seat States**: Clearly distinguishes `FREE` (Emerald), `HELD` (Amber), `SOLD` (Crimson), and `SELECTED` (Cyan highlight).
- **Accessibility & Pricing**: Full ARIA roles (`role="button"`, `aria-label`), keyboard navigation (`Enter` / `Space`), transparent seat pricing ($45.00 USD), and subtotal calculation.
- **Atomic Conflict Prevention**: Prevents stale client selections; the backend atomically validates seat state in Redis Lua, rejecting conflicts with authoritative `409 SEAT_HELD` or `409 SEAT_SOLD` messages.

### 2. Reservation Countdown and Expiry (`app/routes/reservations.py`, `web/index.html`)
- **Authoritative Expiry**: Uses exact `expires_at_ms` and `ttl_ms` from Redis Lua `reserve.lua`.
- **Active Hold Inspection**: `GET /api/v1/events/{event_id}/reservations/{reservation_id}` returns exact server hold status and remaining TTL.
- **30-Second Expiry Warning**: Displays flashing amber warning when less than 30s remain on hold.
- **Automatic Expiry Transition**: Disables confirm action at expiry (`00:00`), displays `EXPIRED` badge, and refreshes inventory.
- **Explicit Release**: `DELETE /api/v1/events/{event_id}/reservations/{reservation_id}` releases held seats back to `FREE` immediately.

### 3. Booking Confirmation and Digital Ticket (`web/ticket.html`, `app/routes/reservations.py`)
- **Boarding Pass View**: Shows event details, confirmed seat ID, reservation ID, and verification code.
- **Server-Side Verification**: `GET /api/v1/events/{event_id}/tickets/{reservation_id}/verify` checks Redis and Postgres booking state. Unconfirmed or expired reservations return `404` and are rejected.
- **Cryptographic Stamp**: Generates tamper-evident verification code (`TKT-XXXXXXXXXXXX`) without exposing database credentials or secrets.
- **Offline Printable Ticket**: `@media print` CSS layout for clean printing or saving to PDF.

### 4. Live Admin & Operations Dashboard (`web/dashboard.html`, `app/routes/admin.py`)
- **Operations Endpoint**: `GET /api/v1/admin/overview?event_id=evt1` protected via `X-Admin-Key` header or `admin_key` query parameter (`401 UNAUTHORIZED` if omitted).
- **Comprehensive Metrics**:
  - Real-time seat inventory (total, free, held, sold)
  - Postgres durable bookings, write backlog, and Redis stream length (`fr:bookings`)
  - Prometheus reserve and confirm counters (`RESERVE_TOTAL`, `CONFIRM_TOTAL`)
  - Background worker persistence health (`HEALTHY` / `IDLE`)
- **Native 60s Canvas Chart**: Rolling history chart drawn on native HTML5 `<canvas>` (zero chart library dependencies).
- **Consistency Verification**: `GET /api/v1/events/{event_id}/verify` tests database drain and no double-booking invariants.

### 5. Event Discovery and Search (`web/events.html`, `app/routes/events.py`)
- **Event Catalog**: `GET /api/v1/events` provides real-time seat availability across events (`evt1`, `evt2`, `evt3`).
- **Debounced Search**: Filter events by keyword (name, venue, description, category).
- **Category Filters**: Instant filtering by Concert, Conference, or Music.
- **Event Detail**: `GET /api/v1/events/{event_id}` returns single event metadata and live seat capacity.

### 6. Virtual Waiting Room for High Demand (`app/services/waiting_room.py`, `app/routes/waiting_room.py`)
- **Isolated Service**: Clean, isolated module enabled via `WAITING_ROOM_ENABLED=true` (disabled by default for standard reservations).
- **Redis FIFO Queue**: Uses Redis Sorted Sets (`fr:{event_id}:wr:queue`) to order incoming queue traffic.
- **Admission Tokens**: Issues short-lived, validated admission tokens (`WAITING_ROOM_TOKEN_TTL_SEC=300`) stored in Redis.
- **Server-Side Bypass Prevention**: When enabled, `POST /api/v1/events/{event_id}/reserve` rejects unauthorized requests with `403 QUEUE_ADMISSION_REQUIRED` unless a valid `X-Admission-Token` header is provided.

---

## 🚀 Quickstart & Local Execution

### Start Stack via Docker Compose
```bash
docker compose up --build -d
```

Verify service health:
```bash
curl http://localhost:8000/healthz
# Expected: {"ok": true}
```

View application logs:
```bash
docker compose logs -f app
```

Stop stack:
```bash
docker compose down
```

---

## 🌐 Vercel Deployment Guide

FlashSeat frontend is built with vanilla HTML5, CSS3, and modern JavaScript, with zero build steps or external bundlers.

### 1. Deploy Frontend to Vercel
1. Install Vercel CLI (or link repository in [vercel.com](https://vercel.com)):
   ```bash
   vercel
   ```
2. Accept the default root directory (`./`). The root [`vercel.json`](vercel.json) automatically routes:
   - `/` & `/ui` &rarr; `web/index.html`
   - `/events` &rarr; `web/events.html`
   - `/ticket` &rarr; `web/ticket.html`
   - `/dashboard` &rarr; `web/dashboard.html`
   - `/login` &rarr; `web/login.html`
3. In production, configure the frontend to point to your deployed FastAPI backend URL by setting `window.__API_BASE__` or specifying `localStorage.setItem('flashseat_api_base', 'https://api.yourdomain.com/api/v1')`.

### 2. Configure Backend CORS
Set the `CORS_ORIGINS` environment variable in your backend hosting environment (e.g. Render, Railway, Fly.io, AWS):
```env
CORS_ORIGINS=https://your-project.vercel.app
```

---

## 🧪 Running Tests

Run backend route, inventory, and feature test suites:
```bash
pytest tests/test_p2_routes.py tests/test_feature_routes.py -v
```

Run integration tests against running Redis/Postgres stack:
```bash
pytest
```

Run k6 load tests using the `loadtest` compose profile:
```bash
docker compose --profile loadtest run --rm k6 run /loadtest/k6_flash.js
```
