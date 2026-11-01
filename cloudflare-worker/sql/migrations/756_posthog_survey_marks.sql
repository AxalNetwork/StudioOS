-- 756 — PostHog part 3: which survey question means what (D1605, #3731, #2409).
--
-- One new table, no change to an existing one. A survey answer becomes a
-- proposal only for a question the founder marked: "would pay" or "need to
-- have" for Validate's demand signals, "feedback" for Grow's Product
-- improvement (part 6). What a question means is the founder's choice, never
-- guessed from its words. The row goes with its connection (`integration_id`
-- cascades). No answer, and nothing about a respondent, is kept here.
CREATE TABLE IF NOT EXISTS posthog_survey_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  survey_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_index INTEGER NOT NULL DEFAULT 0,
  mark TEXT NOT NULL CHECK (mark IN ('would_pay', 'need_to_have', 'feedback')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, survey_id, question_id)
);
