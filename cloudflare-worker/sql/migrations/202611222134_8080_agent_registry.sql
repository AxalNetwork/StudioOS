-- D8080 (#8080): the agent registry, synced from the reviewed manifests in agents/<name>.agent.yml (D8079)
-- after each deploy by scripts/deploy/sync-agent-registry.mjs through POST /api/internal/agent-registry/sync.
--
--   agent_registry        one row per manifest version. `version` is the first 12 hex of `manifest_sha`, the
--                         SHA-256 of the manifest file's bytes: the manifests carry no version field, so a content
--                         change is a new version. `stage`, `cost_profile` and `security_profile` stay NULL until the
--                         manifest schema records them (nothing is invented). `superseded_at` is set on every other
--                         version of a name when a sync carries a new one, and on every version of a name a sync no
--                         longer carries. The current entry of a name is its row with superseded_at IS NULL.
--   agent_registry_drift  the fields where a manifest and the running system disagree, replaced whole by each
--                         sync, so it always says what the last sync saw. An empty table after a sync is "none
--                         seen", never "not checked": the read route says which agents were compared.
--
-- Additive only: two new tables and two indexes, all IF NOT EXISTS. Rollback: revert the Worker; the tables
-- can stay, since nothing else reads them.

CREATE TABLE IF NOT EXISTS agent_registry (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  version          TEXT NOT NULL CHECK (length(version) = 12),
  stage            TEXT CHECK (stage IS NULL OR stage IN ('research', 'build', 'raise', 'grow', 'operate')),
  kind             TEXT NOT NULL CHECK (kind IN ('platform', 'venture')),
  owner            TEXT NOT NULL CHECK (length(owner) BETWEEN 1 AND 60),
  identity         TEXT NOT NULL CHECK (length(identity) BETWEEN 1 AND 60),
  runner_pool      TEXT NOT NULL CHECK (runner_pool IN ('trusted', 'untrusted', 'none')),
  status           TEXT NOT NULL CHECK (status IN ('live', 'paused', 'retired')),
  manifest_sha     TEXT NOT NULL CHECK (length(manifest_sha) = 64),
  manifest_commit  TEXT NOT NULL CHECK (length(manifest_commit) = 40),
  capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json) AND json_type(capabilities_json) = 'array'),
  models_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(models_json) AND json_type(models_json) = 'array'),
  cost_profile     TEXT CHECK (cost_profile IS NULL OR cost_profile IN ('low', 'medium', 'high')),
  security_profile TEXT CHECK (security_profile IS NULL OR length(security_profile) BETWEEN 1 AND 40),
  synced_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at    TEXT,
  UNIQUE (name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_current ON agent_registry (name) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_registry_drift (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  field          TEXT NOT NULL CHECK (field IN ('status', 'capabilities', 'budgets')),
  manifest_value TEXT,
  runtime_value  TEXT,
  agent_uid      TEXT,
  seen_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_drift_name ON agent_registry_drift (name, field);
