-- 503 — D777 part 2 (#2102): an accepted fill names the run that produced it.
--
-- Additive only: three nullable columns and one index. No table is rebuilt,
-- there is no BEGIN or pragma, and nothing is backfilled. A row written before
-- this file has the new columns NULL, which the reads show as "Not recorded".
-- `services/fills/provenance.ts` adds the same columns to a database made
-- before this file (D235: the migration is the declaration, the runtime ADD
-- COLUMN only heals a dev or test database).
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`).

-- The ai_usage_logs row of the run that proposed this value: its model, its
-- cost and charge, and its rail page and option (D762). Written by the propose
-- route from the router's result; NULL for a proposal from a path that does not
-- pass it yet, and on every row from before this file.
ALTER TABLE validate_proposals ADD COLUMN ai_usage_log_id INTEGER;

-- The row a fill landed on, named as text where `target_row_id` cannot name it:
-- a competitor row (recorded with row id 0) or a proposal outside a project.
-- The accept path copies the proposal's `target_ref` here.
ALTER TABLE fill_provenance ADD COLUMN target_row_ref TEXT;

-- The run that produced the accepted value, copied from its proposal, so a
-- member can see which run filled a field and what it cost.
ALTER TABLE fill_provenance ADD COLUMN ai_usage_log_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_fill_provenance_usage ON fill_provenance (ai_usage_log_id);
