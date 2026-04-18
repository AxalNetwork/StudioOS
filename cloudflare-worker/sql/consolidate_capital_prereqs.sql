-- consolidate_capital_prereqs.sql
--
-- Phase 0 of the capital-table consolidation. Creates the canonical base
-- tables (`vc_funds`, `limited_partners`) the rest of the pipeline depends
-- on. Extracted from `infrastructure.sql` because that file additionally
-- references `metrics_snapshots(scope, …)`, which collides with a legacy
-- same-named table in production and aborts the whole script.
--
-- Fully idempotent — every CREATE uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS vc_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vintage_year INTEGER,
    total_commitment REAL NOT NULL DEFAULT 0,
    deployed_capital REAL NOT NULL DEFAULT 0,
    lp_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'fundraising',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funds_status ON vc_funds(status);

CREATE TABLE IF NOT EXISTS limited_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    commitment_amount REAL NOT NULL DEFAULT 0,
    invested_amount REAL NOT NULL DEFAULT 0,
    returns REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'committed',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lp_fund   ON limited_partners(fund_id);
CREATE INDEX IF NOT EXISTS idx_lp_user   ON limited_partners(user_id);
CREATE INDEX IF NOT EXISTS idx_lp_status ON limited_partners(status);
