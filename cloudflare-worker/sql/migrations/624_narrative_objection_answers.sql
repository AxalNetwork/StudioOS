-- D913 (#2697), the owner's option A: which section answers an objection.
--
-- One row per objection investors raised (the key is objections.ts's
-- 16-hex hash of its normalised words, so it survives a deleted feedback row).
-- It names the saved version and the section whose words answer it, and how it
-- was set: `eadwyn` when the founder accepted an "Answer it" draft into that
-- section and saved the version, `picked` when they chose the section by hand.
-- A new answer replaces the old one; "Not answered" deletes the row.
CREATE TABLE IF NOT EXISTS narrative_objection_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objection_key TEXT NOT NULL CHECK (length(objection_key) = 16),
  version       INTEGER NOT NULL CHECK (version >= 1),
  section_key   TEXT NOT NULL,
  how           TEXT NOT NULL CHECK (how IN ('eadwyn', 'picked')),
  answered_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  answered_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, objection_key)
);
