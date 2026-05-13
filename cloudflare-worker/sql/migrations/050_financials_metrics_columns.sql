-- Task #3 (DF) — Fix Financial Model + Metrics 500s
--
-- The original schema.sql shape for `financial_models` (uid/name/inputs_json)
-- doesn't match what `routes/financials.ts` reads/writes
-- (assumptions_json/computed_json/sensitivity_json/capital_recompute_json/
-- updated_by/updated_at). Migration 034 was supposed to rebuild this but
-- failed remotely (per replit.md). To unblock prod safely without a
-- destructive table rewrite, we additively ALTER the existing table to
-- add the columns the worker needs. Each ALTER is wrapped in IF NOT EXISTS
-- semantics by D1's behaviour: applied via `--command` so each statement is
-- its own implicit transaction. Re-running this file may report
-- "duplicate column" — that's expected and safe.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --command="ALTER TABLE …"
-- (one statement at a time) — see replit.md for D1 transaction caveats.

-- financial_models additive columns ----------------------------------------
ALTER TABLE financial_models ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE financial_models ADD COLUMN computed_json TEXT;
ALTER TABLE financial_models ADD COLUMN sensitivity_json TEXT;
ALTER TABLE financial_models ADD COLUMN capital_recompute_json TEXT;
ALTER TABLE financial_models ADD COLUMN updated_by INTEGER;
ALTER TABLE financial_models ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_models_project_unique
    ON financial_models(project_id);

-- metrics_snapshots additive columns ---------------------------------------
ALTER TABLE metrics_snapshots ADD COLUMN arr REAL;
ALTER TABLE metrics_snapshots ADD COLUMN cac REAL;
ALTER TABLE metrics_snapshots ADD COLUMN ltv REAL;
ALTER TABLE metrics_snapshots ADD COLUMN monthly_churn_pct REAL;
ALTER TABLE metrics_snapshots ADD COLUMN new_users INTEGER;
