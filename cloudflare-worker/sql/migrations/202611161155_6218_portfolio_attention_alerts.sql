-- D6218 (#6218): one row per holder per company per change into Attention, so a
-- recompute that writes the same snapshot again, or a later recompute that finds
-- the company still red, never raises the notice a second time.
-- `changed_on` is the snapshot_date of the first red snapshot after a non-red one.
CREATE TABLE IF NOT EXISTS portfolio_attention_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  changed_on TEXT NOT NULL,
  snapshot_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, user_id, changed_on)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_attention_alerts_user
  ON portfolio_attention_alerts(user_id, created_at DESC);
