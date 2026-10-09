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

-- ============================================================================
-- Authentication & Identity Tables (Section 7)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY, -- usr_<uuid>
  email               TEXT UNIQUE NOT NULL,
  display_name        TEXT,
  avatar_url          TEXT,
  is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_identities (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL, -- 'google' | 'email_otp'
  provider_user_id    TEXT NOT NULL, -- Google sub id or verified email
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id                  TEXT PRIMARY KEY, -- challenge_id (uuid)
  email               TEXT NOT NULL,
  otp_hash            TEXT NOT NULL,
  salt                TEXT NOT NULL,
  attempts            INT NOT NULL DEFAULT 0,
  max_attempts        INT NOT NULL DEFAULT 5,
  expires_at          TIMESTAMPTZ NOT NULL,
  consumed            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id                  TEXT PRIMARY KEY, -- session_token (crypto token)
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON email_otp_challenges(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

