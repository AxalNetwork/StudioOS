-- 510 — HQ › AI usage: Pause AI for one member, and one member's lower monthly
-- cap (D791, #2216; part of D785, #2210).
--
-- `member_ai_pauses`: one row per paused member. While the row exists, the hold
-- refuses the member's runs as `ai_paused` (403) and nothing is charged
-- (`services/aiBudget.ts` `reserveAiBudget`, `services/aiRouter.ts` `run`).
-- Pausing inserts the row and unpausing deletes it; each is audited in
-- `activity_logs` with the Super Admin's reason, in the same batch as the change
-- (`services/aiUsageAdmin.ts`). The row goes with its member.
--
-- `member_ai_caps`: a lower monthly cap for one member, in micro-USD as every
-- AI amount is (migration 419). `resolveAiCaps` reads it after the licence's
-- cap and the lower one wins, so it can only ever narrow an allowance. Clearing
-- it deletes the row.
--
-- Grep first (D689 D-t): neither table exists in an earlier migration, in
-- schema_baseline.sql, or on any branch on origin. The issue gives 510; 508
-- and 509 are D785's other tasks.
CREATE TABLE IF NOT EXISTS member_ai_pauses (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason    TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  paused_by INTEGER NOT NULL,
  paused_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_ai_caps (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_microusd INTEGER NOT NULL CHECK (typeof(monthly_microusd) = 'integer' AND monthly_microusd BETWEEN 0 AND 9007199254740991),
  set_by           INTEGER NOT NULL,
  set_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
