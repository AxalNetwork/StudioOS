-- Task #7 — Spin-Out Lab cohort admission.
-- Uses a sidecar table instead of columns on users because users is at D1's
-- 100-column ALTER TABLE limit. Functionally equivalent: all queries join or
-- query user_spinout_flags by user_id.
--   spinout_lab_admitted: flipped by the admin admit action; gates the
--     congratulations screen on /spinout-lab for admitted-but-not-started founders.
--   spinout_lab_cohort: the cohort label assigned on admit.
--   registration_product: persists the ?product= registration intent
--     (e.g. 'spinout-lab') so applicants are identifiable in the admin queue.
CREATE TABLE IF NOT EXISTS user_spinout_flags (
  user_id INTEGER PRIMARY KEY,
  spinout_lab_admitted INTEGER NOT NULL DEFAULT 0,
  spinout_lab_cohort TEXT,
  registration_product TEXT
);
