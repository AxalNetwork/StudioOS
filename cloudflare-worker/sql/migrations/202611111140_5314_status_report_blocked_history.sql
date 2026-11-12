-- #5314 part 2 (D4822): a stored Blocked section on status reports, and an
-- append-only history of the client's reviews.
--
-- BLOCKED. A report's Blocked section is now words the firm writes, like
-- Shipped and Next. The engagement's open blockers stay live evidence shown
-- beneath it and are never copied in. `blocked_recorded_at` says when the
-- section was last written: NULL on every report saved before this migration
-- (and on any saved without stating it), which the read returns as
-- "Not recorded", never as "nothing blocked". A recorded section with a NULL
-- `blocked` is the firm stating that nothing is blocked.
--
-- REVIEW HISTORY. `partner_engagement_health` keeps only the latest client
-- satisfaction and its source. Each change to them now appends one row here.
-- A row is never edited or deleted (the two triggers), so the history is what
-- was recorded, in the order it was recorded. Reviews recorded before this
-- migration were not kept and cannot be recovered; the read says so.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE engagement_status_reports ADD COLUMN blocked TEXT;
ALTER TABLE engagement_status_reports ADD COLUMN blocked_recorded_at TEXT;

-- A sent report is frozen (D4682); its Blocked section is part of what the
-- client received.
CREATE TRIGGER IF NOT EXISTS trg_status_report_sent_blocked_frozen
BEFORE UPDATE OF blocked, blocked_recorded_at
ON engagement_status_reports
WHEN OLD.state = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'status_report_sent');
END;

CREATE TABLE IF NOT EXISTS engagement_client_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL REFERENCES engagements(id),
  -- NULL records that the score was cleared.
  satisfaction REAL CHECK (satisfaction IS NULL OR (satisfaction >= 1 AND satisfaction <= 5)),
  source TEXT,
  -- When the client said it, as the firm recorded it.
  said_at TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by INTEGER,
  CHECK (satisfaction IS NULL OR source IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_engagement_client_reviews_engagement
  ON engagement_client_reviews(engagement_id, id);

CREATE TRIGGER IF NOT EXISTS trg_engagement_client_reviews_append_only
BEFORE UPDATE ON engagement_client_reviews
BEGIN
  SELECT RAISE(ABORT, 'client_review_history_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_engagement_client_reviews_kept
BEFORE DELETE ON engagement_client_reviews
BEGIN
  SELECT RAISE(ABORT, 'client_review_history_append_only');
END;
