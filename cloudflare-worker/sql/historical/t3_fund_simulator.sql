-- T3 — Reserve allocation + waterfall simulator (Task #46 port).
-- Apply via: wrangler d1 execute studioos-db --file=cloudflare-worker/sql/t3_fund_simulator.sql --remote

-- ---------- fund_reserve_allocations ----------
CREATE TABLE IF NOT EXISTS fund_reserve_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    reserve_amount REAL NOT NULL DEFAULT 0,
    initial_check REAL NOT NULL DEFAULT 0,
    next_round_label TEXT,
    target_ownership_pct REAL,
    confidence TEXT NOT NULL DEFAULT 'medium',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fra_fund_project ON fund_reserve_allocations(fund_id, project_id);
CREATE INDEX IF NOT EXISTS idx_fra_project ON fund_reserve_allocations(project_id);

-- ---------- fund_scenarios ----------
CREATE TABLE IF NOT EXISTS fund_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    kind TEXT NOT NULL,        -- reserves | waterfall
    name TEXT NOT NULL,
    description TEXT,
    inputs_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fs_fund ON fund_scenarios(fund_id);
CREATE INDEX IF NOT EXISTS idx_fs_kind ON fund_scenarios(kind);
CREATE INDEX IF NOT EXISTS idx_fs_created_by ON fund_scenarios(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_fs_created_at ON fund_scenarios(created_at);
