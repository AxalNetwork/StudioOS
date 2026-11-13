-- 111_event_notifications.sql — Task #6
--
-- Event reminder/notification ledger (design §6). One row per
-- (event_id, principal_key, kind) records that a given notification was
-- delivered, so the cron sweep (services/eventReminders.ts) is idempotent and
-- never double-sends the same reminder.
--   principal_key = 'user:<id>'        for account holders
--                 = 'email:<lower>'    for email-only registrants
--   kind          = 'reminder_24h' | 'reminder_1h'  (extensible)
--
-- Additive + idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Mirrored shape-only
-- in services/eventsSchema.ts so dev/preview D1 serves it without wrangler.
--
-- Apply (wrangler needs Node 22+ — see GOTCHAS "Migrations & schema"):
--   npx wrangler d1 execute studioos-db --config wrangler.toml --remote \
--     --file=cloudflare-worker/sql/migrations/111_event_notifications.sql

CREATE TABLE IF NOT EXISTS event_notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  principal_key TEXT NOT NULL,
  kind          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, principal_key, kind)
);

CREATE INDEX IF NOT EXISTS idx_event_notifications_event
  ON event_notifications (event_id, kind);
