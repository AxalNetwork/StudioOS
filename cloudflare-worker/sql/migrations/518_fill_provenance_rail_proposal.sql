-- 518 — D777 part 3 (#2102): an accepted placement names its rail proposal.
--
-- Part 2 (migration 503) gave an accepted fill its run (`ai_usage_log_id`) and
-- its row (`target_row_ref`). D720's third pointer, the proposal in
-- `ai_rail_proposals` (migration 506, D780), waited on that table. It is here:
-- a value a member kept from a rail option's placement names the proposal it
-- came from, so the field can say which run proposed it, what it cost, and
-- what the member changed.
--
-- Additive only: one nullable column and one index. Nothing is backfilled; a
-- row written before this file reads its proposal as "Not recorded".
-- `services/fills/provenance.ts` adds the same column to a database made
-- before this file (D235: the migration is the declaration).
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`).

ALTER TABLE fill_provenance ADD COLUMN ai_proposal_id INTEGER REFERENCES ai_rail_proposals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fill_provenance_rail_proposal ON fill_provenance (ai_proposal_id);
