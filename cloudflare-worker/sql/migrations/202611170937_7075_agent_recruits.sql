-- D7075 (#7075, part of #7072): recruits. When an accepted plan names a role
-- the team has no active agent for, the team is asked to add one. A request
-- is a proposal: nothing is created, granted or charged until a manager of
-- the team approves it (owner decision D1), through the ordinary add path.
--
-- One open request per scope and role (the partial unique index); a second
-- plan that needs the same role adds its tasks to the open request.

CREATE TABLE IF NOT EXISTS agent_recruit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  role_key TEXT NOT NULL,
  -- The plan (ai_rail_proposals.uid) that first asked, and the agent that drafted it (NULL when Eadwyn planned).
  plan_proposal_uid TEXT NOT NULL,
  planner_agent_id INTEGER REFERENCES team_agents(id),
  -- Who accepted the plan.
  requested_by_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  decline_reason TEXT CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  -- The agent an approval added.
  agent_id INTEGER REFERENCES team_agents(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'open') = (decided_at IS NULL)),
  CHECK (status <> 'approved' OR agent_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_recruit_requests_open
  ON agent_recruit_requests (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), role_key)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_agent_recruit_requests_scope
  ON agent_recruit_requests (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), status);

-- The tasks waiting on a request.
CREATE TABLE IF NOT EXISTS agent_recruit_tasks (
  request_id INTEGER NOT NULL REFERENCES agent_recruit_requests(id),
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_recruit_tasks_task ON agent_recruit_tasks (task_id);
