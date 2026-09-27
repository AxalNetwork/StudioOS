-- 315_spinout_application_lifecycle.sql — the Spin-Out Lab application's
-- answers, its draft, its withdrawal, and the note an applicant is shown
-- (D383, wave 8, Session 10, item 4).
--
-- The Apply & Status canvas draws a five-step application (basics; origin and
-- IP; team; traction; why Axal), a saved draft, a withdraw note, and a
-- declined variant that gives the applicant a specific reason and up to three
-- asks. `spinout_applications` (migration 155) holds only the basics — company
-- name, idea, incorporated, stage, jurisdiction — and is written as `pending`
-- the moment it exists. `cohort_applicants.decision_reason` (migration 157) is
-- REQUIRED on every decision and holds internal and system text ("Legacy admin
-- decision", capacity roll-forwards); it is an admin note and is never shown
-- to an applicant. So:
--
--   spinout_applications.answers_json — steps 2–5 as one JSON object, written
--     at submission. NULL for every application made before this migration:
--     those applicants were never asked, and the page says so.
--   spinout_applications.withdrawn_at — set when the applicant withdraws.
--     The row's `status` becomes 'withdrawn' and its cohort_applicants rows
--     follow, so the capacity job stops counting it. Soft by design:
--     cohort_applicants.application_id has no foreign key, so deleting the
--     row would orphan the pool's history.
--   spinout_applications.applicant_note / applicant_asks_json /
--     applicant_note_at — written by the admin who decides, shown to the
--     applicant, and separate from `decision_reason` so an internal note can
--     never reach them by accident.
--   spinout_application_drafts — one draft per account, never in any queue.
--     A draft is not an application: keeping it out of spinout_applications
--     means no admin list, pool count or "one pending application" guard has
--     to learn to skip it.
--
-- STANDS ALONE and idempotent. Additive ALTERs and CREATE … IF NOT EXISTS only.

ALTER TABLE spinout_applications ADD COLUMN answers_json TEXT;
ALTER TABLE spinout_applications ADD COLUMN withdrawn_at TEXT;
ALTER TABLE spinout_applications ADD COLUMN applicant_note TEXT;
ALTER TABLE spinout_applications ADD COLUMN applicant_asks_json TEXT;
ALTER TABLE spinout_applications ADD COLUMN applicant_note_at TEXT;

CREATE TABLE IF NOT EXISTS spinout_application_drafts (
  user_id INTEGER PRIMARY KEY,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
