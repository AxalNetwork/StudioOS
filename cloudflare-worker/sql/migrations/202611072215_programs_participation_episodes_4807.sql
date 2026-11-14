-- 4807 — Programs: who took part in a reporting period is read from episodes
-- that later changes cannot rewrite (D4807, #4807; Programs audit 4/7).
--
-- THE PROBLEM. `peopleIn` (People taking part) asked the mutable rows: a mentor
-- assignment's `assigned_at` / `unassigned_at` / `is_active`, and a Learning
-- enrolment's `enrolled_at` / `status` / `updated_at`. A re-assign overwrites
-- the first and clears the second; a re-enrolment overwrites the third. So a
-- reassignment or re-enrolment made AFTER a period closed changed that closed
-- period's count.
--
-- THE FIX READS WHAT NEVER CHANGES. 565 (`advisor_cohort_assignment_events`)
-- and 560 (`learning_enrolment_events`) each get one row per grant, end,
-- enrolment and removal, and nothing updates or deletes one. These two views
-- pair every start with the first later event of the same assignment (or the
-- same learner and program) that bounds it, so an episode is a start and the
-- end that came next:
--   · a mentor episode starts at an `assigned` event and ends at the next
--     `ended` event, or at the next `assigned` event when the earlier episode's
--     end was never stored (565's backfill cannot recover an end it never had);
--   · a Learning episode starts at an `enrolled` event and ends at the next
--     `removed` event, or at the next `enrolled` event.
-- `ended_at` is NULL while an episode is open. Times are normalised with
-- `datetime()`, so rows written in either of the two timestamp forms compare.
--
-- A view stores nothing: there is no second copy to drift from the events.
-- An event written after a period closes can only add a later start or close
-- an episode at a time after the period, so a closed period's answer is the
-- same before and after it.

CREATE VIEW IF NOT EXISTS advisor_cohort_episodes AS
SELECT s.assignment_id AS assignment_id,
       s.advisor_user_id AS advisor_user_id,
       s.cohort_cycle_id AS cohort_cycle_id,
       datetime(s.created_at) AS started_at,
       (SELECT MIN(datetime(x.created_at))
          FROM advisor_cohort_assignment_events x
         WHERE x.assignment_id = s.assignment_id
           AND x.id <> s.id
           AND (datetime(x.created_at) > datetime(s.created_at)
                OR (x.kind = 'ended' AND datetime(x.created_at) = datetime(s.created_at)))) AS ended_at
  FROM advisor_cohort_assignment_events s
 WHERE s.kind = 'assigned';

CREATE VIEW IF NOT EXISTS learning_enrolment_episodes AS
SELECT s.program_id AS program_id,
       s.user_id AS user_id,
       datetime(s.at) AS started_at,
       (SELECT MIN(datetime(x.at))
          FROM learning_enrolment_events x
         WHERE x.program_id = s.program_id
           AND x.user_id = s.user_id
           AND x.id <> s.id
           AND (datetime(x.at) > datetime(s.at)
                OR (x.kind = 'removed' AND datetime(x.at) = datetime(s.at)))) AS ended_at
  FROM learning_enrolment_events s
 WHERE s.kind = 'enrolled';
