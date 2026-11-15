-- D5624 (#5624): a team's Landing settings, one row per scope, and their change log.
--
-- Written only by `PUT /api/teams/:scope/:id/landing` (`routes/team_landing.ts`),
-- behind TEAM_LANDING. Each column is one field of `merge-control/contract/landingPolicy.ts`;
-- NULL is unset and reads as null (the enforcer applies LANDING_DEFAULTS). No row
-- is every field unset. `version` makes a save compare-and-swap: a save made from
-- a stale read changes nothing and logs nothing.
--
--   repository_ref           venture_git_installations.uid (D5569), never a URL or a credential
--   landing_json             { auto_tiers, t2_signers }; T2 is never an auto tier
--   repair_json              { max_attempts, max_spend_microusd, pushers }
--   path_owners_json         [{ path, owners }]
--   max_parallel_per_repo    1..HQ cap
--   compute_budget_microusd  compute, separate from the inference budget
--   executors_json           provider ids (D5565)
--
-- Additive only: two new tables, no change to agent_scope_settings or team_allowlists.
CREATE TABLE IF NOT EXISTS agent_landing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  repository_ref TEXT CHECK (repository_ref IS NULL OR (length(repository_ref) = 32 AND repository_ref NOT GLOB '*[^0-9a-f]*')),
  landing_json TEXT CHECK (landing_json IS NULL OR json_valid(landing_json)),
  repair_json TEXT CHECK (repair_json IS NULL OR json_valid(repair_json)),
  path_owners_json TEXT CHECK (path_owners_json IS NULL OR json_valid(path_owners_json)),
  max_parallel_per_repo INTEGER CHECK (max_parallel_per_repo IS NULL OR max_parallel_per_repo >= 1),
  compute_budget_microusd INTEGER CHECK (compute_budget_microusd IS NULL OR compute_budget_microusd >= 0),
  executors_json TEXT CHECK (executors_json IS NULL OR json_valid(executors_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_landing_settings_scope
  ON agent_landing_settings (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0));

-- One row per save: who, and the whole policy before and after. Insert-only.
CREATE TABLE IF NOT EXISTS agent_landing_setting_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  company_id INTEGER REFERENCES company_profiles(id),
  project_id INTEGER REFERENCES projects(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'company' AND company_id IS NOT NULL AND project_id IS NULL)
      OR (scope_kind = 'project' AND project_id IS NOT NULL AND company_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_agent_landing_setting_changes_scope
  ON agent_landing_setting_changes (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), id);

CREATE TRIGGER IF NOT EXISTS trg_agent_landing_setting_changes_no_update
BEFORE UPDATE ON agent_landing_setting_changes
BEGIN
  SELECT RAISE(ABORT, 'agent_landing_setting_changes rows are insert-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_landing_setting_changes_no_delete
BEFORE DELETE ON agent_landing_setting_changes
BEGIN
  SELECT RAISE(ABORT, 'agent_landing_setting_changes rows are insert-only');
END;
