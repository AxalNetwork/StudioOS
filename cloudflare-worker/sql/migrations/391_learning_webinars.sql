-- 391 — Learning webinars (D560, #1161): a scheduled live session, members'
-- registrations, a join link served only inside its window, and a recording.
--
-- AUTHORED BY THE SUPER ADMIN ONLY (routes/admin_learning_webinars.ts, each
-- write recorded with `logAdminAction`). A member writes one thing: their own
-- registration.
--
-- THE JOIN LINK IS NEVER LISTED. `join_url` reaches a member only through
-- `GET /api/learning/webinars/:uid`, and only when they are registered and the
-- clock is between 15 minutes before `starts_at` and `ends_at`.
--
-- NULL IS NOT RECORDED. No capacity is "no limit set", not zero seats. No
-- recording reads "Recording not available". `attended` stays null until
-- someone records it; null is not "did not attend".

CREATE TABLE IF NOT EXISTS learning_webinars (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  abstract           TEXT,
  host_name          TEXT,
  -- ISO 8601 instants, UTC (`2026-11-03T16:00:00.000Z`).
  starts_at          TEXT,
  ends_at            TEXT,
  -- An IANA zone the page shows the time in (`Europe/Paris`); null shows UTC.
  timezone           TEXT,
  -- https only; checked by the route.
  join_url           TEXT,
  capacity           INTEGER CHECK (capacity IS NULL OR capacity > 0),
  -- A learning_items uid whose kind is 'video' (D557); checked by the route.
  recording_item_uid TEXT,
  visibility         TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'program')),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_by         INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  published_at       TEXT,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_learning_webinars_status ON learning_webinars(status, starts_at);

CREATE TABLE IF NOT EXISTS learning_webinar_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  webinar_id    INTEGER NOT NULL REFERENCES learning_webinars(id),
  user_id       INTEGER NOT NULL,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  attended      INTEGER CHECK (attended IS NULL OR attended IN (0, 1)),
  UNIQUE (webinar_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_webinar_registrations_user ON learning_webinar_registrations(user_id);
