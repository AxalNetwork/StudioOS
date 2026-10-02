-- Private roster notes belong to the signed-in advisor, not to the shared
-- booking, a project brief, or a deliverable sent to the client. One note per
-- advisor/client pair; no historical notes are inferred or backfilled.
CREATE TABLE IF NOT EXISTS advisor_client_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_user_id INTEGER NOT NULL REFERENCES users(id),
  client_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (advisor_user_id, client_user_id)
);
