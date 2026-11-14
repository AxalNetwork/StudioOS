-- D4568 (#4568, D1 scale S2) — two partial indexes on ai_usage_logs, for the
-- charge reads that scan the whole table today. Evidence (on the migrated
-- schema, EXPLAIN QUERY PLAN, and the #4567 benchmark):
-- documentation/audits/USAGE_TABLES_2026-11-07.md.
--
--   idx_ai_usage_logs_guard_for         a run's charge with its guard rows:
--     agentRun.chargedFor, skillEval.tagUsage, agents/sessions, agents/workRuns
--     and decks/usage, all `WHERE id = ? OR guard_for = ?` (or IN). Without it
--     each is a SCAN of every usage row on every agent run.
--   idx_ai_usage_logs_reservation_ref   a deck step's charge under its parent
--     hold: decks/stepExecutor, batchSweep, genRuntime, imageDraw, deck_images,
--     deck_script and admin_revenue, `WHERE reservation_uid = ? AND record_ref = ?`.
--
-- Partial (`… IS NOT NULL`), so a row without the column writes nothing to the
-- index: a model row has no guard_for, a call outside a parent hold has no
-- reservation_uid. An equality on the column implies the predicate, so every
-- read above can use them.
--
-- Additive only: no column, row or existing index changes, and no query is
-- rewritten for it. Rollback is `DROP INDEX` of either; nothing reads an index
-- by name. Building each reads ai_usage_logs once, at the deploy that applies
-- this migration: its size in production is the owner's to check first
-- (documentation/operations/D1_BENCHMARK.md §3).

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_guard_for ON ai_usage_logs (guard_for) WHERE guard_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_reservation_ref ON ai_usage_logs (reservation_uid, record_ref) WHERE reservation_uid IS NOT NULL;
