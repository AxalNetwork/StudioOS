-- D1508 (#3759, deck v2 A15): deck images that nothing references leave R2.
--
-- deck_r2_tombstones: one row per R2 object the daily cleanup deleted, so a
--   later reader can tell "deleted on purpose, on this day, this many bytes"
--   from "missing". `reason` says which rule removed it: a discarded image
--   after 24 hours, or a proposal nobody kept after 14 days. Gone with its
--   venture (ON DELETE CASCADE). The key names no person; it is
--   `deck-images/<project>/<uid>.<ext>`.
--
-- deck_images_named: the one reference rule, as a view. An image is named
--   when its uid appears in any store of its own venture that can hold a card:
--   a saved version (slides, theme), a card draft, a proposed deck or a
--   derivative. A slide names an image by its file URL or its image_id; both
--   hold the uid. The cleanup reads it before it acts and again inside the
--   statements that remove a row, so a save in between keeps the image.
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

CREATE VIEW IF NOT EXISTS deck_images_named AS
  SELECT i.id AS id FROM deck_images i
   WHERE EXISTS (SELECT 1 FROM pitch_decks d WHERE d.project_id = i.project_id
                   AND (instr(COALESCE(d.slides, ''), i.uid) > 0 OR instr(COALESCE(d.theme_json, ''), i.uid) > 0))
      OR EXISTS (SELECT 1 FROM pitch_deck_cards c JOIN pitch_decks d ON d.id = c.deck_id
                  WHERE d.project_id = i.project_id AND instr(c.json, i.uid) > 0)
      OR EXISTS (SELECT 1 FROM pitch_deck_proposals p WHERE p.project_id = i.project_id AND instr(COALESCE(p.slides, ''), i.uid) > 0)
      OR EXISTS (SELECT 1 FROM deck_derivatives v WHERE v.project_id = i.project_id AND instr(COALESCE(v.slides, ''), i.uid) > 0);
