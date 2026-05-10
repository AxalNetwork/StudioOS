-- Task #14 — Notifications digest + quiet hours.
--
-- Adds the buffering store used by the digest cron + quiet-hours
-- suppression logic in services/notify.ts. The four user_settings
-- columns referenced by the spec (digest_frequency, quiet_hours_start
-- / _end / _tz) were already created by migration 002 — this file
-- only adds the outbox table.
--
-- Apply once per environment:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/013_notifications_digest.sql --remote --env=""
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  payload TEXT,
  category TEXT,
  -- 'digest'        — buffered because the user opted into a daily/weekly roll-up
  -- 'quiet_hours'   — buffered because the user is currently inside their quiet window
  reason TEXT NOT NULL DEFAULT 'digest',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flushed_at TIMESTAMP,
  flushed_digest_id TEXT
);

-- The cron flush walks pending rows per user — keep it cheap on D1.
CREATE INDEX IF NOT EXISTS idx_outbox_user_pending
  ON notification_outbox(user_id, flushed_at);
