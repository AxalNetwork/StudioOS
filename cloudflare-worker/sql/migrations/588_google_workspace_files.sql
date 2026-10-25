-- D1091 (#2956): files explicitly chosen by a member, and proposals for parts 3–6.
CREATE TABLE IF NOT EXISTS google_workspace_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('doc','sheet','slides','form','file')),
  name TEXT NOT NULL,
  mapping_json TEXT,
  modified_time TEXT,
  last_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','unreadable','stopped')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(integration_id, project_id, module, drive_file_id)
);
CREATE INDEX IF NOT EXISTS idx_google_workspace_files_project ON google_workspace_files(integration_id, project_id);
CREATE TABLE IF NOT EXISTS google_workspace_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')),
  decided_by INTEGER,
  decided_at TEXT,
  UNIQUE(integration_id, project_id, source_key)
);
