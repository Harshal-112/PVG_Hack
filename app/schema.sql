CREATE TABLE IF NOT EXISTS bookings (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  seat_id         TEXT NOT NULL,
  reservation_id  TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  confirmed_at    TIMESTAMPTZ NOT NULL,
  persisted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, seat_id)          -- DB-level safety net: a double booking is physically impossible
);
CREATE TABLE IF NOT EXISTS booking_conflicts (
  id BIGSERIAL PRIMARY KEY, event_id TEXT, seat_id TEXT, reservation_id TEXT,
  user_id TEXT, seen_at TIMESTAMPTZ DEFAULT now(), note TEXT
);
CREATE TABLE IF NOT EXISTS baseline_seats (
  event_id TEXT NOT NULL, seat_id TEXT NOT NULL, booked_by TEXT,
  PRIMARY KEY (event_id, seat_id)
);
CREATE TABLE IF NOT EXISTS baseline_bookings (
  id BIGSERIAL PRIMARY KEY, event_id TEXT NOT NULL, seat_id TEXT NOT NULL,
  user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
  -- intentionally NO unique constraint, so the naive mode can show double bookings
);

CREATE TABLE IF NOT EXISTS payments (
  id                  BIGSERIAL PRIMARY KEY,
  payment_id_internal TEXT NOT NULL UNIQUE,
  reservation_id      TEXT NOT NULL UNIQUE,
  event_id            TEXT NOT NULL,
  seat_id             TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  razorpay_order_id   TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount              BIGINT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  payment_status      TEXT NOT NULL DEFAULT 'created', -- created, pending, authorized, paid, failed, refund_pending, refunded, manual_reconciliation
  booking_status      TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, failed, expired
  booking_reference   TEXT UNIQUE,
  error_code          TEXT,
  error_description   TEXT,
  refund_id           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_event_user ON payments(event_id, user_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id            TEXT PRIMARY KEY,
  event_type          TEXT NOT NULL,
  payload             TEXT,
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

