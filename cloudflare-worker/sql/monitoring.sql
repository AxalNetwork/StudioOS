-- Monitoring & Observability schema
-- Run via: npx wrangler d1 execute studioos-db --file=sql/monitoring.sql --remote
--
-- IDEMPOTENT: this file uses CREATE TABLE IF NOT EXISTS for new tables and a
-- migrations-tracking table to gate the non-idempotent ALTER TABLE statements.
-- Re-running this file is safe.

-- ---------- migrations bookkeeping ----------
CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- system_metrics ----------
CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    labels TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_name_ts ON system_metrics(metric_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON system_metrics(timestamp);

-- ---------- rate_limit_logs ----------
CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    endpoint TEXT NOT NULL,
    requests_in_window INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    bucket TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rl_user_ts ON rate_limit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rl_blocked_ts ON rate_limit_logs(blocked, created_at);
CREATE INDEX IF NOT EXISTS idx_rl_endpoint ON rate_limit_logs(endpoint);

-- ---------- error_logs ----------
CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    endpoint TEXT,
    method TEXT,
    status_code INTEGER,
    message TEXT,
    stack_snippet TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_errlog_ts ON error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_errlog_status ON error_logs(status_code);

-- ---------- queue_jobs ----------
CREATE TABLE IF NOT EXISTS queue_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_status_ts ON queue_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_type ON queue_jobs(job_type);

-- ---------- Extend activity_logs (run once) ----------
-- D1/SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so the safe pattern
-- is to apply ALTERs in a separate file (sql/monitoring_alter_activity.sql) and
-- track them in `_migrations`. See deploy-workers.sh for orchestration.

CREATE INDEX IF NOT EXISTS idx_activity_endpoint ON activity_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
