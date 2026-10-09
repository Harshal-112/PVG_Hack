# FlashSeat

High-Contention Flash-Reservation & Seat Inventory Locking Engine with Secure Razorpay Payment Integration (Test Mode).

---

## 1. Overview & Architecture

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

## 2. Razorpay Test-Mode Setup

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

## 3. Required Environment Variables

Configure these variables in `.env` (copy from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL |
| `DATABASE_URL` | `postgresql://flash:flash@postgres:5432/flash` | PostgreSQL connection URL |
| `HOLD_TTL_MS` | `120000` | Duration of temporary seat holds (120 seconds) |
| `RL_ENABLED` | `true` | Enables token-bucket rate limiter |
| `RAZORPAY_KEY_ID` | `rzp_test_placeholder_key_id` | Razorpay public test key ID |
| `RAZORPAY_KEY_SECRET` | `placeholder_secret_key_1234567890` | Razorpay private secret (SERVER ONLY) |
| `RAZORPAY_WEBHOOK_SECRET` | `placeholder_webhook_secret_987654321`| Webhook verification secret (SERVER ONLY) |
| `TICKET_PRICE_PAISE` | `50000` | Server-authoritative ticket price in paise (50,000 = ₹500.00) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins for external frontends |

> **SECURITY NOTICE**: The frontend only ever receives the public `key_id`. `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never exposed to the browser or client requests.

---

## 4. Local Startup Instructions

### Running with Docker Compose

Start the full stack (Redis 7, PostgreSQL 16, 4-worker FastAPI App, Background Writer Worker):

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

## 5. Checkout & Webhook Flow

### Checkout Signature Verification

Razorpay Checkout passes `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature` to the frontend handler. The backend verifies this using HMAC-SHA256:

$$\text{expected\_signature} = \text{HMAC-SHA256}(\text{order\_id} + "|" + \text{payment\_id}, \text{key\_secret})$$

Timing-safe comparison (`hmac.compare_digest`) ensures immunity to timing attacks.

### Webhook Verification & Deduplication

Webhooks sent to `POST /api/v1/payments/webhook` are verified using:

$$\text{expected\_signature} = \text{HMAC-SHA256}(\text{raw\_request\_body\_bytes}, \text{webhook\_secret})$$

Processed webhook event IDs are saved in the `webhook_events` PostgreSQL table with a `PRIMARY KEY` on `event_id`. Duplicate deliveries return `200 {"status": "already_processed"}` without re-executing state transitions.

---

## 6. How to Test Scenarios

### Running the Automated Test Suite

```bash
pytest tests/test_payments.py -v
```

This runs 13 unit and integration tests covering:
- Order creation & server-side pricing authority
- Invalid or expired reservation rejection (404 / 410)
- Invalid cryptographic signature rejection (400)
- Amount and currency mismatch detection (400)
- Uncaptured payment rejection (400)
- End-to-end verified payment and booking confirmation (200)
- Verification retry idempotency
- Automatic refund when hold expires before confirmation (410)
- Out-of-order and duplicate webhook deduplication
- Concurrent verification race-condition safety
- Payment status endpoint retrieval

### Manual Testing with Razorpay Test Cards

1. Open [http://localhost:8000/ui/](http://localhost:8000/ui/).
2. Click an available green seat (or **Instant Reserve Any Seat**).
3. Observe the 2-minute countdown timer.
4. Click **Pay with Razorpay**:
   - **Success Test**: Use Razorpay test card `4111 1111 1111 1111`, any future expiry (e.g. `12/30`), any CVV (`123`), enter test OTP `123456`.
   - **Failure Test**: In the test OTP modal, select **Failure**. The UI displays the failure notice and allows retry.
   - **Abandon / Close Test**: Click the modal close button. The UI notes that checkout was dismissed while preserving the hold until the countdown ends.
   - **Expiry Test**: Hold a seat, wait for the countdown to expire (or use `HOLD_TTL_MS=5000`), then attempt payment. The engine triggers an automatic refund and displays the refund ID.

---

## 7. Vercel Frontend Configuration

If deploying the static frontend (`web/`) to Vercel:

1. **Deploy `web/` directory**: Set `Root Directory` in Vercel project settings to `web`.
2. **API Base URL Configuration**:
   - The frontend reads `window.API_BASE_URL || localStorage.getItem('API_BASE_URL') || ''`.
   - Set the API URL in `web/index.html` or through an inline script before `app.js`:
     ```html
     <script>
       window.API_BASE_URL = "https://your-deployed-fastapi-backend.com";
     </script>
     ```
3. **Backend CORS Configuration**:
   - On the backend, configure `CORS_ORIGINS` in your environment:
     ```env
     CORS_ORIGINS=https://your-project.vercel.app
     ```
   - FastAPI `CORSMiddleware` automatically whitelists the Vercel domain.

---

## 8. Security & Production-Readiness Checklist

- [x] **Zero Secret Exposure**: `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are never sent to the client.
- [x] **Authoritative Pricing**: Amount is determined strictly on the backend; client input is ignored.
- [x] **Cryptographic Verification**: HMAC-SHA256 signature verification protects both Checkout callbacks and Webhooks.
- [x] **Timing-Safe Digest Comparison**: `hmac.compare_digest` used for all signature checks.
- [x] **Idempotency**: Duplicate client callbacks and repeated webhooks cannot create multiple bookings or double-charges.
- [x] **Automatic Refund on Expired Holds**: If payment captures after a hold has reaped/expired, an immediate refund is dispatched.
- [x] **Durable Persistence**: `payments` and `webhook_events` tables persist all transactions with unique constraints.
- [x] **Authentication Limitation**: Currently, reservation ownership is validated against the unguessable `reservation_id` (UUID4 hex capability token) and `user_id`. In production, bind reservations to authenticated JWT session tokens.
