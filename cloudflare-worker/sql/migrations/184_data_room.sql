-- 184 — the data room as an object.
--
-- Before this, "data room" meant two unrelated things and neither was a room:
--
--   * `projects.data_room_url` — a free-text external link. The platform never
--     saw the contents, could not say who opened it, and could not withdraw
--     access once the link was out.
--   * `GET /api/deals/:id/data-room` — a zip of document TEXT assembled on the
--     fly for one deal. No folders, no per-file visibility, no per-investor
--     anything.
--
-- Four tables, and deliberately no fifth:
--
--   data_room_folders   a tree per project (parent_id NULL = root)
--   data_room_files     one row per object in R2, with its own visibility
--   data_room_grants    which investor may open which project's room
--   data_room_access_log who opened or downloaded what, and when
--
-- Visibility is two values, not three. `open` means any investor holding a
-- grant can see it; `nda` means the grant is not enough — an ACTIVE row must
-- also exist in `pairwise_ndas` between the granting founder and that
-- investor. Reusing `pairwise_ndas` rather than inventing a second NDA notion
-- is the whole reason this fits in one migration: the signing rail, the
-- envelope and the expiry already exist in `esign.ts` and migration 025.
--
-- The access log is its own table rather than a query over `activity_logs`.
-- `files.ts` already audits every signed download into `activity_logs`, but
-- that is a generic sink keyed by a JSON blob — a founder asking "which files
-- has this investor opened" cannot be served from it in SQLite without
-- scanning and parsing `details`. This table answers that question with an
-- index.
--
-- What is NOT here, on purpose:
--
--   * No watermark column. The canvas asks for watermarked downloads; the
--     worker has no PDF pipeline, and a column recording a watermark nothing
--     applies would be worse than the honest absence. Downloads are instead
--     per-investor, single-use, short-TTL and logged — which is what the UI
--     says they are.
--   * No `size_bytes` default. An unknown size reads as NULL, not 0.
--
-- This lands AHEAD of its route: `routes/data_room.ts` does not exist yet, so
-- after the next deploy these four tables are empty and nothing reads them.
-- That is deliberate and inert — the schema has to exist before a handler can
-- query it — not a half-applied migration.

CREATE TABLE IF NOT EXISTS data_room_folders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id          INTEGER REFERENCES data_room_folders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  visibility         TEXT NOT NULL DEFAULT 'open',   -- open | nda
  display_order      INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dr_folders_project ON data_room_folders(project_id, display_order);
CREATE INDEX IF NOT EXISTS idx_dr_folders_parent  ON data_room_folders(parent_id);

CREATE TABLE IF NOT EXISTS data_room_files (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_id           INTEGER REFERENCES data_room_folders(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  r2_key              TEXT NOT NULL,
  content_type        TEXT,
  size_bytes          INTEGER,
  visibility          TEXT NOT NULL DEFAULT 'open',  -- open | nda
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dr_files_project ON data_room_files(project_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_dr_files_folder  ON data_room_files(folder_id);

CREATE TABLE IF NOT EXISTS data_room_grants (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  investor_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The founder who opened the door. Also the NDA counterparty: migration 025
  -- fixes `pairwise_ndas.party_a_user_id` as the founder, so the gate is a
  -- lookup on (granted_by_user_id, investor_user_id) with no join through
  -- projects → founders → users.
  granted_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  expires_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, investor_user_id)
);
CREATE INDEX IF NOT EXISTS idx_dr_grants_investor ON data_room_grants(investor_user_id, status);
CREATE INDEX IF NOT EXISTS idx_dr_grants_project  ON data_room_grants(project_id, status);

CREATE TABLE IF NOT EXISTS data_room_access_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id    INTEGER REFERENCES data_room_files(id) ON DELETE SET NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,   -- open_room | download
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dr_log_project ON data_room_access_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_log_user    ON data_room_access_log(user_id, created_at DESC);
