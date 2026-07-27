-- Task #7 — Spin-Out Lab cohort admission.
-- `spinout_lab_admitted`: flipped by the admin admit action; gates the
--   congratulations screen on /spinout-lab for admitted-but-not-started
--   founders. `spinout_lab_cohort`: the cohort label assigned on admit.
-- `registration_product`: persists the ?product= registration intent
--   (e.g. 'spinout-lab') so applicants are identifiable in the admin queue.
ALTER TABLE users ADD COLUMN spinout_lab_admitted INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN spinout_lab_cohort TEXT;
ALTER TABLE users ADD COLUMN registration_product TEXT;
