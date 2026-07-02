-- Feature: Portfolio cap-table / ownership view (Support stage).
-- Fund's round-by-round positions (dilution over time). Complements the
-- existing cap_table_holders snapshot (migration 020). Idempotent.
--
-- Renumbered from the source branch's 119 (prefix collided with existing main
-- migrations 116-122). Schema unchanged.

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),   -- nullable = firm-level
  project_id INTEGER NOT NULL REFERENCES projects(id),
  round_name TEXT NOT NULL,                  -- 'Pre-Seed','Seed','Series A',…
  invested_amount REAL NOT NULL DEFAULT 0,
  shares REAL,
  price_per_share REAL,
  ownership_pct REAL,                        -- fully-diluted % after this round
  position_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_positions_project ON portfolio_positions(project_id);
CREATE INDEX IF NOT EXISTS idx_positions_fund    ON portfolio_positions(fund_id);
