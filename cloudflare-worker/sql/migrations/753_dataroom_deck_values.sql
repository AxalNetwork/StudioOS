-- D1602 (#3881). Opt-in, version-bound document figures; no inferred backfill.
ALTER TABLE data_room_files ADD COLUMN deck_source INTEGER NOT NULL DEFAULT 0 CHECK (deck_source IN (0,1));
ALTER TABLE data_room_files ADD COLUMN deck_source_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE data_room_files ADD COLUMN deck_source_token TEXT;
ALTER TABLE data_room_files ADD COLUMN deck_extract_state TEXT CHECK (deck_extract_state IN ('queued','done','no_values','unreadable'));
ALTER TABLE data_room_files ADD COLUMN deck_extract_started_at TEXT;
ALTER TABLE data_room_files ADD COLUMN deck_source_as_of TEXT;
ALTER TABLE data_room_files ADD COLUMN deck_source_user_id INTEGER REFERENCES users(id);
ALTER TABLE data_room_files ADD COLUMN deck_source_quote TEXT;

CREATE TABLE IF NOT EXISTS dataroom_deck_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_uid TEXT NOT NULL REFERENCES data_room_files(uid) ON DELETE CASCADE,
  file_version INTEGER NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('dataroom.revenue_plan','dataroom.headcount_plan','dataroom.contract_count')),
  value REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('usd','count')),
  page INTEGER,
  as_of TEXT NOT NULL,
  extracted_by TEXT NOT NULL CHECK (extracted_by IN ('code','typed_job')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (file_uid, slot)
);
CREATE INDEX IF NOT EXISTS idx_dataroom_deck_values_project ON dataroom_deck_values (project_id);
