-- 592 — Vercel feeds Company creation: where production runs (D1099, #2964).
--
-- Two new tables, no change to an existing one. Grep-first (D689 D-t): no
-- table named `vercel_company_facts` or `vercel_company_proposals` exists in
-- any earlier migration, and nothing here decides a value for a row that
-- already exists.
--
--   vercel_company_facts  per connection, venture and Vercel project: the
--       account production runs on (a personal account or a team) and its plan
--       (hobby, pro, enterprise, or NULL when Vercel did not say), as facts.
--       The rows go with their connection (ON DELETE CASCADE), and the
--       provider's disconnect deletes them first.
--   vercel_company_proposals  the formation step Vercel's facts propose for a
--       project on the Hobby plan: "Move the production project to the
--       company's Vercel team on a paid plan". Proposed once per connection,
--       venture, project and kind; the founder accepts it (it becomes a
--       formation step, with its ledger row, `'company_creation', 'hosting_step'`)
--       or dismisses it, and a re-sync never proposes it again. A pending one
--       is withdrawn when the project leaves the Hobby plan. Accept changes
--       nothing on Vercel.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS vercel_company_facts (
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  vercel_project_id TEXT NOT NULL,
  project_name TEXT,
  account_kind TEXT NOT NULL CHECK (account_kind IN ('personal', 'team')),
  plan TEXT CHECK (plan IS NULL OR plan IN ('hobby', 'pro', 'enterprise')),
  plan_source TEXT NOT NULL CHECK (plan_source IN ('project', 'personal_account', 'none')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (integration_id, project_id, vercel_project_id)
);

CREATE TABLE IF NOT EXISTS vercel_company_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  vercel_project_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'move_to_team' CHECK (kind IN ('move_to_team')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  step_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, vercel_project_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_vercel_company_proposals_project
  ON vercel_company_proposals (project_id, status, id);
