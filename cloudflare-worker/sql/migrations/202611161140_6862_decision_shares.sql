-- 202611161140 — D6862 (#6862, from D6021's option B): a founder shares ONE given Validate decision with
-- a named Operating Partner or investor, who reads it on a read-only page. Named by its UTC minute and its
-- issue (D4106, D5398); D6021 named it `_6021_`, but the issue doing the build is #6862.
--
-- ONE ROW PER GRANT. A share names one decision and one recipient. It is never edited: a revoke stamps
-- `revoked_at` and `revoked_by`, and sharing again after a revoke writes a new row, so the history of who
-- could read what, and when, is kept. At most one live (unrevoked) share per decision and recipient.
--
-- THE READ RULE lives in `services/verdict.ts`, the only file that reads or writes this table: the
-- venture's own read the decision (`canReadDecision`); anyone else only through an unrevoked row here for
-- that one decision, and never a Withheld decision (refused at the grant and again at the read).
--
-- `include_reasoning` is the founder's tick for this share (owner answer Q3 A): 0 unless ticked.
CREATE TABLE IF NOT EXISTS validation_decision_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id INTEGER NOT NULL REFERENCES validation_decisions(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('partner', 'investor')),
  include_reasoning INTEGER NOT NULL DEFAULT 0 CHECK (include_reasoning IN (0, 1)),
  shared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shared_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_decision_shares_live
  ON validation_decision_shares(decision_id, recipient_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_validation_decision_shares_recipient
  ON validation_decision_shares(recipient_user_id, decision_id);
CREATE INDEX IF NOT EXISTS idx_validation_decision_shares_project
  ON validation_decision_shares(project_id, decision_id);
