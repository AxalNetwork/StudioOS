-- D4658 (#4658): a cohort notification is durable delivery work.
--
-- cohort_app_notification_ledger used to be claimed and sent in one step: the
-- row was inserted 'sent', a failed send flipped it to 'failed', and nothing
-- ever retried it. An isolate that died between the claim and the send left a
-- 'sent' row for a message nobody received. The row now carries what it
-- delivers and how often it was tried:
--   status       'pending' (claimed, not yet delivered) | 'sent' | 'failed'
--                (a retry is due) | 'abandoned' (MAX attempts reached).
--   title, body, link, email   the message, so a retry needs no caller.
--   attempts     delivery attempts so far.
--   delivered_at when the send succeeded.
-- Existing rows keep their status. Additive only.

ALTER TABLE cohort_app_notification_ledger ADD COLUMN title TEXT;
ALTER TABLE cohort_app_notification_ledger ADD COLUMN body TEXT;
ALTER TABLE cohort_app_notification_ledger ADD COLUMN link TEXT;
ALTER TABLE cohort_app_notification_ledger ADD COLUMN email INTEGER;
ALTER TABLE cohort_app_notification_ledger ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_app_notification_ledger ADD COLUMN delivered_at TEXT;
CREATE INDEX IF NOT EXISTS idx_cohort_notification_ledger_retry
  ON cohort_app_notification_ledger (status, sent_at) WHERE status IN ('pending', 'failed');
