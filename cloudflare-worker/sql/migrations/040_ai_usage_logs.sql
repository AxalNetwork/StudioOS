-- Task #1 (AX) — Multi-model AI router observability.
--
-- Every call routed through cloudflare-worker/src/services/aiRouter.ts
-- writes one row here so the Admin → Monitoring → AI Usage tab can
-- show per-day spend per task class with model / latency / safety /
-- fallback breakdown.
--
-- The router also lazily runs the same CREATE TABLE on first use
-- (`ensureLogSchema()`), so a dev D1 / SQLite still works without this
-- migration. This file is the canonical migration for production D1.

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL when the call originated from a system path with no acting user
  -- (e.g. cron-driven embed backfill). User-initiated calls always set it.
  user_id INTEGER,
  -- Task class enum (see ROUTE in aiRouter.ts) — keep loose so future task
  -- classes don't require a schema migration.
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  -- Populated only for the 'safety' task class (llama-guard score 0..1).
  safety_score REAL,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  -- 'budget_user_day' | 'budget_user_month' | 'budget_org_month' |
  -- 'kill_switch' | 'safety_block' | 'misconfigured' | 'all_models_failed'
  refusal TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task_created ON ai_usage_logs(task, created_at DESC);
