-- High-throughput infrastructure schema (additive + idempotent).
-- Run via: npx wrangler d1 execute studioos-db --file=sql/infrastructure.sql --remote
--
-- Adds: vc_funds, limited_partners, metrics_snapshots, dead_letter_queue
-- Extends: queue_jobs with started_at / completed_at / max_retries / dead_at

-- ---------- vc_funds ----------
CREATE TABLE IF NOT EXISTS vc_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vintage_year INTEGER,
    total_commitment REAL NOT NULL DEFAULT 0,
    deployed_capital REAL NOT NULL DEFAULT 0,
    lp_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'fundraising',  -- fundraising | active | closed | wound_down
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funds_status ON vc_funds(status);

-- ---------- limited_partners ----------
CREATE TABLE IF NOT EXISTS limited_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    commitment_amount REAL NOT NULL DEFAULT 0,
    invested_amount REAL NOT NULL DEFAULT 0,
    returns REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'committed',    -- committed | active | redeemed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lp_fund ON limited_partners(fund_id);
CREATE INDEX IF NOT EXISTS idx_lp_user ON limited_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_status ON limited_partners(status);

-- ---------- metrics_snapshots (project + fund-level) ----------
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,                         -- 'project' | 'fund' | 'global'
    scope_id INTEGER,
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    extra TEXT,                                  -- json blob
    captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snap_scope ON metrics_snapshots(scope, scope_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_snap_metric ON metrics_snapshots(metric_name, captured_at);

-- ---------- dead_letter_queue ----------
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_job_id INTEGER,
    job_type TEXT NOT NULL,
    payload TEXT,
    last_error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dlq_type ON dead_letter_queue(job_type, moved_at);

-- ---------- extend queue_jobs (idempotent) ----------
-- D1 has no `ADD COLUMN IF NOT EXISTS`. We gate ALTERs behind _migrations.
-- Run sql/queue_jobs_alter.sql once if this is the first deploy.
CREATE INDEX IF NOT EXISTS idx_queue_dead ON queue_jobs(status, created_at)
    WHERE status = 'failed';
