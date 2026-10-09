-- PostgreSQL Schema. Owned by [P3].

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
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT,
  seat_id         TEXT,
  reservation_id  TEXT,
  user_id         TEXT,
  seen_at         TIMESTAMPTZ DEFAULT now(),
  note            TEXT
);

CREATE TABLE IF NOT EXISTS baseline_seats (
  event_id        TEXT NOT NULL,
  seat_id         TEXT NOT NULL,
  booked_by       TEXT,
  PRIMARY KEY (event_id, seat_id)
);

CREATE TABLE IF NOT EXISTS baseline_bookings (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  seat_id         TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
  -- intentionally NO unique constraint, so the naive mode can show double bookings
);
