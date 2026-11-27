-- D4627 (#4627) — proposal identity as the stable idempotency key for the
-- ordinary Validate accept route's `hypothesis` fill: `hypotheses` gains a
-- nullable `source_proposal_id`, unique only where it is set (a partial
-- index), so every row created outside an accept (NULL) is untouched and a
-- RETRY of a failed accept for the SAME proposal can be found and reused —
-- same id, same `code` — instead of allocating a second `Hn` while the
-- first sits with no provenance behind it. `_founder_validate_writes.ts`'s
-- `insertHypothesis` checks this column before inserting; the index itself
-- is the defensive invariant (a genuine duplicate would be a unique
-- violation, not a silently wrong row), not the primary mechanism — the
-- proposal's own atomic claim already serializes every caller that could
-- race the check.
--
-- The PostHog `experiment_evidence` acceptor's equivalent idempotency key
-- (`services/validateWriters.ts`'s `addExperiment`) needs no schema change:
-- `hypothesis_experiments.uid` is already `NOT NULL UNIQUE` (migration 460),
-- and `hypothesis_experiments` is that one migration's alone to touch
-- (`validate_writes_d690.test.ts`'s "17: 460 adds no column that any other
-- migration or the baseline already has" fails on another migration naming
-- the table at all, ADD COLUMN or not). A deterministic uid derived from the
-- PostHog proposal id reuses that existing constraint instead.

ALTER TABLE hypotheses ADD COLUMN source_proposal_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hypotheses_source_proposal
  ON hypotheses (source_proposal_id) WHERE source_proposal_id IS NOT NULL;
