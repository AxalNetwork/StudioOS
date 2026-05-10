-- Task #3 — Calendly integration (Live, Free tier).
--
-- Adds a unified calendar_events table the worker uses to project events
-- from external scheduling providers (Calendly first; future Cal.com /
-- SavvyCal fit the same shape) into the /api/calendar aggregator.
--
-- Calendly events are keyed by their canonical URI (e.g.
-- https://api.calendly.com/scheduled_events/<uuid>) so that webhook
-- replays + the 15-minute reconcile are both idempotent.

CREATE TABLE IF NOT EXISTS calendar_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL,
  source        TEXT    NOT NULL,            -- 'calendly' | future providers
  external_uri  TEXT    NOT NULL,            -- provider canonical URI (UNIQUE w/ source)
  external_id   TEXT,                        -- short id, when distinct from URI
  title         TEXT,
  start_at      TEXT    NOT NULL,            -- ISO8601 UTC
  end_at        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'scheduled',  -- scheduled|cancelled|completed
  location_kind TEXT,                        -- 'video' | 'phone' | 'in_person' | 'custom'
  location_uri  TEXT,
  organizer_email TEXT,
  invitee_email   TEXT,
  invitee_name    TEXT,
  notes         TEXT,
  raw_json      TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_uri)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_time
  ON calendar_events(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source_status
  ON calendar_events(source, status);
