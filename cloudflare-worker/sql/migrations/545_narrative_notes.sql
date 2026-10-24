-- 545 / D914 / #2698: the Investor narrative's notes thread, and the reasons
-- an admin gives for reading it.
-- Assigned by S1 on #2698, 2026-10-24. Additive. No BEGIN/COMMIT.
--
-- The owner's answer to #2459 decision 3 for the narrative (2026-10-24): an
-- Admin on this deployment, or the Super Admin on HQ, reads the whole Story
-- read only and leaves notes; every narrative write of theirs is refused; and
-- they give a reason before the narrative opens, which the founder sees.
--
-- The deck's notes (538, `deck_notes`) are keyed to a `pitch_decks` row and a
-- card, so the narrative keeps its own thread.
--
-- narrative_notes: one note from an admin (or the founder's answer) on a
-- venture's narrative. It is the founder's to read, never an investor's: only
-- `routes/cycle_raise.ts` selects it.
--   version         the narrative version the note was written on; NULL is
--                   the narrative as a whole.
--   author_kind     what the author was when they wrote it: 'admin',
--                   'super_admin' or 'founder'.
--   body            the note, at most 2,000 characters.
CREATE TABLE IF NOT EXISTS narrative_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER CHECK (version IS NULL OR version >= 1),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('admin', 'super_admin', 'founder')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_narrative_notes_project ON narrative_notes(project_id, created_at);

-- narrative_read_reasons: one row each time an admin opens a venture's
-- narrative, with the reason they typed. The Worker answers that admin's
-- narrative reads for the venture only while a row of theirs is unexpired
-- (8 hours). The founder reads every row.
--   reader_kind     'admin' or 'super_admin'.
--   reason          what the admin typed, 3 to 200 characters.
--   expires_at      when this opening stops admitting reads.
CREATE TABLE IF NOT EXISTS narrative_read_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  reader_user_id INTEGER NOT NULL REFERENCES users(id),
  reader_kind TEXT NOT NULL CHECK (reader_kind IN ('admin', 'super_admin')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_narrative_read_reasons_reader ON narrative_read_reasons(project_id, reader_user_id, expires_at);
