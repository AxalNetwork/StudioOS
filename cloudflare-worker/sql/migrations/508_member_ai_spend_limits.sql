-- 508 — a member's own monthly AI spend limit, and the notices it sends (D788, #2213).
--
-- A member may cap what they spend on AI runs in a UTC month, in micro-USD.
-- The limit counts everything their runs are charged that month, the plan's
-- allowance included (D783), because the limit is on what the member spends
-- and the allowance is part of it. No row means no limit: today's behaviour.
-- The hold (`services/aiBudget.ts`, `reserveAiBudget`) refuses a run whose
-- estimate would take the month past the limit, in the same conditional
-- insert that places the hold, so two holds racing cannot both pass a limit
-- that only one fits.
--
-- `notify_50`, `notify_80`, `notify_100` switch the notice sent when a settled
-- run first takes the month past that share of the limit.
-- `member_ai_spend_notices` records each notice sent, so each is sent once per
-- member per month and threshold.
--
-- Additive and idempotent. No row is seeded.
CREATE TABLE IF NOT EXISTS member_ai_spend_limits (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_limit_microusd INTEGER NOT NULL CHECK (monthly_limit_microusd >= 0),
  notify_50 INTEGER NOT NULL DEFAULT 1,
  notify_80 INTEGER NOT NULL DEFAULT 1,
  notify_100 INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_ai_spend_notices (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold IN (50, 80, 100)),
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month, threshold)
);
