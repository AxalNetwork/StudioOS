-- 493 — D762 (#2019): each AI run records what the member was charged beside
-- what it cost, and which hold paid for it.
--
-- Additive only: seven nullable columns on ai_usage_logs and one index. No
-- table is rebuilt, there is no BEGIN or pragma, and nothing is backfilled. A
-- row written before this file has every new column NULL, which the reads
-- show as "Not recorded", never as a zero charge. `ensureLogSchema` in
-- services/aiRouter.ts creates the same columns on a fresh database (D158).
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`).

-- What the member paid for the run, in micro-USD: the amount its hold settled
-- at. 0 for a refusal, a cached answer or a failed run (nothing was charged);
-- NULL while a run that cost more than its hold waits for a Super Admin's
-- decision, and on every row from before this file.
ALTER TABLE ai_usage_logs ADD COLUMN charged_microusd INTEGER
  CHECK (charged_microusd IS NULL OR charged_microusd >= 0);
-- The ai_budget_reservations hold that paid for the run. NULL when no hold
-- was taken (a system run, a refusal before the hold, a cached answer).
ALTER TABLE ai_usage_logs ADD COLUMN reservation_uid TEXT;
-- The AI rail's page, option and record the run was asked from. Written when
-- the caller passes them (D765); NULL otherwise.
ALTER TABLE ai_usage_logs ADD COLUMN rail_page TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN rail_option TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN record_ref TEXT;
-- The ai_usage_logs row a guard run checked (D763 writes it).
ALTER TABLE ai_usage_logs ADD COLUMN guard_for INTEGER;
-- The units the run was settled on, as JSON, measured by the Worker.
ALTER TABLE ai_usage_logs ADD COLUMN units_json TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_page_created ON ai_usage_logs(user_id, rail_page, created_at);
