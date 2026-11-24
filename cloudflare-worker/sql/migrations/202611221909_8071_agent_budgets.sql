-- D8071 (#8071): execution budgets for agents. Expand only: three new tables and nullable columns.
--
-- agent_budgets          one row per agent: its caps for the period (calendar month, UTC), who set them and when.
--                        A NULL cap is "no cap": the meter shows usage and says so in words.
-- agent_budget_usage     what the agent used in a period: tokens and minutes per month ('YYYY-MM'),
--                        PRs opened per day ('YYYY-MM-DD'). Kept by `services/agentBudgets.ts`, never by hand.
-- agent_budget_settlements  one row per settled step (`run:<run uid>:<step>`) or publication (`publish:<key>`),
--                        so a retried step adds its usage once. Its task_id gives the task-level totals.
--
-- Task ceilings sit on scope_tasks (NULL = the agent's cap). Workspace ceilings sit on
-- agent_scope_settings (NULL = the platform figure), and the platform figures on ai_agent_policy
-- (NULL = no ceiling). The tokens and minutes settled come from the usage ledger (ai_usage_logs); no
-- second ledger of charges is kept.

CREATE TABLE IF NOT EXISTS agent_budgets (
  agent_id INTEGER PRIMARY KEY REFERENCES team_agents(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT 'calendar_month_utc' CHECK (period IN ('calendar_month_utc')),
  tokens_cap INTEGER CHECK (tokens_cap IS NULL OR tokens_cap BETWEEN 1 AND 10000000000),
  minutes_cap INTEGER CHECK (minutes_cap IS NULL OR minutes_cap BETWEEN 1 AND 1000000),
  prs_per_day_cap INTEGER CHECK (prs_per_day_cap IS NULL OR prs_per_day_cap BETWEEN 0 AND 1000),
  retries_per_task_cap INTEGER CHECK (retries_per_task_cap IS NULL OR retries_per_task_cap BETWEEN 0 AND 100),
  set_by INTEGER REFERENCES users(id),
  set_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_budget_usage (
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL CHECK (length(period_key) IN (7, 10)),
  tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  -- Minutes are kept in milliseconds so many short steps add up exactly; the API reports minutes.
  ms_used INTEGER NOT NULL DEFAULT 0 CHECK (ms_used >= 0),
  prs_opened INTEGER NOT NULL DEFAULT 0 CHECK (prs_opened >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, period_key)
);

CREATE TABLE IF NOT EXISTS agent_budget_settlements (
  settle_key TEXT PRIMARY KEY CHECK (length(settle_key) BETWEEN 8 AND 160),
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  task_id INTEGER,
  period_key TEXT NOT NULL CHECK (length(period_key) IN (7, 10)),
  tokens INTEGER NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  ms INTEGER NOT NULL DEFAULT 0 CHECK (ms >= 0),
  prs INTEGER NOT NULL DEFAULT 0 CHECK (prs IN (0, 1)),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_budget_settlements_task ON agent_budget_settlements (task_id) WHERE task_id IS NOT NULL;

ALTER TABLE scope_tasks ADD COLUMN budget_tokens_cap INTEGER CHECK (budget_tokens_cap IS NULL OR budget_tokens_cap BETWEEN 1 AND 10000000000);
ALTER TABLE scope_tasks ADD COLUMN budget_minutes_cap INTEGER CHECK (budget_minutes_cap IS NULL OR budget_minutes_cap BETWEEN 1 AND 1000000);
ALTER TABLE scope_tasks ADD COLUMN budget_retries_cap INTEGER CHECK (budget_retries_cap IS NULL OR budget_retries_cap BETWEEN 0 AND 100);

ALTER TABLE agent_scope_settings ADD COLUMN agents_cap INTEGER CHECK (agents_cap IS NULL OR agents_cap BETWEEN 0 AND 10000);
ALTER TABLE agent_scope_settings ADD COLUMN live_agents_cap INTEGER CHECK (live_agents_cap IS NULL OR live_agents_cap BETWEEN 0 AND 10000);
ALTER TABLE agent_scope_settings ADD COLUMN ai_spend_cap_cents INTEGER CHECK (ai_spend_cap_cents IS NULL OR ai_spend_cap_cents BETWEEN 0 AND 100000000);
ALTER TABLE agent_scope_settings ADD COLUMN compute_spend_cap_cents INTEGER CHECK (compute_spend_cap_cents IS NULL OR compute_spend_cap_cents BETWEEN 0 AND 100000000);

ALTER TABLE ai_agent_policy ADD COLUMN workspace_agents_cap INTEGER CHECK (workspace_agents_cap IS NULL OR workspace_agents_cap BETWEEN 0 AND 10000);
ALTER TABLE ai_agent_policy ADD COLUMN workspace_live_agents_cap INTEGER CHECK (workspace_live_agents_cap IS NULL OR workspace_live_agents_cap BETWEEN 0 AND 10000);
ALTER TABLE ai_agent_policy ADD COLUMN workspace_ai_spend_cap_cents INTEGER CHECK (workspace_ai_spend_cap_cents IS NULL OR workspace_ai_spend_cap_cents BETWEEN 0 AND 100000000);
ALTER TABLE ai_agent_policy ADD COLUMN workspace_compute_spend_cap_cents INTEGER CHECK (workspace_compute_spend_cap_cents IS NULL OR workspace_compute_spend_cap_cents BETWEEN 0 AND 100000000);
