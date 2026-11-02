-- 728 — D1528 (#3847, E3 of #3742): the agent engine's tables, in one file so
-- one slot owns it. E3 (the runtime) reads and writes agent_task_runs and
-- agent_scope_settings; E4 (#3848, D1530) writes agent_custom_roles; E5
-- (#3849, D1530) writes agent_duties, agent_handoffs and agent_memory_notes.
--
--   agent_task_runs       one row per run attempt of a task by an agent: its
--                         status, its current step and the step timeline, the
--                         Workflow instance, the usage row and the proposal.
--                         One live run per agent (the single-flight index).
--   agent_duties          an agent's recurring duty: a template, a cadence and
--                         the next time it is due. The sweep claims it with
--                         `... WHERE id = ? AND next_due_at = ? AND status = 'active'`.
--   agent_handoffs        one step of a handoff chain, at most 3 deep.
--   agent_memory_notes    short notes an agent keeps in one scope: decisions,
--                         facts and summaries, never a raw prompt.
--   agent_custom_roles    a scope's own role (key `custom:<uid>`).
--   agent_scope_settings  per scope: paused, and how many runs at once.
--
-- Scopes follow #3727's pattern (712, 727): `scope_kind` with exactly one of
-- `company_id` and `project_id`, both immutable ids, never a name.
--
-- The spec (#3742 comment 6542845207 §4.3, §4.6) names the columns it needs;
-- where it leaves a detail open, the CHECK below is the loosest that keeps a
-- row meaningful, and the service holds the product rule (5 live custom roles
-- per scope, the 20-runs-a-day limit, the 90-day note retention).
--
-- Additive only: six new tables and their indexes. Nothing is altered,
-- rebuilt or backfilled, so every statement is IF NOT EXISTS and the file can
-- be re-run. Agent-keyed rows cascade when their agent row is deleted, so an
-- erased agent leaves none behind (the product amendment, comment 6543010158).

CREATE TABLE IF NOT EXISTS agent_task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Also the Workflow instance id (`AgentTaskWorkflow`).
  uid TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  status TEXT NOT NULL DEFAULT 'admitted'
    CHECK (status IN ('admitted', 'running', 'waiting_decision', 'done', 'refused', 'failed',
                      'cancelled', 'halted', 'scope_moved', 'step_lost')),
  -- The step the run is on, or ended on.
  step TEXT CHECK (step IS NULL OR step IN ('load', 'context', 'run', 'propose', 'wait', 'after')),
  -- [{ name, status, at, summary }]: what the page shows. A summary never
  -- holds a raw prompt or a model output; it is kept 180 days (Q6 A).
  steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(steps_json) AND json_type(steps_json) = 'array'),
  workflow_instance_id TEXT,
  -- The project's company when the run was admitted; the `load` step ends the
  -- run `scope_moved` when it differs. NULL for a project in no company and
  -- for a company scope.
  admitted_company_id INTEGER REFERENCES company_profiles(id),
  usage_log_id INTEGER REFERENCES ai_usage_logs(id),
  proposal_uid TEXT,
  -- A refusal or failure code (`daily_limit`, `read_unavailable`, ...), never a sentence.
  refusal TEXT CHECK (refusal IS NULL OR length(refusal) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  ended_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (task_id, attempt)
);

-- Single flight: one live run per agent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_task_runs_live
  ON agent_task_runs (agent_id) WHERE status IN ('admitted', 'running');
-- The daily limit and an agent's run list.
CREATE INDEX IF NOT EXISTS idx_agent_task_runs_agent ON agent_task_runs (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_task_runs_status ON agent_task_runs (status, updated_at);

CREATE TABLE IF NOT EXISTS agent_duties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  -- A duty template of the agent's role, e.g. `cfo.weekly_runway_note`.
  template_key TEXT NOT NULL CHECK (length(template_key) BETWEEN 1 AND 100),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  module TEXT,
  option TEXT,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  -- 0 = Sunday ... 6 = Saturday, weekly only.
  weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  hour_utc INTEGER NOT NULL CHECK (hour_utc BETWEEN 0 AND 23),
  next_due_at TEXT NOT NULL,
  last_claimed_at TEXT,
  -- What the last claim did: a task was created, or it was skipped and why.
  last_outcome TEXT CHECK (last_outcome IS NULL OR length(last_outcome) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((cadence = 'weekly') = (weekday IS NOT NULL)),
  CHECK ((cadence = 'monthly') = (day_of_month IS NOT NULL))
);

-- One live duty per agent and template (409 duty_exists).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_duties_template
  ON agent_duties (agent_id, template_key) WHERE status <> 'removed';
-- The sweep: active duties that are due.
CREATE INDEX IF NOT EXISTS idx_agent_duties_due ON agent_duties (status, next_due_at);

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- Every step of one chain shares its chain_uid; depth counts from 1.
  chain_uid TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 3),
  from_agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  to_role_key TEXT NOT NULL CHECK (length(to_role_key) BETWEEN 1 AND 100),
  to_agent_id INTEGER REFERENCES team_agents(id) ON DELETE SET NULL,
  -- The task the handoff came from, and the task it created once accepted.
  from_task_id INTEGER REFERENCES scope_tasks(id) ON DELETE SET NULL,
  created_task_id INTEGER REFERENCES scope_tasks(id) ON DELETE SET NULL,
  proposal_uid TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  why TEXT CHECK (why IS NULL OR length(why) <= 1000),
  -- Untrusted: written by a model, read by the next agent inside the untrusted wrapper.
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'discarded', 'refused')),
  -- `handoff_loop`, `depth_exceeded`, ...: a code, never a sentence.
  refusal TEXT CHECK (refusal IS NULL OR length(refusal) BETWEEN 1 AND 64),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chain_uid, depth)
);

CREATE INDEX IF NOT EXISTS idx_agent_handoffs_from ON agent_handoffs (from_agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_to ON agent_handoffs (to_agent_id, status);

CREATE TABLE IF NOT EXISTS agent_memory_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'fact', 'summary')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  -- The run that wrote it, when a run did.
  run_id INTEGER REFERENCES agent_task_runs(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  -- Set when the agent is removed: notes stay 90 days after (Q6 A).
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

-- The context step reads an agent's last 20 notes in its scope.
CREATE INDEX IF NOT EXISTS idx_agent_memory_notes_agent
  ON agent_memory_notes (agent_id, scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), created_at);
CREATE INDEX IF NOT EXISTS idx_agent_memory_notes_expiry ON agent_memory_notes (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_custom_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The role key is `custom:<uid>`.
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  mission TEXT NOT NULL CHECK (length(trim(mission)) BETWEEN 1 AND 600),
  -- JSON arrays of module keys, read keys, rail options, role keys and KPIs.
  works_in_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(works_in_json) AND json_type(works_in_json) = 'array'),
  reads_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reads_json) AND json_type(reads_json) = 'array'),
  may_propose_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(may_propose_json) AND json_type(may_propose_json) = 'array'),
  hands_off_to_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hands_off_to_json) AND json_type(hands_off_to_json) = 'array'),
  kpis_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(kpis_json) AND json_type(kpis_json) = 'array'),
  tone TEXT CHECK (tone IS NULL OR length(tone) <= 600),
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'retired')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_custom_roles_scope
  ON agent_custom_roles (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), status);

CREATE TABLE IF NOT EXISTS agent_scope_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  -- The scope's own pause: no new admissions while 1.
  engine_paused INTEGER NOT NULL DEFAULT 0 CHECK (engine_paused IN (0, 1)),
  max_parallel_runs INTEGER NOT NULL DEFAULT 2 CHECK (max_parallel_runs BETWEEN 1 AND 5),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

-- One settings row per scope; a missing row means the defaults.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_scope_settings_scope
  ON agent_scope_settings (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0));
