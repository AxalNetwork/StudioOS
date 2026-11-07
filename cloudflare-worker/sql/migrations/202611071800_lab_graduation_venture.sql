-- D4659 (#4659): one graduation rule, and one enrolled venture.
--
-- spinout_lab_graduates (view). "Graduated" was "has the week-4
-- incorporation_completed milestone", read separately by the public graduate
-- list, /stats, /cohort, /fund-metrics, admin reads, the certificate
-- issuance and its backfill. A founder whose paid order recorded
-- incorporation before weeks 1-3 were met was a graduate to all of them. The
-- view is the programme rule instead: every required deliverable of weeks 1 to
-- 4 (services/spinoutLabCatalog.ts MILESTONES; the tests pin this list to the
-- catalog) and one of week 3's "any" pair. `graduated_at` is when the last of
-- them landed. `by_rule = 0` rows are credentials issued before this rule: an
-- issued certificate is a recorded decision, so its holder stays a graduate
-- until an admin revokes it (the deliberate, audited repair path).
--
-- spinout_lab_enrollment_events. Every change to an enrollment's venture
-- (`spinout_lab_enrollments.project_id`), and why: bound from the issued
-- credential, bound because the founder owns exactly one project, chosen by
-- the founder, or flagged for a choice because the founder owns several.
--
-- The backfill binds what is unambiguous (the credential's project, else the
-- only owned project) and records a needs_choice event for the rest; nothing
-- is guessed. Issued certificates are not touched.

CREATE VIEW IF NOT EXISTS spinout_lab_graduates AS
SELECT user_id, MIN(graduated_at) AS graduated_at, MAX(by_rule) AS by_rule
  FROM (
    SELECT m.user_id,
           MAX(
             MAX(CASE WHEN m.milestone_key IN ('project_created', 'customer_interview_logged_1', 'customer_interview_logged_2',
                   'customer_interview_logged_3', 'okrs_created', 'brand_basics_filled', 'pitch_deck_drafted',
                   'scoring_run_completed', 'incorporation_completed') THEN m.completed_at END),
             MIN(CASE WHEN m.milestone_key IN ('advisor_meeting_booked', 'cofounder_request_sent') THEN m.completed_at END)
           ) AS graduated_at,
           1 AS by_rule
      FROM spinout_lab_milestones m
     GROUP BY m.user_id
    HAVING COUNT(DISTINCT CASE WHEN m.milestone_key IN ('project_created', 'customer_interview_logged_1', 'customer_interview_logged_2',
                   'customer_interview_logged_3', 'okrs_created', 'brand_basics_filled', 'pitch_deck_drafted',
                   'scoring_run_completed', 'incorporation_completed') THEN m.milestone_key END) = 9
       AND SUM(CASE WHEN m.milestone_key IN ('advisor_meeting_booked', 'cofounder_request_sent') THEN 1 ELSE 0 END) > 0
    UNION ALL
    SELECT c.user_id,
           COALESCE((SELECT mi.completed_at FROM spinout_lab_milestones mi
                      WHERE mi.user_id = c.user_id AND mi.milestone_key = 'incorporation_completed'), c.public_issued_on),
           0
      FROM spinout_certificates c
     WHERE c.status = 'issued'
  )
 GROUP BY user_id;

CREATE TABLE IF NOT EXISTS spinout_lab_enrollment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('bound_from_credential', 'bound_single_project', 'chosen', 'needs_choice')),
  project_id INTEGER,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spinout_lab_enrollment_events_user ON spinout_lab_enrollment_events (user_id, id);

-- 1. The credential's project, where an issued certificate names one.
INSERT INTO spinout_lab_enrollment_events (enrollment_id, user_id, event, project_id, actor)
SELECT e.id, e.user_id, 'bound_from_credential', c.project_id, 'migration:202611071800'
  FROM spinout_lab_enrollments e
  JOIN spinout_certificates c ON c.user_id = e.user_id AND c.status = 'issued' AND c.project_id IS NOT NULL
 WHERE e.project_id IS NULL
   AND e.id = (SELECT MAX(e2.id) FROM spinout_lab_enrollments e2 WHERE e2.user_id = e.user_id);
UPDATE spinout_lab_enrollments
   SET project_id = (SELECT c.project_id FROM spinout_certificates c
                      WHERE c.user_id = spinout_lab_enrollments.user_id AND c.status = 'issued' AND c.project_id IS NOT NULL LIMIT 1)
 WHERE project_id IS NULL
   AND id = (SELECT MAX(e2.id) FROM spinout_lab_enrollments e2 WHERE e2.user_id = spinout_lab_enrollments.user_id)
   AND EXISTS (SELECT 1 FROM spinout_certificates c
                WHERE c.user_id = spinout_lab_enrollments.user_id AND c.status = 'issued' AND c.project_id IS NOT NULL);

-- 2. The only project the founder owns.
INSERT INTO spinout_lab_enrollment_events (enrollment_id, user_id, event, project_id, actor)
SELECT e.id, e.user_id, 'bound_single_project',
       (SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = e.user_id AND p.deleted_at IS NULL),
       'migration:202611071800'
  FROM spinout_lab_enrollments e
 WHERE e.project_id IS NULL
   AND e.id = (SELECT MAX(e2.id) FROM spinout_lab_enrollments e2 WHERE e2.user_id = e.user_id)
   AND (SELECT COUNT(*) FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = e.user_id AND p.deleted_at IS NULL) = 1;
UPDATE spinout_lab_enrollments
   SET project_id = (SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
                      WHERE u.id = spinout_lab_enrollments.user_id AND p.deleted_at IS NULL)
 WHERE project_id IS NULL
   AND id = (SELECT MAX(e2.id) FROM spinout_lab_enrollments e2 WHERE e2.user_id = spinout_lab_enrollments.user_id)
   AND (SELECT COUNT(*) FROM projects p JOIN users u ON u.founder_id = p.founder_id
         WHERE u.id = spinout_lab_enrollments.user_id AND p.deleted_at IS NULL) = 1;

-- 3. Several projects: recorded for the founder (and an admin) to choose.
INSERT INTO spinout_lab_enrollment_events (enrollment_id, user_id, event, project_id, actor)
SELECT e.id, e.user_id, 'needs_choice', NULL, 'migration:202611071800'
  FROM spinout_lab_enrollments e
 WHERE e.project_id IS NULL
   AND e.id = (SELECT MAX(e2.id) FROM spinout_lab_enrollments e2 WHERE e2.user_id = e.user_id)
   AND (SELECT COUNT(*) FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = e.user_id AND p.deleted_at IS NULL) > 1;
