-- 525 — an AI token hold can carry an idempotency key (D844, #2466).
--
-- Additive. A billable MCP tool call, connector call or workflow step reserves
-- through `reserveAiBudget` with the key `exec:<execution id>:<component>`
-- (`services/metering.ts`). A retry of the same execution finds the hold its
-- first attempt took and takes no second one, so a retry never holds or
-- charges twice. Every existing caller passes no key, and its rows stay NULL.
--
-- Grep first (D-t): `ai_budget_reservations` is migration 419's, with 430's
-- `recorded_cost_microusd`; it is not in schema_baseline.sql. No earlier
-- migration adds this column or index. No BEGIN/COMMIT.
--
--   ai_budget_reservations.idempotency_key
--     The caller's key for the hold, or NULL. Unique per member where present:
--     one member's key never collides with another's, and NULL rows never
--     collide at all.
ALTER TABLE ai_budget_reservations ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reservations_idempotency
  ON ai_budget_reservations(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
