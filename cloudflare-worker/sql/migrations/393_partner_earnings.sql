-- 393 — D572 (#1183): a failed payout reopens its commissions, and the fields
-- the partner earnings screens (D569) show as "Not recorded".
--
-- WHICH PAYOUT CLAIMED WHICH COMMISSION. A payout request marks whole accrued
-- commissions `paid` and stored nothing that said which ones. So a failed
-- payout could not give them back: `PATCH /admin/payouts/:id/process` with
-- `fail` set the payout to failed and left its commissions paid, with no
-- retry. `payout_commissions` is one row per commission a payout claimed,
-- written in the same batch as the payout. It is a history, not a pointer:
-- a commission reopened by a failed payout and claimed again by a later one
-- has a row for each, so both payouts keep listing what they claimed.
--
-- `payouts.uid` is how that batch names the payout it just inserted without
-- trusting last_insert_rowid() across statements: the claim and the link
-- rows are conditioned on the payout row with that uid existing, so a
-- request whose guard refused writes nothing at all. Older payouts have no
-- uid and no link rows, and a failure on one of them says so instead of
-- guessing which commissions to reopen.
--
-- DATES. `processed_at` is when an admin last moved the payout (process,
-- complete or fail); `failed_at` is when it failed. Older rows have neither,
-- which reads "Not recorded", never a guessed date.
--
-- RULE EDITS. `commission_rules` gains who last changed a rule and when. The
-- edit itself is also logged through `logAdminAction` with the before and
-- after values.
--
-- AN INTERACTION'S OUTCOME. Free text, at most 200 characters, optional. An
-- interaction logged before this has no outcome, which reads as none recorded.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).
-- The ALTERs are not re-runnable; the ledger stops the replay.

CREATE TABLE IF NOT EXISTS payout_commissions (
    payout_id      INTEGER NOT NULL REFERENCES payouts(id),
    commission_id  INTEGER NOT NULL REFERENCES commissions(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (payout_id, commission_id)
);
CREATE INDEX IF NOT EXISTS idx_payout_commissions_commission ON payout_commissions(commission_id);

ALTER TABLE payouts ADD COLUMN uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_uid ON payouts(uid);
ALTER TABLE payouts ADD COLUMN processed_at TEXT;
ALTER TABLE payouts ADD COLUMN failed_at TEXT;

ALTER TABLE commission_rules ADD COLUMN updated_at TEXT;
ALTER TABLE commission_rules ADD COLUMN updated_by INTEGER REFERENCES users(id);

ALTER TABLE partner_interactions ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR length(outcome) <= 200);
