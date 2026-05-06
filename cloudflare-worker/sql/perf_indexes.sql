-- T17 — Three missing indexes covering the hot read paths on D1.
-- Each is IF NOT EXISTS so re-applying is a safe no-op.
--
-- Apply once via:
--   npx wrangler d1 execute studioos-db --file=cloudflare-worker/sql/perf_indexes.sql --remote

CREATE INDEX IF NOT EXISTS idx_scores_project_created
  ON score_snapshots(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_project_created
  ON activity_logs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_action_created
  ON activity_logs(action, created_at DESC);
