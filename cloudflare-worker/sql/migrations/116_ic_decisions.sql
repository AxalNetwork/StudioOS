-- Feature: Investment Decision / IC record (Commit stage).
-- One per-deal object (memo + terms + votes + decision + outcome) unifying what
-- was scattered across Pipeline votes, Scoring deal-memo, and Watchlist.
-- D1 (SQLite) CREATE ... IF NOT EXISTS is idempotent; safe to re-apply.

CREATE TABLE IF NOT EXISTS ic_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  deal_id INTEGER,
  title TEXT NOT NULL,
  memo TEXT,
  terms_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | voting | decided
  decision TEXT,                          -- invest | pass | defer
  outcome TEXT,                           -- open | vindicated | regret
  created_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ic_project ON ic_decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_ic_status  ON ic_decisions(status);

CREATE TABLE IF NOT EXISTS ic_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ic_decision_id INTEGER NOT NULL REFERENCES ic_decisions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  vote TEXT NOT NULL,                     -- yes | no | abstain
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ic_decision_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ic_votes_decision ON ic_votes(ic_decision_id);
