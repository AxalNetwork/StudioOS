-- D4535 (#4535) slice 2: the four tables slice 1 proposed (D4535.md §2),
-- additive only. A workflow's identity, its immutable published versions, a
-- run bound to one version through its frozen plan, and the one link the task
-- store lacks (which scope task is which node of which run).
--
-- NOTHING HERE RUNS ANYTHING. These tables hold definitions and admitted runs.
-- No route, cron or queue reads them in this slice, no scope task is created
-- for a run, and no agent is started: activation of the Startup Assessment
-- workflow stays gated on #4531/#4588, #4667, #4533 and #4536 (D4535 §8).
--
-- Names: `workflows` (177) is an unrelated legacy table, so these use the
-- `agent_skill_workflow*` prefix. No existing table is altered.

CREATE TABLE IF NOT EXISTS agent_skill_workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) = 32),
  scope TEXT NOT NULL CHECK (scope IN ('hq', 'company')),
  company_id INTEGER REFERENCES company_profiles(id),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  -- The editable draft, shape-checked on save. Published content lives only in versions.
  draft_json TEXT CHECK (draft_json IS NULL OR json_valid(draft_json)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'hq' AND company_id IS NULL) OR (scope = 'company' AND company_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skill_workflows_slug
  ON agent_skill_workflows (scope, IFNULL(company_id, 0), slug);

-- A published version: the definition exactly as validated, and its hash. Never edited.
CREATE TABLE IF NOT EXISTS agent_skill_workflow_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER NOT NULL REFERENCES agent_skill_workflows(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  definition_hash TEXT NOT NULL CHECK (length(definition_hash) = 64),
  policy_version TEXT NOT NULL,
  published_by INTEGER NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_id, version)
);
CREATE TRIGGER IF NOT EXISTS trg_agent_skill_workflow_versions_immutable
BEFORE UPDATE ON agent_skill_workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_workflow_versions rows are immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_agent_skill_workflow_versions_undeletable
BEFORE DELETE ON agent_skill_workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_workflow_versions rows are immutable');
END;

-- A run: bound to one version through its frozen plan. Scoped like scope_tasks.
CREATE TABLE IF NOT EXISTS agent_skill_workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  -- planRun's run_key: the same request on the same version in the same scope
  -- is one run, so a repeated start finds the first.
  run_key TEXT NOT NULL UNIQUE,
  version_id INTEGER NOT NULL REFERENCES agent_skill_workflow_versions(id),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json)),
  status TEXT NOT NULL DEFAULT 'admitted'
    CHECK (status IN ('admitted', 'running', 'waiting_decision', 'finished', 'partial', 'stopped', 'cancelled', 'paused_incompatible')),
  cancel_requested_at TEXT,
  brief_proposal_uid TEXT,
  brief_artifact_key TEXT,
  started_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_workflow_runs_scope
  ON agent_skill_workflow_runs (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), status);
-- The stored plan is the run's contract: it is written once and never rewritten.
CREATE TRIGGER IF NOT EXISTS trg_agent_skill_workflow_runs_plan_frozen
BEFORE UPDATE OF plan_json, run_key, version_id, scope_kind, company_id, project_id ON agent_skill_workflow_runs
BEGIN
  SELECT RAISE(ABORT, 'a workflow run''s plan, version and scope are frozen');
END;

-- The one link the task store lacks: which task is which node of which run.
-- A node's attempts are that task's agent_task_runs rows; its output is their proposal.
CREATE TABLE IF NOT EXISTS agent_skill_workflow_run_nodes (
  run_id INTEGER NOT NULL REFERENCES agent_skill_workflow_runs(id),
  node_key TEXT NOT NULL CHECK (length(node_key) BETWEEN 1 AND 40),
  task_id INTEGER NOT NULL UNIQUE REFERENCES scope_tasks(id),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped', 'cancelled')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64),
  output_artifact_key TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array'),
  PRIMARY KEY (run_id, node_key)
);
