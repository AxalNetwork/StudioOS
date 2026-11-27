-- D5569: credential-free registration of a venture's separate GitHub App.
CREATE TABLE IF NOT EXISTS venture_git_installations (
  uid TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  tenant_id INTEGER NOT NULL CHECK (tenant_id BETWEEN 1 AND 9007199254740991),
  company_id INTEGER NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  app_id INTEGER NOT NULL CHECK (app_id BETWEEN 1 AND 9007199254740991),
  installation_id INTEGER NOT NULL CHECK (installation_id BETWEEN 1 AND 9007199254740991),
  repository_id INTEGER NOT NULL CHECK (repository_id BETWEEN 1 AND 9007199254740991),
  repository_full_name TEXT NOT NULL CHECK (length(repository_full_name) BETWEEN 3 AND 140),
  base_ref TEXT NOT NULL CHECK (base_ref LIKE 'refs/heads/_%' AND length(base_ref) <= 255),
  approved_at TEXT NOT NULL,
  approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TEXT,
  CHECK (length(uid) = 32 AND uid NOT GLOB '*[^0-9a-f]*')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_venture_git_installations_current_repo
  ON venture_git_installations (tenant_id, company_id, project_id, repository_id)
  WHERE revoked_at IS NULL;
