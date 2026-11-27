-- 565 — mentor cohort access: a grant and end history (D960, #2793; Programs part 7 of #2371).
--
-- WHY A SECOND TABLE. 206 keeps one row per advisor and cycle, and a
-- re-assign reactivates that row: it overwrites `assigned_at`, the note and
-- the admin, and clears `unassigned_at`. So the row answers "is access open
-- now?" and nothing about the episodes before it. Every grant and every end
-- is now a row here, and nothing updates or deletes one.
--
-- WHO. `admin_user_id` is the admin who acted, or NULL when nothing recorded
-- one. No read returns it: the history read says only whether an admin was
-- recorded (`by_admin`), as the map's Part B §4.1 asks.
--
-- THE BACKFILL, AND WHAT IT CANNOT RECOVER.
--   · one `assigned` row per assignment, from its current `assigned_at` and
--     `assigned_by_admin_id`;
--   · one `ended` row per assignment that has an `unassigned_at`, with no
--     admin: 206 never stored who ended one;
--   · one `assigned` row, with no admin, for each earlier episode a re-assign
--     overwrote that survives as a founder notice's `episode_at` (367). Only
--     episodes in which at least one founder was told survive that way.
-- An earlier episode nobody was told of, and the end of any overwritten
-- episode, are not stored anywhere and are not invented here.

CREATE TABLE IF NOT EXISTS advisor_cohort_assignment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES advisor_cohort_assignments(id),
  advisor_user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assigned', 'ended')),
  admin_user_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignment_events_assignment
  ON advisor_cohort_assignment_events(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignment_events_cycle
  ON advisor_cohort_assignment_events(cohort_cycle_id, created_at);

INSERT INTO advisor_cohort_assignment_events
  (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note, created_at)
SELECT id, advisor_user_id, cohort_cycle_id, 'assigned', assigned_by_admin_id, note, assigned_at
  FROM advisor_cohort_assignments;

INSERT INTO advisor_cohort_assignment_events
  (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note, created_at)
SELECT id, advisor_user_id, cohort_cycle_id, 'ended', NULL, NULL, unassigned_at
  FROM advisor_cohort_assignments
 WHERE unassigned_at IS NOT NULL;

INSERT INTO advisor_cohort_assignment_events
  (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note, created_at)
SELECT DISTINCT n.assignment_id, a.advisor_user_id, a.cohort_cycle_id, 'assigned', NULL, NULL, n.episode_at
  FROM cohort_advisor_notices n
  JOIN advisor_cohort_assignments a ON a.id = n.assignment_id
 WHERE n.kind = 'started' AND n.episode_at <> a.assigned_at;
