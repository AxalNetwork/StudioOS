-- D6073 (#6073): the data room's 30-day Trash (owner answer 8 of D1101, drawn as DR28 in D6071).
--
-- Remove no longer deletes a file: it stamps `removed_at`, and every read an
-- investor, an advisor or a count makes leaves a stamped row out at once. The
-- row keeps its folder, gate (visibility, tier, end date), checklist match,
-- request match and every `data_room_file_versions` row, so Restore is one
-- UPDATE that clears the stamp. Thirty days after `removed_at` the daily trash
-- sweep (04:30 UTC, beside the venture trash) deletes the row, its versions and
-- every stored object; Delete now does the same at once, for the owner only.
--
-- A column, not a second table: a file moved out of `data_room_files` would
-- take its versions (ON DELETE CASCADE), its access-log links (SET NULL), its
-- search passages and its deck values with it, and Restore could not bring
-- them back.
--
--   removed_at          ISO time of the Remove; NULL for a file in the room.
--   removed_by_user_id  who removed it; NULL when the account is gone.
--   removed_folder_name the folder's name at the Remove, so Trash can say
--                       "returns to Top level" when that folder was deleted
--                       while the file waited (folder_id is then NULL, or names
--                       a folder that no longer exists).
--
-- Grep first (D689 D-t): no removed_at, removed_by_user_id or
-- removed_folder_name column exists on `data_room_files` in an earlier
-- migration or in schema_baseline.sql. Additive; no transaction statements.

ALTER TABLE data_room_files ADD COLUMN removed_at TEXT;
ALTER TABLE data_room_files ADD COLUMN removed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE data_room_files ADD COLUMN removed_folder_name TEXT;

CREATE INDEX IF NOT EXISTS idx_dr_files_removed ON data_room_files (removed_at) WHERE removed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dr_files_project_removed ON data_room_files (project_id, removed_at);
