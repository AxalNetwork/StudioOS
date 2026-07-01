-- Feature: LP Reporting / quarterly LP updates (Support stage).
-- GPs draft/publish per-fund, per-period reports; LPs read published reports
-- for funds they belong to. D1 CREATE ... IF NOT EXISTS is idempotent.

CREATE TABLE IF NOT EXISTS lp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
  period TEXT NOT NULL,                    -- e.g. '2026-Q2'
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | published
  nav REAL, called REAL, distributed REAL,
  dpi REAL, tvpi REAL, irr REAL,
  narrative TEXT,
  created_by INTEGER REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fund_id, period)
);
CREATE INDEX IF NOT EXISTS idx_lp_reports_fund ON lp_reports(fund_id);
