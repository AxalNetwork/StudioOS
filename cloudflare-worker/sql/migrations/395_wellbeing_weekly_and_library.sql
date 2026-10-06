-- 395 — D574 (#1185): the weekly check-in's two missing scores, and the
-- resource library's missing fields.
--
-- THE WEEKLY CHECK-IN. The canvas asks five questions a week: stress, sleep,
-- support, decisions and energy. `wellbeing_daily_pulses` stored stress,
-- sleep and energy (with mood, focus and social, which the page asks under
-- "More") but had no column for support or decisions, so the page drew them
-- as "Not recorded". They are added the same way as the other scores: an
-- encrypted column, and the `*_plain` backstop Task #33 writes when the
-- cipher is unavailable (059). Rows saved before this have neither, which
-- reads as not recorded for that week.
--
-- One check-in per week is a rule in the route, not an index: earlier rows
-- were one per DAY, so a unique index on the week would refuse this
-- migration wherever a member checked in twice in one week. The route finds
-- the week's existing row (Monday to Sunday, UTC) and replaces it.
--
-- THE LIBRARY. A resource was a category, a title, a link and a few flags.
--   kind       the canvas's format: article, audio, video or link. Null on
--              older rows, which read as not recorded.
--   topic      free text, at most 60 characters.
--   status     'draft' or 'published'. Every row before this was listed to
--              members on save, so the default keeps them published. A draft
--              is listed to admins only.
--   edited_at  the last edit. Null means never edited, and the date shown is
--              the day it was added. (A new column, not `updated_at`, which
--              some databases carry from an earlier shape of this table and
--              others do not.)
--   file_key, file_type, file_size
--              an uploaded file in R2, for a resource that is a file rather
--              than a link. Written by the upload route (D574 part 4); null
--              for every link.

ALTER TABLE wellbeing_daily_pulses ADD COLUMN support_enc TEXT;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN decisions_enc TEXT;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN support_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN decisions_plain INTEGER;

ALTER TABLE wellbeing_resources ADD COLUMN kind TEXT;
ALTER TABLE wellbeing_resources ADD COLUMN topic TEXT;
ALTER TABLE wellbeing_resources ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE wellbeing_resources ADD COLUMN edited_at TEXT;
ALTER TABLE wellbeing_resources ADD COLUMN file_key TEXT;
ALTER TABLE wellbeing_resources ADD COLUMN file_type TEXT;
ALTER TABLE wellbeing_resources ADD COLUMN file_size INTEGER;
