-- D6869 (#6869, the build of the #6283 brief): a data-room file in an
-- investor's Library, as a live reference that follows the grant.
--
--   research_room_refs        one Library row that is a reference to a room
--                             file, not a copy: the investor's
--                             `research_documents` row (owned by them, read
--                             only, its `r2_key` the room file's own key and
--                             its size not counted against their storage),
--                             the room (project), the file and the grant it is
--                             tied to, and when it was added. When the grant
--                             no longer reaches the file the row stays, with
--                             `lost_at` and one reason (revoked, expired,
--                             nda_lapsed, removed, moved, library_off), and
--                             its index entries are deleted at once. One live
--                             reference per document, and per investor and
--                             file (the partial unique index below).
--   data_room_library_settings
--                             the founder's per-room switch: whether an
--                             investor they granted may add a file they can
--                             open to their Library. Off by default: a room
--                             with no row is off.
--
-- Grep first (D689 D-t): no `research_room_refs` or
-- `data_room_library_settings` table, and no room provenance column on
-- `research_documents`, exists in schema_baseline.sql or any migration.
--
-- Additive and idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS research_room_refs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id        INTEGER NOT NULL UNIQUE REFERENCES research_documents(id) ON DELETE CASCADE,
  owner_user_id      INTEGER NOT NULL REFERENCES users(id),
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  file_id            INTEGER NOT NULL,
  grant_id           INTEGER NOT NULL,
  added_at           TEXT NOT NULL,
  lost_at            TEXT,
  lost_reason        TEXT CHECK (lost_reason IS NULL OR lost_reason IN ('revoked', 'expired', 'nda_lapsed', 'removed', 'moved', 'library_off')),
  CHECK ((lost_at IS NULL) = (lost_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_research_room_refs_live
  ON research_room_refs (owner_user_id, file_id) WHERE lost_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_research_room_refs_project
  ON research_room_refs (project_id, lost_at);

CREATE TABLE IF NOT EXISTS data_room_library_settings (
  project_id         INTEGER PRIMARY KEY REFERENCES projects(id),
  allow_library      INTEGER NOT NULL DEFAULT 0 CHECK (allow_library IN (0, 1)),
  updated_by         INTEGER REFERENCES users(id),
  updated_at         TEXT NOT NULL
);
