-- 594 — a data-room grant's folder scope (D1103, #2983).
-- Reserved for D1103 on #2983 (part 2 of Data room, #2456), 2026-10-25.
--
-- A grant opens the whole room today. The owner's question 1 (answer A) lets
-- a grant open only named folders: one row per folder the grant may open.
--
--   A GRANT SAYS WHETHER IT IS SCOPED. `data_room_grants.folders_scoped` is
--   0 for "All folders", which every grant written before this migration is,
--   so nothing changes for one. When it is 1 the grant opens only the folders
--   its rows name. The flag is what keeps a scope from widening: when a named
--   folder is deleted its row goes with it (ON DELETE CASCADE where foreign
--   keys run, and the folder delete route removes it by hand where they do
--   not), and a scoped grant left with no rows opens nothing, never the whole
--   room. "No rows means every folder" holds only for an unscoped grant.
--
-- A named folder opens its subfolders too: `dataRoomAccess.grantFolderScope`
-- walks the tree inside the grant's own project. A file at the top level of
-- the room sits in no folder, so a scoped grant does not open it.
--
-- `tierAdmits` reads the scope, so `/shared`, `research.ts`, the advisor brief
-- and the founder's preview keep one predicate.
--
-- Grep first (D689 D-t): no `data_room_grant_folders` table exists in any
-- earlier migration or the baseline.
CREATE TABLE IF NOT EXISTS data_room_grant_folders (
  grant_id   INTEGER NOT NULL REFERENCES data_room_grants(id) ON DELETE CASCADE,
  folder_id  INTEGER NOT NULL REFERENCES data_room_folders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (grant_id, folder_id)
);
CREATE INDEX IF NOT EXISTS idx_dr_grant_folders_folder ON data_room_grant_folders(folder_id);

ALTER TABLE data_room_grants ADD COLUMN folders_scoped INTEGER NOT NULL DEFAULT 0 CHECK (folders_scoped IN (0, 1));
