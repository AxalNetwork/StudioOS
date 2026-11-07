-- D4643 (#4643, Learning audit 1/5) — an exam attempt keeps the rules it started under.
--
-- The pass mark, the time limit and the reveal policy are copied onto the
-- attempt when it starts. The deadline, the grade and what a submitted attempt
-- reveals are read from the attempt from now on, so an author's later edit to
-- the exam applies to new attempts only and never changes an attempt already
-- open or already graded.
--
-- NULL ON EVERY EARLIER ROW, and read as "the exam's current value", which is
-- what those attempts were always read with. No row is rewritten: a submitted
-- attempt already stores its score and `passed`, which do not change.
--
-- Nullable columns only: no backfill, no rebuild, safe to apply ahead of the
-- Worker that reads them (an older Worker ignores them).

ALTER TABLE learning_exam_attempts ADD COLUMN pass_mark_percent INTEGER
  CHECK (pass_mark_percent IS NULL OR pass_mark_percent BETWEEN 0 AND 100);
ALTER TABLE learning_exam_attempts ADD COLUMN time_limit_minutes INTEGER
  CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0);
ALTER TABLE learning_exam_attempts ADD COLUMN reveal TEXT
  CHECK (reveal IS NULL OR reveal IN ('score', 'score_and_answers'));

-- One open attempt per member and exam is enforced by the start route's single
-- conditional INSERT (it inserts only when none is open). This index serves that
-- check and the resume read.
CREATE INDEX IF NOT EXISTS idx_learning_attempts_open
  ON learning_exam_attempts(exam_id, user_id) WHERE submitted_at IS NULL;
