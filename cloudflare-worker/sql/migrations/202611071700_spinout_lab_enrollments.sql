-- D4657 (#4657): a Lab enrollment is a recorded fact, and a milestone carries
-- the saved work that proves it.
--
-- spinout_lab_enrollments. Until now "is this founder in the Lab, and in which
-- cohort" was read from three loose columns: `users.spinout_lab_active`,
-- `users.spinout_lab_started_at` (whose month picked the cycle) and
-- `user_spinout_flags.spinout_lab_admitted`. A founder could switch the first
-- one on with POST /start without ever being admitted, and the cycle was
-- whichever one their start instant happened to fall in. One row here per
-- founder per cycle now says it:
--   kind 'cohort': written when the cycle activation admits an approved
--     applicant; `cohort_cycle_id` is the cycle the applicant was assigned.
--   kind 'legacy': a founder already in the Lab before this migration who has
--     no activated cohort application (an earlier self-start, or an admission
--     from before the cohort system). Kept explicitly, never inferred again.
-- `cycle_source` says how the cycle was known: 'assigned' (the activated
-- applicant's cycle) or 'inferred_start' (a legacy founder whose start instant
-- falls inside a cycle, which is how the calendar gate found their cycle
-- before; keeping it keeps their weeks and deadlines exactly as they were).
-- `project_id` is filled by #4659 (the enrolled venture); nothing reads it yet.
--
-- spinout_lab_milestones gains where each milestone came from:
--   evidence_kind      what the server checked ('saved_work', 'paid_order',
--                      'attested' for the two share/summary steps whose
--                      prerequisite work was checked, 'legacy' for rows from
--                      before this migration).
--   evidence_ref       the saved row that proved it, as `<table>:<id>`, or the
--                      count it met (`discovery_interviews:project:12:n=3`).
--   evidence_project_id the founder-owned project that holds that row.
--   enrollment_id      the enrollment it was recorded under.
--   recorded_by        'member' | 'advisor' | 'order' | 'ein' | 'reconcile'.
-- Every pre-existing row is marked 'legacy' so the reconciler never pays or
-- re-derives it; the existing D541 backfill still governs those.
--
-- spinout_lab_reconcile_cursor. The cron's bounded walk over enrolled founders
-- (one row, the last user id walked).
--
-- Additive only: no column is dropped, no row deleted, nothing renamed.

CREATE TABLE IF NOT EXISTS spinout_lab_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cohort', 'legacy')),
  cohort_cycle_id INTEGER,
  cycle_source TEXT CHECK (cycle_source IS NULL OR cycle_source IN ('assigned', 'inferred_start')),
  cohort_applicant_id INTEGER,
  application_id INTEGER,
  project_id INTEGER,
  started_at TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_spinout_lab_enrollments_user_cycle
  ON spinout_lab_enrollments (user_id, IFNULL(cohort_cycle_id, 0));
CREATE INDEX IF NOT EXISTS idx_spinout_lab_enrollments_cycle
  ON spinout_lab_enrollments (cohort_cycle_id) WHERE cohort_cycle_id IS NOT NULL;

ALTER TABLE spinout_lab_milestones ADD COLUMN evidence_kind TEXT;
ALTER TABLE spinout_lab_milestones ADD COLUMN evidence_ref TEXT;
ALTER TABLE spinout_lab_milestones ADD COLUMN evidence_project_id INTEGER;
ALTER TABLE spinout_lab_milestones ADD COLUMN enrollment_id INTEGER;
ALTER TABLE spinout_lab_milestones ADD COLUMN recorded_by TEXT;

UPDATE spinout_lab_milestones SET evidence_kind = 'legacy' WHERE evidence_kind IS NULL;

CREATE TABLE IF NOT EXISTS spinout_lab_reconcile_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  after_user_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO spinout_lab_reconcile_cursor (id, after_user_id) VALUES (1, 0);

-- Cohort enrollments: every applicant the cycle activation admitted.
INSERT OR IGNORE INTO spinout_lab_enrollments
  (user_id, kind, cohort_cycle_id, cycle_source, cohort_applicant_id, application_id, started_at)
SELECT ca.user_id, 'cohort', ca.cohort_cycle_id, 'assigned', ca.id, ca.application_id, cc.start_at
  FROM cohort_applicants ca JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
 WHERE ca.status = 'activated';

-- Legacy enrollments: anyone in, or once in, the Lab with no cohort
-- enrollment. Their cycle is the one their start instant falls in, if any,
-- because that is the cycle the calendar gate has been applying to them.
INSERT OR IGNORE INTO spinout_lab_enrollments
  (user_id, kind, cohort_cycle_id, cycle_source, started_at)
SELECT u.id, 'legacy',
       (SELECT cc.id FROM cohort_cycles cc
         WHERE u.spinout_lab_started_at IS NOT NULL
           AND cc.start_at <= u.spinout_lab_started_at AND cc.end_at > u.spinout_lab_started_at
         ORDER BY cc.id DESC LIMIT 1),
       CASE WHEN EXISTS (SELECT 1 FROM cohort_cycles cc
                          WHERE u.spinout_lab_started_at IS NOT NULL
                            AND cc.start_at <= u.spinout_lab_started_at AND cc.end_at > u.spinout_lab_started_at)
            THEN 'inferred_start' END,
       u.spinout_lab_started_at
  FROM users u
 WHERE (u.spinout_lab_active = 1
        OR u.spinout_lab_started_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM spinout_lab_milestones m WHERE m.user_id = u.id)
        OR EXISTS (SELECT 1 FROM user_spinout_flags f WHERE f.user_id = u.id AND f.spinout_lab_admitted = 1))
   AND NOT EXISTS (SELECT 1 FROM spinout_lab_enrollments e WHERE e.user_id = u.id);
