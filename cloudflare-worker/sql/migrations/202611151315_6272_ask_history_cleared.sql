-- D6272 (#6272): Ask's "Clear history" hides, it does not delete.
--
-- The owner's answer on #6274 (question 4, option B): clearing stamps the
-- caller's sessions with `cleared_at`; "Show cleared" reads them back and
-- Restore sets it to NULL again. No answer row is removed or rewritten, so an
-- answer a memo cites stays traceable. NULL means "not cleared", which every
-- existing session is, so there is no backfill.
--
-- Additive; the ledger applies the ALTER once. No transaction statements: D1
-- rejects `BEGIN;`/`COMMIT;` (see 200's header).
ALTER TABLE research_ask_sessions ADD COLUMN cleared_at TEXT;

-- The two reads that use it are "my cleared sessions" and "my sessions that
-- are not cleared", both per owner.
CREATE INDEX IF NOT EXISTS idx_research_ask_sessions_owner_cleared
  ON research_ask_sessions(owner_user_id, cleared_at);
