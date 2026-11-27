-- D1096 (#2961, #2408 part 1): Vercel's installations and the projects each
-- connection reads for a venture.
--
-- vercel_installations: one row per connection. Vercel signs every
-- installation's webhook events to one URL, so the receiver finds the
-- connection by `configuration_id` here, a bound lookup, never a scan of
-- `integrations.config_json`. `team_id` is NULL for a personal account.
--
-- vercel_projects: per connection, venture and Vercel project, the facts the
-- sync reads. Names and domains are facts about the founder's own hosting;
-- no person, no commit message and no log line is stored.
--
-- Both cascade with the connection's row. Vercel parts 2-4 add their own
-- tables (deployments 591, health events 590, company proposals).
CREATE TABLE IF NOT EXISTS vercel_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL UNIQUE REFERENCES integrations(id) ON DELETE CASCADE,
  configuration_id TEXT NOT NULL UNIQUE,
  team_id TEXT,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('personal', 'team')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vercel_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  vercel_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  framework TEXT,
  node_version TEXT,
  production_branch TEXT,
  git_repository TEXT,
  production_domain TEXT,
  plan TEXT,
  live_state TEXT NOT NULL DEFAULT 'not_deployed' CHECK (live_state IN ('live', 'failing', 'building', 'not_deployed')),
  live_since TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, vercel_project_id)
);
CREATE INDEX IF NOT EXISTS idx_vercel_projects_project ON vercel_projects (project_id, integration_id);
