-- D699: the last cycle a member opened in each of their companies.
CREATE TABLE IF NOT EXISTS user_company_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  cycle TEXT NOT NULL CHECK (cycle IN ('validate', 'build', 'raise', 'grow')),
  opened_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_user_company_visits_user ON user_company_visits(user_id);
