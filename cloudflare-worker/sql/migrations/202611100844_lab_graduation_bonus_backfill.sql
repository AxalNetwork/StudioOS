-- D5360 (#5360): the scheduled backfill also pays a graduation bonus that was lost.
--
-- If the final request (or a tick) issued the credential and then died before
-- `creditLabGraduation` ran, the graduate holds a certificate, so the
-- certificate backfill (D4663) never picks them, and only an admin's credit
-- backfill paid the bonus. The every-minute tick now also pays, three per
-- tick, graduates who hold an issued credential and have no ledger row with
-- source ref `lab:<user>:graduation`.
--
-- spinout_graduation_bonus_backfill_attempts. One row per graduate whose
-- bonus the scheduled backfill has tried. `last_outcome` is
-- creditLabGraduation's answer ('granted', 'skipped:not_accepted',
-- 'skipped:graduation_not_paid', ...). A graduate whose last try paid nothing
-- is tried again only after the retry interval, so one who cannot be paid
-- (not admitted, incorporation never paid) never holds the queue. A sibling of
-- spinout_certificate_backfill_attempts rather than new columns on it: that
-- table's row says "the certificate backfill tried this graduate", and its
-- NOT NULL certificate outcome has no honest value for a graduate whose
-- certificate another path issued.
--
-- spinout_certificate_backfill_tick gains the bonus step's counts. NULL on a
-- tick recorded before this migration: not recorded, never "0 paid".
--
-- Additive only: no column is dropped, no row deleted, nothing renamed.

CREATE TABLE IF NOT EXISTS spinout_graduation_bonus_backfill_attempts (
  user_id INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_outcome TEXT NOT NULL,
  first_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_spinout_graduation_bonus_backfill_attempts_last
  ON spinout_graduation_bonus_backfill_attempts (last_attempt_at);

ALTER TABLE spinout_certificate_backfill_tick ADD COLUMN bonus_scanned INTEGER;
ALTER TABLE spinout_certificate_backfill_tick ADD COLUMN bonus_paid INTEGER;
ALTER TABLE spinout_certificate_backfill_tick ADD COLUMN bonus_skipped INTEGER;
ALTER TABLE spinout_certificate_backfill_tick ADD COLUMN bonus_more_waiting INTEGER;
