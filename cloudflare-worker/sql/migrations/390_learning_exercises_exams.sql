-- 390 — Learning: exercises and exams (D559, #1160), graded on the server.
--
-- NO ANSWER LEAKS. `learning_exam_questions.correct_json` is read by the
-- grader and by the Super Admin's authoring routes only. Nothing a member is
-- served carries it, or anything derived from it, until their attempt is
-- submitted AND the exam's `reveal` is 'score_and_answers'.
--
-- AN ATTEMPT IS A RECORD. Every attempt started counts against
-- `max_attempts`, whether it was submitted in time, timed out or abandoned,
-- and the questions it was shown are stored in the order it was shown them,
-- so a later edit to the exam cannot re-grade it. Questions cannot be changed
-- once an exam has an attempt (the route refuses).
--
-- RESUBMITTING KEEPS EARLIER ATTEMPTS (canvas D566). An exercise submission is
-- a new row each time; the newest is the member's current answer.

CREATE TABLE IF NOT EXISTS learning_exercises (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  instructions    TEXT,
  submission_kind TEXT NOT NULL CHECK (submission_kind IN ('text', 'checklist')),
  -- The checklist's items, a JSON array of strings; null for a text exercise.
  checklist_json  TEXT,
  visibility      TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'program')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by      INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  published_at    TEXT
);

CREATE TABLE IF NOT EXISTS learning_exercise_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE,
  exercise_id  INTEGER NOT NULL REFERENCES learning_exercises(id),
  user_id      INTEGER NOT NULL,
  -- The answer: the text, or for a checklist a JSON array of checked item indexes.
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'needs_work')),
  reviewer_id  INTEGER,
  feedback     TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_submissions_exercise ON learning_exercise_submissions(exercise_id, user_id, id);

CREATE TABLE IF NOT EXISTS learning_exams (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  intro              TEXT,
  pass_mark_percent  INTEGER NOT NULL DEFAULT 70 CHECK (pass_mark_percent BETWEEN 0 AND 100),
  -- Null is untimed; null max_attempts is unlimited.
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  max_attempts       INTEGER CHECK (max_attempts IS NULL OR max_attempts > 0),
  shuffle            INTEGER NOT NULL DEFAULT 0 CHECK (shuffle IN (0, 1)),
  reveal             TEXT NOT NULL DEFAULT 'score' CHECK (reveal IN ('score', 'score_and_answers')),
  visibility         TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'program')),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by         INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  published_at       TEXT
);

CREATE TABLE IF NOT EXISTS learning_exam_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE,
  exam_id      INTEGER NOT NULL REFERENCES learning_exams(id),
  position     INTEGER NOT NULL DEFAULT 0,
  prompt       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('single', 'multiple')),
  -- A JSON array of option strings.
  options_json TEXT NOT NULL,
  -- A JSON array of correct option indexes. Never served to a member before reveal.
  correct_json TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_questions_exam ON learning_exam_questions(exam_id, position);

CREATE TABLE IF NOT EXISTS learning_exam_attempts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  exam_id             INTEGER NOT NULL REFERENCES learning_exams(id),
  user_id             INTEGER NOT NULL,
  started_at          TEXT NOT NULL,
  -- The question uids in the order this attempt was shown them.
  question_order_json TEXT NOT NULL,
  submitted_at        TEXT,
  -- {question_uid: [option indexes]}; null until submitted, and null on a timed-out attempt.
  answers_json        TEXT,
  score_percent       INTEGER CHECK (score_percent IS NULL OR score_percent BETWEEN 0 AND 100),
  passed              INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  timed_out           INTEGER NOT NULL DEFAULT 0 CHECK (timed_out IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_learning_attempts_exam_user ON learning_exam_attempts(exam_id, user_id, id);
