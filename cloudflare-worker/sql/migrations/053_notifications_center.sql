-- Task #2 (IB) — Email Pipeline + Notification Center.
--
-- Spec asks for a fresh `notifications` table with the columns
--   (category, severity, title, body, cta_url, template_key, read_at).
-- We already have `notifications_inbox` (created in 013_notifications_digest.sql)
-- populated by services/notify.ts. Forking the data into a second table
-- would double-write every notify() call and break the existing bell. So:
--
--  1. Extend `notifications_inbox` with the spec columns (category /
--     severity / cta_url / template_key) so the new send() pipeline can
--     mirror its emails into the same inbox the bell already reads.
--  2. Create a back-compat VIEW `notifications` that exposes the spec
--     column names to anything reading by that name.
--  3. Add `email_send_log` to surface JOB_QUEUE outcomes (queued / sent /
--     failed / dlq) in the admin UX. Mirrors the queue's retry/DLQ flow.
--  4. Add `users.marketing_unsubscribed_at` so the one-click List-
--     Unsubscribe endpoint can opt the user out of every marketing class
--     email in a single write. Transactional categories ignore this flag.
--
-- All ALTERs are NOT idempotent under D1 raw SQL — if any column already
-- exists this file will fail on first ALTER and roll back. The lazy
-- schema bootstrap in services/notify.ts::ensureInbox() runs the same
-- ADD COLUMN at boot inside a try/catch so dev/preview self-heals.

ALTER TABLE notifications_inbox ADD COLUMN category TEXT;
ALTER TABLE notifications_inbox ADD COLUMN severity TEXT DEFAULT 'info';
ALTER TABLE notifications_inbox ADD COLUMN cta_url TEXT;
ALTER TABLE notifications_inbox ADD COLUMN template_key TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_user_category
  ON notifications_inbox(user_id, category, read_at, created_at);

DROP VIEW IF EXISTS notifications;
CREATE VIEW notifications AS
  SELECT
    id,
    user_id,
    COALESCE(category, 'system') AS category,
    COALESCE(severity, 'info')   AS severity,
    title,
    body,
    COALESCE(cta_url, link)      AS cta_url,
    template_key,
    read_at,
    created_at
  FROM notifications_inbox;

CREATE TABLE IF NOT EXISTS email_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  to_addr TEXT NOT NULL,
  template_key TEXT NOT NULL,
  category TEXT,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | failed | dlq
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_send_log_status   ON email_send_log(status, enqueued_at);
CREATE INDEX IF NOT EXISTS idx_email_send_log_user     ON email_send_log(user_id, enqueued_at);
CREATE INDEX IF NOT EXISTS idx_email_send_log_template ON email_send_log(template_key, enqueued_at);

ALTER TABLE users ADD COLUMN marketing_unsubscribed_at TIMESTAMP;
