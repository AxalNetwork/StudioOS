-- D6252. A GP's accepted brief is a note alongside the fund record.
CREATE TABLE IF NOT EXISTS fund_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id) ON DELETE CASCADE,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fund_notes_fund_id ON fund_notes(fund_id, id DESC);
