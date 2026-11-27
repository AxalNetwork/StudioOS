-- D4650 (#4650, part 3) — an exam question can explain its answer and point
-- to revision material.
--
--   explanation    up to 1,000 characters: why the right answer is right.
--   revision_json  JSON array of up to 5 {title, url}: an https link, or a path
--                  inside Learning (/learning/...), whose own page still decides
--                  who may open it. '[]' is "none".
--
-- A member sees both only where they already see the correct answers: on a
-- submitted attempt whose own reveal policy is score_and_answers (D4643).
-- Unlike the prompt, options and answer, they are not frozen by the first
-- attempt: they do not change how an attempt is graded.
--
-- Nullable or defaulted columns only: no backfill, safe ahead of the Worker.

ALTER TABLE learning_exam_questions ADD COLUMN explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 1000);
ALTER TABLE learning_exam_questions ADD COLUMN revision_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(revision_json) AND json_type(revision_json) = 'array');
