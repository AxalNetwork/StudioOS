-- 727 — D1529 (#3845, E1 of #3742): goals, tasks and dependencies on one
-- company or one project, so people and team agents (D1496) work toward the
-- same goals.
--
-- A goal belongs to ONE scope (#3727's columns and CHECK). A project goal may
-- roll up to its company's goal (`parent_goal_id`) only while the project sits
-- in that company, and may link the project's OKR (`okr_id`). A task belongs to
-- the same scope, may serve a goal, and is assigned to a person, an agent
-- (`team_agents`, migration 712) or no one. "Ready" is derived (open, and every
-- dependency done), never stored.
--
-- Untouched: `workflow_tasks` (177) and `project_rituals` (250) stay as they
-- are, and nothing is migrated into these tables.
--
-- Additive only: four new tables, two columns and one index on
-- `ai_rail_proposals`. Nothing is rebuilt or backfilled.
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`), as
-- 493 and 712 are.

CREATE TABLE IF NOT EXISTS scope_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  why TEXT CHECK (why IS NULL OR length(why) <= 2000),
  metric TEXT CHECK (metric IS NULL OR length(metric) <= 200),
  target_date TEXT,
  -- One of the six lifecycle stages (routes/progress.ts LIFECYCLE_STAGES); projects only.
  stage TEXT CHECK (stage IS NULL OR stage IN ('idea', 'validate', 'build', 'launch', 'raise', 'grow')),
  -- A company goal this project goal rolls up to. The service keeps it to the
  -- project's own company; it is never another project goal.
  parent_goal_id INTEGER REFERENCES scope_goals(id),
  -- The project's own OKR (`roadmap_okrs`, migration 001); project goals only.
  okr_id INTEGER REFERENCES roadmap_okrs(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'achieved', 'dropped')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL)),
  CHECK (stage IS NULL OR scope_kind = 'project'),
  CHECK (okr_id IS NULL OR scope_kind = 'project'),
  CHECK (parent_goal_id IS NULL OR scope_kind = 'project')
);

CREATE INDEX IF NOT EXISTS idx_scope_goals_scope
  ON scope_goals (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), status, priority);
CREATE INDEX IF NOT EXISTS idx_scope_goals_parent ON scope_goals (parent_goal_id);

CREATE TABLE IF NOT EXISTS scope_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  goal_id INTEGER REFERENCES scope_goals(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 4000),
  -- A module key of services/agents/catalogue.ts and one of its rail options, or NULL.
  module TEXT,
  option TEXT,
  -- A company task about one of its projects.
  context_project_id INTEGER REFERENCES projects(id),
  kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'duty', 'handoff', 'review')),
  assignee_kind TEXT NOT NULL DEFAULT 'none' CHECK (assignee_kind IN ('person', 'agent', 'none')),
  assignee_user_id INTEGER REFERENCES users(id),
  assignee_agent_id INTEGER REFERENCES team_agents(id),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_decision', 'done', 'blocked', 'cancelled')),
  blocked_reason TEXT CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 500),
  priority INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'plan', 'duty', 'handoff', 'build_plan_item', 'lifecycle_check', 'one_next_thing')),
  source_ref TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_by_agent_id INTEGER REFERENCES team_agents(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL)),
  CHECK (context_project_id IS NULL OR scope_kind = 'company'),
  CHECK ((assignee_kind = 'person' AND assignee_user_id IS NOT NULL AND assignee_agent_id IS NULL)
      OR (assignee_kind = 'agent' AND assignee_agent_id IS NOT NULL AND assignee_user_id IS NULL)
      OR (assignee_kind = 'none' AND assignee_user_id IS NULL AND assignee_agent_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_scope_tasks_scope
  ON scope_tasks (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), status, priority);
CREATE INDEX IF NOT EXISTS idx_scope_tasks_agent ON scope_tasks (assignee_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_scope_tasks_context ON scope_tasks (context_project_id);
CREATE INDEX IF NOT EXISTS idx_scope_tasks_goal ON scope_tasks (goal_id);

-- A task waits on another of the same scope (the service checks the scope and
-- refuses a cycle).
CREATE TABLE IF NOT EXISTS scope_task_deps (
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  depends_on_task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_scope_task_deps_on ON scope_task_deps (depends_on_task_id);

-- What happened to a task: created, assigned, status changes, deps set. Names
-- and ids only, never a prompt or an output.
CREATE TABLE IF NOT EXISTS scope_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  actor_user_id INTEGER REFERENCES users(id),
  actor_agent_id INTEGER REFERENCES team_agents(id),
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'assigned', 'status', 'deps_set')),
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scope_task_events_task ON scope_task_events (task_id, id DESC);

-- A proposal made for a task (E2's runs), and the run's idempotency key.
ALTER TABLE ai_rail_proposals ADD COLUMN task_id INTEGER REFERENCES scope_tasks(id);
ALTER TABLE ai_rail_proposals ADD COLUMN run_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_rail_proposals_run_key ON ai_rail_proposals (run_key) WHERE run_key IS NOT NULL;
