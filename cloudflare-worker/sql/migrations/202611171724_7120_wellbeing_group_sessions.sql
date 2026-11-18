-- D7120 (#7120): Wellness group sessions. An occurrence a facilitator (an
-- approved expert) schedules, with a fixed number of seats, and each member's
-- own reservation of one seat.
--
-- A seat is taken by one INSERT ... SELECT whose WHERE counts the reserved
-- seats in the same statement, so two members can never both take the last
-- one. A member holds at most one reservation per session (UNIQUE); a
-- cancelled reservation releases its seat and may be taken up again.
--
-- Free sessions only for now (price_cents is 0, CHECKed): paid groups and
-- refunds, and a wait-list, are the owner's call (Q4 on #7117).
-- Attendees are never shown to one another; only the facilitator sees who
-- reserved.

CREATE TABLE IF NOT EXISTS wellbeing_group_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  expert_id INTEGER NOT NULL,
  support_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL,
  timezone TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 2 AND capacity <= 50),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents = 0),
  cancellation_hours INTEGER NOT NULL DEFAULT 24,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_group_sessions_upcoming
  ON wellbeing_group_sessions (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_wellbeing_group_sessions_expert
  ON wellbeing_group_sessions (expert_id, starts_at);

CREATE TABLE IF NOT EXISTS wellbeing_group_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'cancelled')),
  calendar TEXT NOT NULL DEFAULT 'discreet' CHECK (calendar IN ('discreet', 'named', 'none')),
  reserved_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT,
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_group_reservations_user
  ON wellbeing_group_reservations (user_id, status);
CREATE INDEX IF NOT EXISTS idx_wellbeing_group_reservations_session
  ON wellbeing_group_reservations (session_id, status);
