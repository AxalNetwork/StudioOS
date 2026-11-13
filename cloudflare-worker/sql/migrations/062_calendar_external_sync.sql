-- Task #52 — scaffolding for external→Axal read-only event mirror.
--
-- This migration is strictly additive: it ONLY creates a new table and a
-- supporting index. Both statements use `IF NOT EXISTS` so re-runs are
-- safe (D1 rolls back the entire file on the first error, so we keep
-- the file to a single CREATE TABLE + one CREATE INDEX).
--
-- The `external_provider` / `external_event_id` columns on
-- `calendar_events` will be added by a separate migration in follow-up
-- Task #58, guarded by a lazy PRAGMA-table_info() helper in
-- `services/calendar.ts` (same pattern as `ensureAdvisorWeekColumn()`).
-- Doing the column add lazily avoids the D1 limitation that
-- `ALTER TABLE … ADD COLUMN` does NOT support `IF NOT EXISTS`.
--
-- Apply with:
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
  ON calendar_external_sync (watch_expires_at);
