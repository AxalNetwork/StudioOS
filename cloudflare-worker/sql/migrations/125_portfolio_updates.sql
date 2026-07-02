-- Feature: Portfolio-company update inbox (Support stage).
-- Founders submit periodic KPI/narrative updates for their projects; investors
-- read the resulting feed. D1 CREATE ... IF NOT EXISTS is idempotent.
--
-- Renumbered from the source branch's 118 (prefix collided with existing main
-- migrations 116-122). Schema unchanged.

CREATE TABLE IF NOT EXISTS portfolio_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  period TEXT,                             -- e.g. '2026-06'
  title TEXT NOT NULL,
  body TEXT,
  kpis_json TEXT,                          -- { arr, mrr, burn, runway_months, headcount, cash }
  status TEXT NOT NULL DEFAULT 'submitted', -- draft | submitted
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pupdates_project ON portfolio_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_pupdates_status  ON portfolio_updates(status);
