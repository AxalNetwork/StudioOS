-- 736 — D1559 (#3806, deck builder v2 C11): the founder's kept answers to the
-- likely investor questions. Number given on #3806 by S1.
--
-- One row per likely question a venture kept an answer for. The question key
-- is `objection-<16 hex>` (the objection's own key, `objections.ts`, so it
-- survives a deleted feedback row) or `finding-<16 hex>` (a hash of what the
-- critic's rule finding is about, `services/decks/deckQa.ts`). A new answer
-- replaces the old one; "Not kept" deletes the row.
--
--   bindings_json  [{ source_key, record_ref, as_of, grade, snapshot_hash,
--                     label, value, of, unit, source }]: D896's binding keys and
--                  the value the record held when the answer was kept, so a
--                  later read says each binding is fresh, stale or gone. At
--                  least one: an answer is its bindings.
--   note           the founder's own words, at most 600 characters. The write
--                  refuses a note that states a figure no kept binding carries.
--   deck_id, version  the deck version the answer was kept on.
--
-- Written by `cycle_raise.ts` (`PUT`/`DELETE /narrative/questions/:question/answer`),
-- read by `routes/deck_qa.ts`. The founder's alone.
--
-- Additive: CREATE TABLE IF NOT EXISTS. Idempotent.

CREATE TABLE IF NOT EXISTS deck_qa_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question_key  TEXT NOT NULL CHECK (question_key GLOB 'objection-[0-9a-f]*' OR question_key GLOB 'finding-[0-9a-f]*'),
  deck_id       INTEGER REFERENCES pitch_decks(id) ON DELETE SET NULL,
  version       INTEGER CHECK (version IS NULL OR version >= 1),
  bindings_json TEXT NOT NULL CHECK (json_valid(bindings_json) AND json_type(bindings_json) = 'array' AND json_array_length(bindings_json) >= 1),
  note          TEXT CHECK (note IS NULL OR length(note) <= 600),
  kept_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kept_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, question_key)
);
