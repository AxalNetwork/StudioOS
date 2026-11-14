-- D4270 (#4270, D4254 P2c): the founder's written answers to the likely
-- questions, and the questions the founder adds by hand. Named by its UTC
-- minute (D4106).
--
-- #4270 named this store `deck_qa_answers`; that name has held D1559's kept
-- answers since migration 736, whose rows are record bindings (at least one)
-- and a short note. A written answer is the founder's own words with no
-- binding, so it lives here, beside 736, and `GET /api/decks/:id/qa` reads
-- both: a question is answered when either holds an answer.
--
-- One row per question a venture wrote an answer to, or added:
--   question_key   `objection-<16 hex>` or `finding-<16 hex>` (D1559's keys)
--                  for a ranked question; `typed-<16 hex>` for one the
--                  founder added.
--   question_text  the question's words when the row was written: for a
--                  typed question, the founder's own (required); for a
--                  ranked one, a copy, so the answer stays legible if the
--                  question stops being ranked.
--   card_ref       the card it relates to (market, competition, traction…).
--   answer         the founder's words, at most 2,000 characters; NULL for a
--                  typed question not answered yet.
--   source         'ask' when Save kept the draft Ask placed, unchanged;
--                  'typed' otherwise.
--   deck_id, version  the deck version it was written on.
--
-- THE FOUNDER'S ALONE. Written and read only by `routes/deck_qa.ts`. No share,
-- export or public read selects this table, and a test holds that.
--
-- Additive: CREATE TABLE IF NOT EXISTS. Idempotent.

CREATE TABLE IF NOT EXISTS deck_qa_written (
  uid           TEXT    PRIMARY KEY CHECK (length(uid) BETWEEN 8 AND 40),
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deck_id       INTEGER REFERENCES pitch_decks(id) ON DELETE SET NULL,
  version       INTEGER CHECK (version IS NULL OR version >= 1),
  question_key  TEXT    NOT NULL CHECK (question_key GLOB 'objection-[0-9a-f]*' OR question_key GLOB 'finding-[0-9a-f]*' OR question_key GLOB 'typed-[0-9a-f]*'),
  question_text TEXT    CHECK (question_text IS NULL OR length(question_text) BETWEEN 1 AND 400),
  card_ref      TEXT    CHECK (card_ref IS NULL OR length(card_ref) BETWEEN 1 AND 40),
  answer        TEXT    CHECK (answer IS NULL OR length(answer) BETWEEN 1 AND 2000),
  source        TEXT    NOT NULL DEFAULT 'typed' CHECK (source IN ('ask', 'typed')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, question_key),
  CHECK (question_key NOT GLOB 'typed-*' OR question_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_deck_qa_written_project ON deck_qa_written(project_id, created_at);
