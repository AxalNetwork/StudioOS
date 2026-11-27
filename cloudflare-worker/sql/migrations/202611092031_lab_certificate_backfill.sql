-- D4663 (#4663): the scheduled certificate backfill records what it did.
--
-- Graduation closes the Lab, and the progress reconciler walks only founders
-- whose Lab is on. So a graduate whose final request died after the milestone
-- insert and before the credential was issued held no credential until an
-- admin ran "Issue all eligible". The owner chose (2026-11-09, option A) that
-- the every-minute cron also runs a small backfill, three graduates per tick.
--
-- spinout_certificate_backfill_attempts. One row per graduate the scheduled
-- backfill has tried. `last_outcome` is issueOnGraduation's answer
-- ('issued', 'already_issued', 'not_graduated', 'insufficient_data',
-- 'reissue_blocked', 'error'); `bonus_outcome` is the graduation bonus's
-- answer when the credential was issued. A graduate whose last try did not
-- issue is tried again only after the retry interval, so a graduate who cannot
-- be issued (no name on record, no venture chosen) never holds the queue.
--
-- spinout_certificate_backfill_tick. One row: the last tick that ran, what it
-- found and what it did, so the admin Graduation desk can say when the
-- backfill last ran and never shows "0 issued" for a tick that never happened.
--
-- Additive only: no column is dropped, no row deleted, nothing renamed.

CREATE TABLE IF NOT EXISTS spinout_certificate_backfill_attempts (
  user_id INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_outcome TEXT NOT NULL,
  bonus_outcome TEXT,
  first_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  issued_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_spinout_certificate_backfill_attempts_last
  ON spinout_certificate_backfill_attempts (last_attempt_at);

CREATE TABLE IF NOT EXISTS spinout_certificate_backfill_tick (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'frozen', 'not_granted', 'grants_unreadable')),
  scanned INTEGER NOT NULL DEFAULT 0,
  issued INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  more_waiting INTEGER NOT NULL DEFAULT 0
);
