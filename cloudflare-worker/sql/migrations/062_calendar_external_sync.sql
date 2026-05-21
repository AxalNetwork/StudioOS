-- Task #52 — scaffolding for external→Axal read-only event mirror.
--
-- This migration is intentionally additive-only. Follow-up Task #58 will
-- populate `calendar_events` rows with `source IN ('google_external',
-- 'microsoft_external')` via Google sync_token + watch channels and
-- Microsoft Graph delta queries. Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/062_calendar_external_sync.sql

CREATE TABLE IF NOT EXISTS calendar_external_sync (
  user_id         INTEGER NOT NULL,
  provider        TEXT    NOT NULL CHECK (provider IN ('google', 'microsoft')),
  sync_token      TEXT,
  delta_link      TEXT,
  watch_channel_id   TEXT,
  watch_resource_id  TEXT,
  watch_expires_at   TEXT,
  last_pulled_at  TEXT,
  last_error      TEXT,
  PRIMARY KEY (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cal_ext_sync_expires
  ON calendar_external_sync (watch_expires_at)
  WHERE watch_expires_at IS NOT NULL;

-- Stamp external-source events on `calendar_events` so the unified feed
-- can render them dimmed/read-only. Idempotent via IF NOT EXISTS on the
-- column add (D1 supports ADD COLUMN IF NOT EXISTS).
ALTER TABLE calendar_events ADD COLUMN external_provider TEXT;
ALTER TABLE calendar_events ADD COLUMN external_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cal_events_external
  ON calendar_events (external_provider, external_event_id)
  WHERE external_provider IS NOT NULL;
