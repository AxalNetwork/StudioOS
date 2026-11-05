-- D4472 (#4472): additional licences only. No primary-role backfill.
CREATE TABLE account_licences (
  user_id INTEGER NOT NULL REFERENCES users(id),
  licence TEXT NOT NULL CHECK (licence IN ('founder','investor','advisor','partner')),
  source TEXT NOT NULL,
  granted_by INTEGER,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  revoked_by INTEGER,
  PRIMARY KEY (user_id, licence)
);
CREATE TABLE account_licence_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  licence TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant','revoke')),
  actor_id INTEGER,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_account_licence_events_user ON account_licence_events(user_id);
