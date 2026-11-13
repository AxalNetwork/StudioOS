-- D4650 (#4650, part 2) — a course says who it is for, what it teaches, what
-- it assumes, who wrote and reviewed it, and what the learner leaves with.
--
-- Nullable or defaulted columns only: no backfill, no rebuild, and safe to
-- apply ahead of the Worker that reads them (an older Worker ignores them).
-- Every existing course reads "not recorded" for each field until an author
-- fills it; its summary and resources are untouched.
--
--   audience_json       JSON array, a subset of founder, investor, advisor, partner; '[]' is "not recorded".
--   stage               free text, up to 120: the venture stage the course is for.
--   outcomes_json       JSON array of up to 8 sentences: what the learner can do after it.
--   prerequisites_json  JSON array of up to 8 sentences: what the course assumes.
--   author_name         who wrote it, up to 120.
--   reviewer_name       who last reviewed it, up to 120.
--   reviewed_on         the date of that review, YYYY-MM-DD.
--   practical_output    up to 300: the artefact the learner leaves with.
--
-- The route validates every value (services/learningCourseMeta.ts); the
-- CHECKs below hold only the shapes a bad write could otherwise store.

ALTER TABLE learning_courses ADD COLUMN audience_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(audience_json) AND json_type(audience_json) = 'array');
ALTER TABLE learning_courses ADD COLUMN stage TEXT CHECK (stage IS NULL OR length(stage) <= 120);
ALTER TABLE learning_courses ADD COLUMN outcomes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(outcomes_json) AND json_type(outcomes_json) = 'array');
ALTER TABLE learning_courses ADD COLUMN prerequisites_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prerequisites_json) AND json_type(prerequisites_json) = 'array');
ALTER TABLE learning_courses ADD COLUMN author_name TEXT CHECK (author_name IS NULL OR length(author_name) <= 120);
ALTER TABLE learning_courses ADD COLUMN reviewer_name TEXT CHECK (reviewer_name IS NULL OR length(reviewer_name) <= 120);
ALTER TABLE learning_courses ADD COLUMN reviewed_on TEXT CHECK (reviewed_on IS NULL OR reviewed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE learning_courses ADD COLUMN practical_output TEXT CHECK (practical_output IS NULL OR length(practical_output) <= 300);
