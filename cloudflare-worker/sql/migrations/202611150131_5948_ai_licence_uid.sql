-- 202611150131 — the licence an AI run is for, on its hold and its usage row (D5948, #5948).
--
-- Revenue ledger slice 4 of 6 (#5038). Neither `ai_budget_reservations`
-- (migration 419) nor `ai_usage_logs` (migration 040) named a licence, so AI
-- cost, billed amount and margin could not be read per licence
-- (`TOKEN_PL_PER_SUBSIDIARY_UNAVAILABLE`, `routes/licence.ts`).
--
-- NULLABLE, WRITTEN ONCE. A branch Worker writes its licence (`branch_licence`
-- row `id = 1`) on a new hold and its usage row, in the run's own execution
-- (`services/aiLicenceAttribution.ts`). Where no licence can be named (HQ, a
-- missing row, a failed lookup) the column stays NULL and reads as
-- unattributed. Nothing updates it afterwards.
--
-- NO BACKFILL. Rows from before this migration keep NULL. The one-row
-- `ai_licence_attribution_start` table records when attribution started, so a
-- NULL row created before it is reported as "Not recorded" (pre-migration),
-- never folded into a licence or into zero.
ALTER TABLE ai_budget_reservations ADD COLUMN licence_uid TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN licence_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_reservations_licence_updated ON ai_budget_reservations(licence_uid, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_licence_created ON ai_usage_logs(licence_uid, created_at);
CREATE TABLE IF NOT EXISTS ai_licence_attribution_start (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
INSERT OR IGNORE INTO ai_licence_attribution_start (id, started_at) VALUES (1, datetime('now'));
