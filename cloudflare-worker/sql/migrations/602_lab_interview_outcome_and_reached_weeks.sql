-- 602 — Spin-Out Lab metrics (D1123, #3003): an interview's recorded outcome,
-- and the founders who reached each week. Assigned to #3003 by S1 (S21,
-- 2026-10-25, option A).
--
-- D944 refused both of SL1's shares because nothing proved them: a scheduled
-- interview is not a held one, and a week's outcome rows are not the founders
-- who reached it. These stores record the two facts from now on, and say from
-- when, so a read never presents a partial history as a whole one.
--
-- 1. spinout_application_interviews.outcome — 'held' or 'missed', recorded by
--    an admin on the application (POST /api/admin/cohort/applications/:id/
--    interview/outcome) once its time has passed. outcome_at and outcome_by
--    are when and who. NULL is "no outcome recorded", never "missed".
--
-- 2. lab_metric_capture — when each recording began. 'interview_outcome' is
--    stamped here, at apply time. An interview scheduled before it, with no
--    outcome, leaves its cohort's Interviewed count "Not recorded" until an
--    admin records that interview's outcome (held or missed).
--
-- 3. spinout_week_reached — one row per founder per cohort week they reached:
--    in the cohort at that week's deadline with no earlier week failed or in
--    grace (cohortTiming's `decideUserWeek`), or decided for that week by the
--    scheduler or an admin (`applyWeekDecision`). The first reach is kept.
--
-- 4. spinout_week_reach_coverage — one row per cohort week whose deadline job
--    began after this migration, so every founder who reached that week went
--    through the ledger. A week with no row reads "Not recorded", never 0.
--
-- NO BACKFILL. Rows written before this migration are not inferred from
-- schedules or outcome rows.
--
-- Grep first (D689 D-t): no `outcome` column on spinout_application_interviews,
-- and no table of these names, in an earlier migration or schema_baseline.sql.

ALTER TABLE spinout_application_interviews ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR outcome IN ('held', 'missed'));
ALTER TABLE spinout_application_interviews ADD COLUMN outcome_at TEXT;
ALTER TABLE spinout_application_interviews ADD COLUMN outcome_by INTEGER;

CREATE TABLE IF NOT EXISTS lab_metric_capture (
  metric TEXT PRIMARY KEY CHECK (metric IN ('interview_outcome')),
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO lab_metric_capture (metric) VALUES ('interview_outcome');

CREATE TABLE IF NOT EXISTS spinout_week_reached (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  reached_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('deadline', 'scheduler', 'admin')),
  UNIQUE (user_id, cohort_cycle_id, week_number)
);
CREATE INDEX IF NOT EXISTS idx_spinout_week_reached_cycle ON spinout_week_reached (cohort_cycle_id, week_number);

CREATE TABLE IF NOT EXISTS spinout_week_reach_coverage (
  cohort_cycle_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  covered_from TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cohort_cycle_id, week_number)
);
