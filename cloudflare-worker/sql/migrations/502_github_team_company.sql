-- 502 — GitHub feeds Founding team and Company creation (D782, #2115).
--
-- Four new tables, no change to an existing one.
--
--   github_contributors  who commits to each chosen repository, per connection
--       and project: a login and its commits in the last 90 days. A login is
--       personal data: only the project's members read it, and it is never
--       logged. The rows go with their connection (ON DELETE CASCADE), and the
--       provider's disconnect deletes them first.
--   github_login_map  the founder's own mapping of a login to a founder on the
--       cap table, made once per project and never guessed from a name or an
--       email. It is the project's, so it outlives a connection. The ledger row
--       (`module = 'founding_team'`, `kind = 'contributor'`) links each mapped
--       login to its founder, so a mapped contributor counts as fed.
--   github_repo_facts  where each chosen repository's code sits, as facts: its
--       owner's kind (a personal account or an organisation) and its licence
--       (the SPDX id, or NULL when the repository has no licence file).
--   company_creation_proposals  the formation step GitHub proposes for a
--       repository a personal account owns: "Move the code into the company's
--       GitHub organisation". Proposed once per repository and connection; the
--       founder accepts it (it becomes a formation step, with its ledger row,
--       `'company_creation', 'ip_step'`) or dismisses it, and a re-sync never
--       proposes it again. A pending one is withdrawn when the repository moves
--       to an organisation.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS github_contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  login TEXT NOT NULL,
  commits_90d INTEGER NOT NULL DEFAULT 0 CHECK (commits_90d >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, repository, login)
);

CREATE INDEX IF NOT EXISTS idx_github_contributors_project
  ON github_contributors (project_id, login);

CREATE TABLE IF NOT EXISTS github_login_map (
  project_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  holder_id INTEGER NOT NULL REFERENCES cap_table_holders(id) ON DELETE CASCADE,
  mapped_by INTEGER NOT NULL,
  mapped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, login)
);

CREATE TABLE IF NOT EXISTS github_repo_facts (
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('personal', 'organisation')),
  owner_login TEXT NOT NULL,
  licence TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (integration_id, project_id, repository)
);

CREATE TABLE IF NOT EXISTS company_creation_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'move_to_org' CHECK (kind IN ('move_to_org')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  step_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, repository, kind)
);

CREATE INDEX IF NOT EXISTS idx_company_creation_proposals_project
  ON company_creation_proposals (project_id, status, id);
