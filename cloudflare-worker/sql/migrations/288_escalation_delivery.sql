-- 288 — an escalation can be sent again, in both directions (D243).
--
-- BRANCH → HQ. A raise HQ did not answer is stored `undelivered` (migration
-- 261) and called retryable, and nothing retried it. `recordEscalation` also
-- had no idempotency key, so a retry after a lost response would insert a
-- second HQ row for the same act. `raise_key` is generated on the branch
-- before the call, stored on the branch row, sent to HQ, and stored on
-- `hq_escalations`. The partial unique index is what makes the second insert
-- a no-op: HQ returns the uid it already holds.
--
-- HQ → BRANCH. The answer push was reported on the response and not stored,
-- so HQ could not later tell whether it arrived or send that same decision
-- again. `push_ok`, `push_reason` and `push_at` are that outcome. A resend
-- reads the stored answer; it does not take a new one.
--
-- ONE FILE FOR BOTH TABLES. HQ and a branch run the same migration list, so
-- both tables already exist on both databases (259 and 261). A column that
-- belongs to only one tier would still have to live here.
--
-- Additive only. No BEGIN/COMMIT: D1 rejects transaction control in a
-- migration file. NULL with no default: a row from before this migration has
-- no key and no push outcome, and inventing either would claim a delivery
-- that did not happen.

-- The name that was pushed. HQ's row stored the user id, and a resend that
-- looked the name up again could send a different one than the decision did.
ALTER TABLE hq_escalations ADD COLUMN answered_by_name TEXT;
ALTER TABLE hq_escalations ADD COLUMN raise_key TEXT;
ALTER TABLE hq_escalations ADD COLUMN push_ok INTEGER;
ALTER TABLE hq_escalations ADD COLUMN push_reason TEXT;
ALTER TABLE hq_escalations ADD COLUMN push_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hq_escalations_raise_key
  ON hq_escalations(branch_code, raise_key) WHERE raise_key IS NOT NULL;

ALTER TABLE branch_escalations ADD COLUMN raise_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_escalations_raise_key
  ON branch_escalations(raise_key) WHERE raise_key IS NOT NULL;
