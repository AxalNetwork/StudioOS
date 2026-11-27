-- Task #83 — Wire Diligence → Commit → Ledger.
-- Links the Source→Exit funnel stages that previously didn't hand off:
--   1. ic_decisions.dd_case_id  — attach a Due-Diligence case to an IC decision.
--   2. decision_journal_entries.ic_decision_id — the per-vote auto-drafted
--      private journal entry points back at the IC decision it was cast on.
--      A PARTIAL UNIQUE index makes the auto-draft idempotent per (voter, IC
--      decision) so re-voting UPDATES the draft instead of creating duplicates,
--      while leaving all hand-authored entries (ic_decision_id IS NULL) unique-free.
--
-- NOTE: ALTER TABLE ADD COLUMN is not idempotent; this is a forward-only
-- migration applied once via the schema_migrations ledger (see replit.md).

ALTER TABLE ic_decisions ADD COLUMN dd_case_id INTEGER REFERENCES dd_cases(id);
CREATE INDEX IF NOT EXISTS idx_ic_dd_case ON ic_decisions(dd_case_id);

ALTER TABLE decision_journal_entries ADD COLUMN ic_decision_id INTEGER REFERENCES ic_decisions(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_ic_decision_owner
  ON decision_journal_entries(owner_user_id, ic_decision_id)
  WHERE ic_decision_id IS NOT NULL;
