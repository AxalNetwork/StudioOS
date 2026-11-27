-- D5356 part 2 (#5356): an open exam attempt's choices are held on the server, so a learner who changes device,
-- clears the browser or uses private mode mid-attempt keeps them (the owner's answer B, 2026-11-10).
--
--   draft_answers_json  {question_uid: [option indexes]}, validated against the attempt's own questions; never graded,
--                       never revealed, and separate from answers_json (the submitted answers)
--   draft_revision      the client's revision of the last accepted save; a save carrying a revision not above it is
--                       refused 409, so a delayed request cannot overwrite a newer one
--   draft_saved_at      when the last save was accepted
--
-- Additive. Rows before this migration read as "nothing saved on the server".
ALTER TABLE learning_exam_attempts ADD COLUMN draft_answers_json TEXT;
ALTER TABLE learning_exam_attempts ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0 CHECK (draft_revision >= 0);
ALTER TABLE learning_exam_attempts ADD COLUMN draft_saved_at TEXT;
