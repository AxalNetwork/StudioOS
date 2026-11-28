-- D9203 (#9203) — two partial indexes for reads that scan a whole table today
-- (EXPLAIN QUERY PLAN on the migrated schema showed SCAN for each):
--
--   idx_ai_usage_logs_surface_created   the monthly rubric spend cap,
--     agents/skillRubric.monthSpend:
--     `WHERE surface = ? AND created_at >= ?`. ai_usage_logs gets a row for
--     every AI call, so without it the check grows slower every month.
--   idx_ai_reservations_execution       a run's held cost,
--     agents/runActivity.heldFor: `WHERE execution_id = ?`.
--
-- Partial (`… IS NOT NULL`), so a row without the column writes nothing to the
-- index; an equality on the column implies the predicate, so both reads use
-- them. The third scan in #9203 (the fund ledger totals) needs no index: the
-- query now names fund_id, so idx_fund_ledger_lines_entry serves it.
--
-- Additive only: no column, row or existing index changes. Rollback is
-- `DROP INDEX` of either; nothing reads an index by name.

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_surface_created
  ON ai_usage_logs (surface, created_at) WHERE surface IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_reservations_execution
  ON ai_budget_reservations (execution_id) WHERE execution_id IS NOT NULL;
