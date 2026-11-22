-- D6209: private settings for each member and Portfolio table.
CREATE TABLE IF NOT EXISTS portfolio_saved_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page TEXT NOT NULL CHECK (page IN ('overview','positions')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json) AND length(spec_json) <= 10000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version)='integer' AND version >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolio_saved_views_owner ON portfolio_saved_views(owner_user_id,page);
