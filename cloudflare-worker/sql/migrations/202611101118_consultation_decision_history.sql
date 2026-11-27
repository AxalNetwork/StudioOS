-- #5301: compare-and-swap Best-Fit consultation transitions and keep their
-- append-only decision history for Admin › Approvals.
ALTER TABLE admin_consultation_bookings ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version >= 1);

CREATE TABLE admin_consultation_booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES admin_consultation_bookings(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL CHECK (from_status IN ('requested', 'confirmed', 'completed', 'cancelled')),
  to_status TEXT NOT NULL CHECK (to_status IN ('requested', 'confirmed', 'completed', 'cancelled')),
  version INTEGER NOT NULL CHECK (version >= 2),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id, version)
);

CREATE INDEX idx_consultation_booking_events_booking
  ON admin_consultation_booking_events(booking_id, created_at DESC);

CREATE INDEX idx_consultation_booking_events_decided
  ON admin_consultation_booking_events(to_status, created_at DESC);
