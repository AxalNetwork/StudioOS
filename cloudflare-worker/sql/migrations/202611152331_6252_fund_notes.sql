-- #6252 (D6252, owner's Q1 answer A): an accepted fund brief is a fund note. One row per Accept; the fund page
-- reads the newest. The note changes no fund record (vc_funds is untouched); sources_json is the draft's own cited
-- records, as the Worker matched them at Accept.
CREATE TABLE IF NOT EXISTS fund_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'brief' CHECK (kind IN ('brief')),
  body TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_notes_fund_created ON fund_notes (fund_id, kind, created_at);
