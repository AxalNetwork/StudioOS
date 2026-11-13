-- D1098 (#2963, #2408 part 3): the deployments a Vercel connection reads for a
-- venture's chosen projects. Prototype / MVP's Live strip and Preview chips and
-- Product roadmap's Deploys strip and "Live on" marks read them; Vercel never
-- writes a roadmap item, a must-have, a release or a release check.
--
-- No creator and no commit message are stored. `commit_sha` is the full,
-- lowercased SHA Vercel names, so a mark is drawn only on equality with
-- GitHub's own (`mvp_features.merge_commit_sha`, `roadmap_releases.commit_sha`).
-- A preview is matched to a must-have by `repository` and `pr_number`, never
-- by branch name or time.
--
-- Kept 180 days, or the newest 500 per venture; each row is a
-- `connector_fed_items` row (`deploy:<deployment_id>`), and one the sync or
-- the retention removed stays removed. Cascades with the connection.
CREATE TABLE IF NOT EXISTS vercel_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  vercel_project_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('production', 'preview')),
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  build_seconds INTEGER,
  commit_sha TEXT,
  branch TEXT,
  pr_number INTEGER,
  repository TEXT,
  source TEXT,
  error_code TEXT,
  is_rollback INTEGER NOT NULL DEFAULT 0 CHECK (is_rollback IN (0, 1)),
  promoted_at TEXT,
  preview_url TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, deployment_id)
);
CREATE INDEX IF NOT EXISTS idx_vercel_deployments_project ON vercel_deployments (project_id, target, created_at);
