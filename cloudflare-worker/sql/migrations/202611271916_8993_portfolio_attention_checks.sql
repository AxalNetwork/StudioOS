-- D8993 (#8993): the daily portfolio check's ledger. One row per company,
-- holder, reason and piece of evidence, so a second run the same day, or any
-- later day that finds the same evidence, never raises the notice again.
--   reason 'missed_report': evidence_key is the period whose report is overdue ('2026-Q3').
--   reason 'short_runway':  evidence_key is the uid of the founder update that reported it.
-- `checked_on` is the UTC day of the run that raised it.
CREATE TABLE IF NOT EXISTS portfolio_attention_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('missed_report', 'short_runway')),
  evidence_key TEXT NOT NULL,
  checked_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, user_id, reason, evidence_key)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_attention_checks_user
  ON portfolio_attention_checks(user_id, created_at DESC);
