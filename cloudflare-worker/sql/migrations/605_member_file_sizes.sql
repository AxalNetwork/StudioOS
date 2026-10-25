-- D1168 (#3081): measured bytes only. NULL is unknown; a missing object is marked.
-- No users column: D1's column limit requires a side table for profile files.
ALTER TABLE demand_signals ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0));
ALTER TABLE demand_signals ADD COLUMN size_missing_at TEXT;
ALTER TABLE formation_steps ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0));
ALTER TABLE formation_steps ADD COLUMN size_missing_at TEXT;
ALTER TABLE entity_obligations ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0));
ALTER TABLE entity_obligations ADD COLUMN size_missing_at TEXT;
ALTER TABLE obligation_occurrences ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0));
ALTER TABLE obligation_occurrences ADD COLUMN size_missing_at TEXT;
ALTER TABLE data_imports ADD COLUMN size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0));
ALTER TABLE data_imports ADD COLUMN size_missing_at TEXT;

CREATE TABLE IF NOT EXISTS member_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('headshot', 'brand_logo')),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR (typeof(size_bytes) = 'integer' AND size_bytes >= 0)),
  size_missing_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (size_missing_at IS NULL OR size_bytes IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_member_files_owner ON member_files(owner_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_member_files_pending ON member_files(id) WHERE size_bytes IS NULL AND size_missing_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_demand_signals_size_pending ON demand_signals(id) WHERE evidence_file_key IS NOT NULL AND size_bytes IS NULL AND size_missing_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_formation_steps_size_pending ON formation_steps(id) WHERE proof_file_key IS NOT NULL AND size_bytes IS NULL AND size_missing_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_obligations_size_pending ON entity_obligations(id) WHERE proof_file_key IS NOT NULL AND size_bytes IS NULL AND size_missing_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_obligation_occurrences_size_pending ON obligation_occurrences(id) WHERE minutes_file_key IS NOT NULL AND size_bytes IS NULL AND size_missing_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_data_imports_size_pending ON data_imports(id) WHERE raw_file_r2_key IS NOT NULL AND size_bytes IS NULL AND size_missing_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_headshot_backfill ON users(id) WHERE headshot_r2_key IS NOT NULL AND headshot_r2_key <> '';
CREATE INDEX IF NOT EXISTS idx_landing_logo_backfill ON landing_pages(id) WHERE logo_asset_id GLOB 'brand-logos/*' OR logo_dark_asset_id GLOB 'brand-logos/*';

-- Durable R2 discovery cursor; row sizes/missing marks are their own checkpoints.
CREATE TABLE IF NOT EXISTS member_file_size_backfill_state (
  uid TEXT NOT NULL PRIMARY KEY,
  phase TEXT NOT NULL CHECK (phase IN ('headshot_rows', 'logo_rows', 'headshots', 'brand_logos', 'done')),
  r2_cursor TEXT,
  row_cursor INTEGER NOT NULL DEFAULT 0 CHECK (row_cursor >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO member_file_size_backfill_state(uid, phase) VALUES ('member-files-v1', 'headshot_rows');
