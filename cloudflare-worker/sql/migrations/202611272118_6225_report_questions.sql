-- D6225 (#6225): an investor's questions about a sent report, and the
-- founders' answers (owner answer A, 2026-11-27; canvas D6096, GRQ22–GRQ27).
--
-- One row per question. A question belongs to the revision it was asked on
-- (`update_id`, a `portfolio_updates` row of kind 'report'), to the investor
-- who asked it, and carries at most one answer from one of the venture's
-- founders. The questions of one investor on one report are that investor's
-- thread: private to them and the founder team (routes/report_questions.ts).
--
--   read_at       the founders' first read of the question (Unread → Open)
--   withdrawn_at  the asker withdrew it before an answer
--   answer_*      the one reply; never edited (the trigger below)
--
-- Expand only: a new table, its index and a trigger.
CREATE TABLE IF NOT EXISTS report_questions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  update_id           INTEGER NOT NULL REFERENCES portfolio_updates(id),
  project_id          INTEGER NOT NULL REFERENCES projects(id),
  asker_user_id       INTEGER NOT NULL REFERENCES users(id),
  figure_key          TEXT CHECK (figure_key IS NULL OR length(figure_key) BETWEEN 1 AND 64),
  body                TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 600),
  read_at             TEXT,
  withdrawn_at        TEXT,
  answer_body         TEXT CHECK (answer_body IS NULL OR length(trim(answer_body)) BETWEEN 1 AND 1200),
  answered_by_user_id INTEGER REFERENCES users(id),
  answered_at         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((answer_body IS NULL) = (answered_at IS NULL) AND (answer_body IS NULL) = (answered_by_user_id IS NULL)),
  CHECK (withdrawn_at IS NULL OR answered_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_report_questions_report ON report_questions (update_id, asker_user_id, id);

CREATE TRIGGER IF NOT EXISTS trg_report_questions_answer_final
BEFORE UPDATE OF answer_body, answered_by_user_id, answered_at ON report_questions
WHEN OLD.answered_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'report_questions.answer_body: an answer is never edited');
END;
