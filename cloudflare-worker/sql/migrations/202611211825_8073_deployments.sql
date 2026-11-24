-- D8073 (#8073): one row per production Worker deploy, written by
-- scripts/deploy/record-deployment.mjs through POST /api/internal/deployments.
-- Provenance only: nothing reads it to decide a deploy, and rollback
-- mechanics are out of scope (rollback_of names the deploy a rollback undid).
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha TEXT NOT NULL CHECK(length(sha) = 40 AND sha NOT GLOB '*[^0-9a-f]*'),
  run_id TEXT NOT NULL CHECK(length(run_id) BETWEEN 1 AND 20 AND run_id NOT GLOB '*[^0-9]*'),
  worker_version_id TEXT NOT NULL CHECK(length(worker_version_id) BETWEEN 1 AND 64),
  attestation_url TEXT CHECK(attestation_url IS NULL OR length(attestation_url) <= 300),
  built_at TEXT,
  deployed_at TEXT NOT NULL,
  rollback_of INTEGER REFERENCES deployments(id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, worker_version_id)
);
CREATE INDEX IF NOT EXISTS idx_deployments_sha ON deployments(sha);
