# FlashSeat

High-Contention Flash-Reservation & Seat Inventory Locking Engine with Real-Time Telemetry, Verifiable Digital Tickets, and Secure Razorpay Payment Integration (Test Mode).

---

## 🌟 1. Overview & Architecture

FlashSeat guarantees **zero double-bookings** under high concurrency by offloading inventory locks from the relational database to an in-memory transactional broker (Redis + atomic Lua scripts). Finalized bookings are persisted asynchronously to PostgreSQL via Redis Streams.

### Reservation & Payment Lifecycle

```
[User / Browser]
       │
       │ 1. POST /api/v1/events/{e}/reserve
       ▼
[Redis Inventory Engine] ──(Atomic Lua Hold: 120s TTL)──> Free -> Held
       │
       │ 2. POST /api/v1/payments/order
       ▼
[FastAPI Backend] ──(Authoritative Price: ₹500)──> [Razorpay Gateway API]
       │                                                      │
       │ 3. Client Opens Razorpay Checkout Modal              │
       │    User enters test card/UPI/netbanking details      │
       │                                                      ▼
       │ 4. POST /api/v1/payments/verify ◄──(Signature + Payment ID)
       ▼
[FastAPI Backend]
       ├── a. Verify HMAC-SHA256 signature with Server Key Secret
       ├── b. Verify status and captured amount with Razorpay API
       ├── c. Confirm seat hold atomically via confirm.lua in Redis
       │      ├── If OK / ALREADY_CONFIRMED:
       │      │   └── Mark status 'paid', generate booking ref, issue ticket
       │      └── If HOLD_EXPIRED:
       │          └── DO NOT issue ticket; trigger auto-refund via Razorpay API
       ▼
[Redis Stream `fr:bookings`] ──(Stream Consumer: `writer.py`)──> [Postgres `bookings` table]
```

---

## 🌟 2. Six Production Features

### 1. Interactive Live Seat Selection (`web/index.html`)
- **Real Backend Inventory**: Connects to `GET /api/v1/events/{event_id}/seats` with sub-second polling (1.5s interval with overlap guard).
- **Seat States**: Clearly distinguishes `FREE` (Emerald), `HELD` (Amber), `SOLD` (Crimson), and `SELECTED` (Cyan highlight).
- **Accessibility & Pricing**: Full ARIA roles (`role="button"`, `aria-label`), keyboard navigation (`Enter` / `Space`), transparent seat pricing, and subtotal calculation.
- **Atomic Conflict Prevention**: Prevents stale client selections; backend atomically validates seat state in Redis Lua, rejecting conflicts with authoritative `409 SEAT_HELD` or `409 SEAT_SOLD` messages.

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

## 💳 3. Razorpay Test-Mode Setup

1. **Obtain Test Keys**:
   - Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com/).
   - Switch the toggle in the header from **Live Mode** to **Test Mode**.
   - Navigate to **Settings > API Keys** and click **Generate Key**.
   - Copy `Key ID` (starts with `rzp_test_...`) and `Key Secret`.
   - Never use Live Mode credentials in local development or automated testing.

2. **Test Webhook Secret**:
   - Go to **Settings > Webhooks > Add New Webhook**.
   - Set Webhook URL (e.g. `https://<your-ngrok-domain>/api/v1/payments/webhook`).
   - Enter a secret (e.g. `test_webhook_secret_12345`).
   - Select events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`.

---

## ⚙️ 4. Required Environment Variables

Configure these variables in `.env` (copy from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL |
| `DATABASE_URL` | `postgresql://flash:flash@postgres:5432/flash` | PostgreSQL connection URL |
| `HOLD_TTL_MS` | `120000` | Duration of temporary seat holds (120 seconds) |
| `RL_ENABLED` | `true` | Enables token-bucket rate limiter |
| `ADMIN_SECRET_KEY` | `flash_admin_sec_2026` | Admin API authentication key |
| `WAITING_ROOM_ENABLED` | `false` | Enable high-demand virtual waiting room queue |
| `RAZORPAY_KEY_ID` | `rzp_test_placeholder_key_id` | Razorpay public test key ID |
| `RAZORPAY_KEY_SECRET` | `placeholder_secret_key_1234567890` | Razorpay private secret (SERVER ONLY) |
| `RAZORPAY_WEBHOOK_SECRET` | `placeholder_webhook_secret_987654321`| Webhook verification secret (SERVER ONLY) |
| `TICKET_PRICE_PAISE` | `50000` | Server-authoritative ticket price in paise (50,000 = ₹500.00) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins for external frontends |

> **SECURITY NOTICE**: The frontend only ever receives the public `key_id`. `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never exposed to the browser or client requests.

---

## 🚀 5. Quickstart & Local Execution

### Start Full Stack via Docker Compose
```bash
docker compose up --build -d
```

Verify service health:
```bash
curl http://localhost:8000/healthz
# Expected: {"ok": true}
```

Open the UI:
Navigate to [http://localhost:8000/ui/](http://localhost:8000/ui/) in your browser.

Stop stack:
```bash
docker compose down
```

### Running Locally without Docker
1. Start Redis and PostgreSQL locally or via container.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI application:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

---

## 🔒 6. Checkout & Webhook Security Architecture

### Checkout Signature Verification
Razorpay Checkout passes `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to the frontend handler. The backend verifies this using HMAC-SHA256:

$$\text{expected\_signature} = \text{HMAC-SHA256}(\text{order\_id} + "|" + \text{payment\_id}, \text{key\_secret})$$

Timing-safe comparison (`hmac.compare_digest`) ensures immunity to timing attacks.

### Webhook Verification & Deduplication
Webhooks sent to `POST /api/v1/payments/webhook` are verified using:

$$\text{expected\_signature} = \text{HMAC-SHA256}(\text{raw\_request\_body\_bytes}, \text{webhook\_secret})$$

Processed webhook event IDs are saved in the `webhook_events` PostgreSQL table with a `PRIMARY KEY` on `event_id`. Duplicate deliveries return `200 {"status": "already_processed"}` without re-executing state transitions.

---

## 🧪 7. Testing & Verification

### Running Automated Test Suites
Run payment integration tests:
```bash
pytest tests/test_payments.py -v
```

Run route and production feature test suites:
```bash
pytest tests/test_p2_routes.py tests/test_feature_routes.py -v
```

Run all unit tests:
```bash
pytest tests/test_payments.py tests/test_feature_routes.py tests/test_p2_routes.py -v
```

### Manual Testing with Razorpay Test Cards
1. Open [http://localhost:8000/ui/](http://localhost:8000/ui/).
2. Click an available green seat (or **Instant Reserve Any Seat**).
3. Observe the 2-minute countdown timer.
4. Click **Pay with Razorpay (₹500.00)**:
   - **Success Test**: Use Razorpay test card `4111 1111 1111 1111`, any future expiry (e.g. `12/30`), any CVV (`123`), enter test OTP `123456`.
   - **Failure Test**: In the test OTP modal, select **Failure**. The UI displays the failure notice and allows retry.
   - **Abandon / Close Test**: Click the modal close button. The UI notes that checkout was dismissed while preserving the hold until the countdown ends.
   - **Expiry Test**: Hold a seat, wait for the countdown to expire, then attempt payment. The engine triggers an automatic refund and displays the refund ID.

---

## 🌐 8. Vercel Deployment Guide

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
3. Configure `API_BASE` to point to your deployed FastAPI backend URL:
   - In browser: `localStorage.setItem('flashseat_api_base', 'https://api.yourdomain.com/api/v1')` or set `window.__API_BASE__`.

### 2. Configure Backend CORS
Set the `CORS_ORIGINS` environment variable in your backend hosting environment (e.g. Render, Railway, Fly.io, AWS):
```env
CORS_ORIGINS=https://your-project.vercel.app
```

---

## 🛡️ 9. Security & Production-Readiness Checklist

- [x] **Zero Secret Exposure**: `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never sent to the client.
- [x] **Authoritative Pricing**: Amount is determined strictly on the backend; client input is ignored.
- [x] **Cryptographic Verification**: HMAC-SHA256 signature verification protects both Checkout callbacks and Webhooks.
- [x] **Timing-Safe Digest Comparison**: `hmac.compare_digest` used for all signature checks.
- [x] **Idempotency**: Duplicate client callbacks and repeated webhooks cannot create multiple bookings or double-charges.
- [x] **Automatic Refund on Expired Holds**: If payment captures after a hold has expired, an immediate refund is dispatched.
- [x] **Durable Persistence**: `payments` and `webhook_events` tables persist all transactions with unique constraints.
- [x] **Tamper-Evident Tickets**: Verified digital passes stamped with unique codes and server-side verification.
