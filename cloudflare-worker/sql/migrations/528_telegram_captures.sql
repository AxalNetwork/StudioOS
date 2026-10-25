-- D867 (#2513): private bot forwards, encrypted until member attestation.
-- capture_id is provider-local: every channel_consents lookup also scopes provider.
CREATE TABLE IF NOT EXISTS telegram_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER,
  sender_hash TEXT NOT NULL,
  media_refs_enc TEXT,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 20),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'consented', 'imported')),
  fetch_by TEXT NOT NULL,
  consent_id INTEGER,
  session_id INTEGER,
  import_job TEXT,
  import_error TEXT,
  answered_at TEXT,
  imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_captures_member ON telegram_captures(integration_id, status, id);
CREATE INDEX IF NOT EXISTS idx_telegram_captures_expiry ON telegram_captures(status, fetch_by);
