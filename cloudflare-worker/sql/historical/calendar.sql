-- Calendar Phase 1 — D1 schema for unified calendar + Google/Microsoft OAuth.
--
-- Apply against remote D1 with:
--   npx wrangler d1 execute studioos-db --file=cloudflare-worker/sql/calendar.sql --remote
--
-- For local dev (in-memory D1) drop --remote.
--
-- All seven tables use CREATE TABLE IF NOT EXISTS so this file is safe to re-run.
-- Datetimes are stored as ISO-8601 TEXT, matching every other Worker schema.
-- `calendar_sync_records.external_event_id` and `provider` columns are per the
-- original task spec (multi-provider). Mirrors the FastAPI SQLModel shapes in
-- backend/app/models/entities.py:1362-1455.

PRAGMA foreign_keys = ON;

-- ===========================================================================
-- IC meetings — Investment Committee sessions scheduled by admin/investor.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ic_meetings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT    NOT NULL UNIQUE,
  title              TEXT    NOT NULL,
  agenda             TEXT,
  start_at           TEXT    NOT NULL,
  duration_min       INTEGER NOT NULL DEFAULT 60,
  deal_id            INTEGER REFERENCES deals(id),
  organizer_user_id  INTEGER NOT NULL REFERENCES users(id),
  location_kind      TEXT    NOT NULL DEFAULT 'video',
  location_uri       TEXT,
  status             TEXT    NOT NULL DEFAULT 'scheduled',
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_ic_meetings_start         ON ic_meetings(start_at);
CREATE INDEX IF NOT EXISTS idx_ic_meetings_organizer     ON ic_meetings(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_ic_meetings_status        ON ic_meetings(status);
CREATE INDEX IF NOT EXISTS idx_ic_meetings_deal          ON ic_meetings(deal_id);

-- ===========================================================================
-- IC meeting attendees — many-to-many between ic_meetings and users.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ic_meeting_attendees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL REFERENCES ic_meetings(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  rsvp         TEXT    NOT NULL DEFAULT 'invited',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ic_attendees_meeting ON ic_meeting_attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_ic_attendees_user    ON ic_meeting_attendees(user_id);

-- ===========================================================================
-- Founder check-ins — recurring/one-off founder ↔ advisor/partner sessions.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS founder_checkins (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT    NOT NULL UNIQUE,
  founder_user_id       INTEGER NOT NULL REFERENCES users(id),
  counterpart_user_id   INTEGER REFERENCES users(id),
  project_id            INTEGER REFERENCES projects(id),
  title                 TEXT    NOT NULL,
  notes                 TEXT,
  start_at              TEXT    NOT NULL,
  duration_min          INTEGER NOT NULL DEFAULT 30,
  location_kind         TEXT    NOT NULL DEFAULT 'video',
  location_uri          TEXT,
  status                TEXT    NOT NULL DEFAULT 'scheduled',
  cancelled_at          TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_founder_checkins_founder    ON founder_checkins(founder_user_id);
CREATE INDEX IF NOT EXISTS idx_founder_checkins_counterpart ON founder_checkins(counterpart_user_id);
CREATE INDEX IF NOT EXISTS idx_founder_checkins_project    ON founder_checkins(project_id);
CREATE INDEX IF NOT EXISTS idx_founder_checkins_start      ON founder_checkins(start_at);
CREATE INDEX IF NOT EXISTS idx_founder_checkins_status     ON founder_checkins(status);

-- ===========================================================================
-- Google OAuth tokens — per-user refresh token for Calendar push-sync.
-- One row per user; upsert replaces the prior token.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  refresh_token   TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT '',
  google_email    TEXT,
  google_sub      TEXT,
  last_synced_at  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ===========================================================================
-- Microsoft OAuth tokens — same shape as google_oauth_tokens.
-- New table; no FastAPI equivalent.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS microsoft_oauth_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
  refresh_token   TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT '',
  microsoft_email TEXT,
  microsoft_sub   TEXT,
  last_synced_at  TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ===========================================================================
-- Calendar sync records — idempotency for outbound calendar mirror.
-- Maps (user_id, provider, source_kind, source_id) → external_event_id so
-- re-syncs PATCH instead of INSERT. Cleared on disconnect (DELETE WHERE
-- user_id=? AND provider=?).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS calendar_sync_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  provider           TEXT    NOT NULL CHECK (provider IN ('google','microsoft')),
  source_kind        TEXT    NOT NULL,
  source_id          INTEGER NOT NULL,
  external_event_id  TEXT    NOT NULL,
  last_synced_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, provider, source_kind, source_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_user_provider
  ON calendar_sync_records(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_source
  ON calendar_sync_records(source_kind, source_id);

-- ===========================================================================
-- OAuth state tokens — single-use CSRF guard for the OAuth round-trip.
-- Phase 2 will HMAC-sign `state` with JWT_SECRET, write a row here on
-- /connect, validate + delete on /callback. 10-minute TTL. Sweep expired
-- rows opportunistically on every callback.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS oauth_state_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  state       TEXT    NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  provider    TEXT    NOT NULL CHECK (provider IN ('google','microsoft')),
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires ON oauth_state_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_state_user    ON oauth_state_tokens(user_id);
