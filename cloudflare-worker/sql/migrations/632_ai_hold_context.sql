-- 632 — what an AI token hold is for (D1278, #3304; #2482's contract gap 2).
--
-- Additive. `GET /api/ai-budget/holds` lists a member's holds in progress, and
-- each says what took it, never what it read or wrote: no prompt, no answer.
-- `reserveAiBudget` writes these four in the same batch as the hold, when its
-- caller names them (`services/metering.ts` for MCP tools and flow steps,
-- `services/aiRouter.ts` for an AI run). A caller that names none, and every
-- hold taken before this migration, keeps them NULL, which the read says as
-- "Not recorded".
--
-- Grep first (D-t): `ai_budget_reservations` is migration 419's, with 430's
-- `recorded_cost_microusd` and 525's `idempotency_key`; it is not in
-- schema_baseline.sql. No earlier migration adds these columns. No BEGIN/COMMIT.
--
--   operation      the metering operation (`mcp.tool.<name>`, a flow step's
--                  operation) or `ai.<task>` for an AI run
--   surface        where the hold was taken: 'mcp', 'flow' or 'ai'
--   api_key_uid    the member API key the call came through, or NULL
--   execution_id   the execution the hold belongs to, or NULL
ALTER TABLE ai_budget_reservations ADD COLUMN operation TEXT;
ALTER TABLE ai_budget_reservations ADD COLUMN surface TEXT CHECK (surface IS NULL OR surface IN ('mcp', 'flow', 'ai'));
ALTER TABLE ai_budget_reservations ADD COLUMN api_key_uid TEXT;
ALTER TABLE ai_budget_reservations ADD COLUMN execution_id TEXT;
