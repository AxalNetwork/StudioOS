-- 712 — D1496 (#3840, part 1 of #3727): the team agent registry, its rule
-- books and its audit trail.
--
-- An agent is a record on ONE company or ONE project. It has a role from the
-- catalogue in code (`services/agents/catalogue.ts`), a platform model from
-- the offered catalogue (D760/D1369), a sponsor (the editor who added it; its
-- runs are the sponsor's, part 2) and a monthly cap. Its output is always an
-- `ai_rail_proposals` row; nothing it does is automatic (owner Q1 = A).
--
-- Additive only: three new tables, two columns on `ai_rail_proposals` and one
-- on `ai_usage_logs`. No table is rebuilt, nothing is backfilled. A proposal
-- or a usage row written before this file has the new columns NULL: no agent,
-- decided by its owner.
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`), as
-- 493 is.

-- The registry. One live agent per role per scope (the partial unique index
-- below); a removed agent keeps its row, its events and its proposals.
CREATE TABLE IF NOT EXISTS team_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  role_key TEXT NOT NULL,
  -- The canvas TM3c: a first name and a surname so the team can tell it
  -- apart. Each at most 40 characters, trimmed; NULL when not given.
  first_name TEXT CHECK (first_name IS NULL OR length(first_name) <= 40),
  last_name TEXT CHECK (last_name IS NULL OR length(last_name) <= 40),
  model_id TEXT NOT NULL,
  -- [{ integration_uid, tool }]: the sponsor's approved D852 read tools. Part
  -- 1 refuses any non-empty grant (fail closed) until part 5 checks them.
  tool_grants_json TEXT NOT NULL DEFAULT '[]',
  sponsor_user_id INTEGER NOT NULL REFERENCES users(id),
  monthly_cap_microusd INTEGER NOT NULL CHECK (monthly_cap_microusd > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
  -- manual | cap | sponsor_left | tool_disconnected. No CHECK: #3742 E3
  -- extends the list.
  paused_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_agents_live_role
  ON team_agents (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), role_key)
  WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_team_agents_company ON team_agents (company_id, status);
CREATE INDEX IF NOT EXISTS idx_team_agents_project ON team_agents (project_id, status);

-- A scope's rule book for one role, versioned. Rows are never updated: the
-- highest version wins, and no row means the catalogue's default.
CREATE TABLE IF NOT EXISTS team_rulebooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  role_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  rules_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_rulebooks_version
  ON team_rulebooks (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), role_key, version);

-- The audit: every change to an agent, and (part 2) every run and refusal.
CREATE TABLE IF NOT EXISTS team_agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id),
  actor_user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('added', 'paused', 'resumed', 'removed', 'cap_changed',
    'rulebook_changed', 'run', 'refused', 'proposal_decided')),
  usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  proposal_uid TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_agent_events_agent ON team_agent_events (agent_id, id DESC);

-- A proposal an agent made, and who decided it (TM7's shared queue, part 3).
-- NULL on every member's own proposal: its owner decides it, as before.
ALTER TABLE ai_rail_proposals ADD COLUMN agent_id INTEGER REFERENCES team_agents(id);
ALTER TABLE ai_rail_proposals ADD COLUMN decided_by_user_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_ai_rail_proposals_agent ON ai_rail_proposals (agent_id, status);

-- The agent a run was made for (part 2 writes it). Its cap is the sum of this
-- column's runs' `charged_microusd` this month.
ALTER TABLE ai_usage_logs ADD COLUMN agent_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ai_usage_agent_created ON ai_usage_logs (agent_id, created_at);
