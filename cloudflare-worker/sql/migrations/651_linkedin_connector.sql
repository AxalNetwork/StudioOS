-- 651 — LinkedIn's connector infrastructure (D1350, #3565, part 1 of #3564).
-- The number is the issue's.
--
-- Grep first (D689 D-t): none of these four tables exists in
-- schema_baseline.sql or any migration. What was reused instead of added,
-- and why (D1350 §2):
--   · `network_connections` stays the member's own book; `contact_sources`
--     points at its rows rather than copying contacts anywhere.
--   · `users.linkedin_*` stays, read-only, for Refer & Earn's badge; the
--     identity is copied below, not moved.
--   · `data_imports` is the spreadsheet importer: it counts against the
--     member's monthly import quota and keeps one success and one failure
--     count, with no uid. A LinkedIn import is not a spreadsheet import, and
--     its job needs created, matched and skipped counts, so it is its own
--     table.
--   · `integration_logs` needs an `integrations` row; a LinkedIn sign-in is
--     not one. `admin_audit_log` is staff actions. So the member's own
--     connector events get `integration_audit_log`.
--
-- NOTHING HERE HOLDS A TOKEN. `token_enc` is null while LinkedIn is only
-- OpenID Connect sign-in (the access token is still thrown away after
-- userinfo); part 5 fills it, encrypted, only if LinkedIn approves the API.
-- The audit log never holds a token or a contact's email.

CREATE TABLE IF NOT EXISTS linkedin_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  linkedin_sub TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  token_enc TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  disconnected_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma', 'csv')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  rows_total INTEGER NOT NULL DEFAULT 0 CHECK (rows_total >= 0),
  rows_created INTEGER NOT NULL DEFAULT 0 CHECK (rows_created >= 0),
  rows_matched INTEGER NOT NULL DEFAULT 0 CHECK (rows_matched >= 0),
  rows_skipped INTEGER NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0),
  rows_errors INTEGER NOT NULL DEFAULT 0 CHECK (rows_errors >= 0),
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contact_import_jobs_owner ON contact_import_jobs(owner_user_id, started_at);

-- Which contact row came from which source and job. `created_row` = 1 when
-- that source made the row; 0 when it matched a row that was already there.
-- Disconnect's `delete_imported` deletes only rows a LinkedIn source made
-- and no other source has touched.
CREATE TABLE IF NOT EXISTS contact_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_table TEXT NOT NULL CHECK (contact_table IN ('network_connections')),
  contact_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('linkedin_csv', 'linkedin_api', 'linkedin_dma', 'csv', 'typed')),
  job_id INTEGER REFERENCES contact_import_jobs(id) ON DELETE SET NULL,
  source_ref TEXT,
  created_row INTEGER NOT NULL DEFAULT 0 CHECK (created_row IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contact_table, contact_id, source, job_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_sources_owner ON contact_sources(owner_user_id, contact_table, contact_id);

CREATE TABLE IF NOT EXISTS integration_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('connect', 'disconnect', 'import', 'delete', 'share', 'access')),
  subject TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_integration_audit_owner ON integration_audit_log(owner_user_id, created_at);

-- The identity already on `users` (one production row), copied once. The
-- user columns stay for the Refer & Earn badge.
INSERT OR IGNORE INTO linkedin_connections (user_id, linkedin_sub, scopes, status, connected_at)
  SELECT id, linkedin_sub, 'openid profile email', 'active', COALESCE(linkedin_connected_at, datetime('now'))
  FROM users WHERE linkedin_sub IS NOT NULL AND TRIM(linkedin_sub) <> '';
