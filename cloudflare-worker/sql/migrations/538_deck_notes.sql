-- 538 / D905 / #2684: notes on a venture's pitch deck, from its admins to its founders.
-- Assigned by S1 on #2684, 2026-10-24. Additive. No BEGIN/COMMIT.
--
-- The owner's answer A to question 6 (#2434): founders write the deck; Admin and
-- Super Admin read it and leave notes; investors and partners see it only through
-- a link. A note is the founder's to read, never an investor's: no share, export
-- or public read selects this table (`routes/deck_notes.ts` is its only reader).
--
--   project_id      the venture whose deck it is (the thread spans its versions).
--   deck_id         the `pitch_decks` row (one version) the note was written on.
--   deck_version    that row's `version`, kept so the thread reads "v4".
--   card_index      the card (0-based) the note is about; NULL is the whole deck.
--   author_user_id  who wrote it.
--   author_kind     what they were when they wrote it: 'admin', 'super_admin' or
--                   'founder' (a later role change does not rewrite the thread).
--   body            the note, at most 2,000 characters.
--
-- Notes are not withdrawn in this part, so there is no `deleted_at`.
CREATE TABLE IF NOT EXISTS deck_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id),
  deck_version INTEGER NOT NULL,
  card_index INTEGER CHECK (card_index IS NULL OR card_index >= 0),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('admin', 'super_admin', 'founder')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deck_notes_project ON deck_notes(project_id, created_at);
