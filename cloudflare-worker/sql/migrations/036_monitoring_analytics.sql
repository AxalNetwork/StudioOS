-- Task #4 (AJ) — Monitoring > User Analytics deployment artifact.
--
-- Why this file exists when the schema is already live:
--   * `analytics_snapshots` was first created by 012_analytics_snapshots.sql
--     and `admin_audit_log` is created lazily by ensureSchema() inside
--     routes/monitoring_analytics.ts. Both objects already exist on the
--     remote D1 instance.
--   * This migration is the deployment-pipeline artifact for Task #4 so
--     that a fresh D1 replay (or a new environment) gets all monitoring-
--     analytics tables in one numbered file, matching the spec contract.
--   * Every statement is `IF NOT EXISTS` and therefore idempotent — re-
--     running on prod is a safe no-op.
--
-- Apply (remote, manual):
--   PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH \
--     npx wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/036_monitoring_analytics.sql

-- ---------- analytics_snapshots (daily rollup, written by cron) ----------
-- Mirrors 012_analytics_snapshots.sql exactly so a fresh DB replay still
-- picks the table up if 012 is missing for any reason.
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  active_users INTEGER NOT NULL DEFAULT 0,
  new_signups INTEGER NOT NULL DEFAULT 0,
  total_users INTEGER NOT NULL DEFAULT 0,
  paid_users INTEGER NOT NULL DEFAULT 0,
  total_requests INTEGER NOT NULL DEFAULT 0,
  errors_5xx INTEGER NOT NULL DEFAULT 0,
  p50_latency_ms INTEGER NOT NULL DEFAULT 0,
  p95_latency_ms INTEGER NOT NULL DEFAULT 0,
  mrr_usd REAL NOT NULL DEFAULT 0,
  arr_usd REAL NOT NULL DEFAULT 0,
  new_mrr_usd REAL NOT NULL DEFAULT 0,
  churn_mrr_usd REAL NOT NULL DEFAULT 0,
  churned_subscriptions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'cron',
  UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_date
  ON analytics_snapshots(snapshot_date DESC);

-- ---------- admin_audit_log (Recent Exports panel + plan-edit history) -----
-- Created lazily today by ensureSchema() in routes/monitoring_analytics.ts.
-- Restated here so the deployment pipeline owns the schema rather than the
-- runtime. Index pair matches what the audit/exports queries actually use.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  report_type TEXT,
  format TEXT,
  filters_json TEXT,
  storage_key TEXT,
  download_url TEXT,
  exported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_user_ts
  ON admin_audit_log(admin_user_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_ts
  ON admin_audit_log(action, exported_at DESC);
