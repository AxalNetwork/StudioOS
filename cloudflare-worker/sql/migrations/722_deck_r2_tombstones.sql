-- D1508 (#3759, deck v2 A15): deck images that nothing references leave R2.
--
-- deck_r2_tombstones: one row per R2 object the daily cleanup deleted, so a
--   later reader can tell "deleted on purpose, on this day, this many bytes"
--   from "missing". `reason` says which rule removed it: a discarded image
--   after 24 hours, or a proposal nobody kept after 14 days. Gone with its
--   venture (ON DELETE CASCADE). The key names no person; it is
--   `deck-images/<project>/<uid>.<ext>`.
--
-- deck_images.discarded_at: when Discard was pressed. The 24-hour rule counts
--   from it. A row discarded before this migration has no such time, so it is
--   given this migration's time: it is removed a day after deploy, never at
--   once.
CREATE TABLE IF NOT EXISTS deck_r2_tombstones (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 300),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('discarded', 'unkept_proposal')),
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_r2_tombstones_project ON deck_r2_tombstones (project_id, deleted_at);

ALTER TABLE deck_images ADD COLUMN discarded_at TEXT;
UPDATE deck_images SET discarded_at = datetime('now') WHERE state = 'discarded' AND discarded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deck_images_sweep ON deck_images (state, discarded_at, created_at);
