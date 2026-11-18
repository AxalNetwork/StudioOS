-- #6925: the cohort assignment, NDA delivery and gated investor reads exist.
-- Correct the build label only for the original global, unopened registry row.
-- Replace the original Demo Day description only where HQ still has that exact copy.
-- Member access, studio offers, grants and legal templates are separate decisions.
UPDATE programs
   SET status = 'partly_built',
       purpose = CASE WHEN purpose = 'Verified investors follow one Lab cohort to Demo Day.'
         THEN 'Give verified investors access to venture summaries and weekly progress for one assigned Lab cohort after they sign its NDA.'
         ELSE purpose END,
       updated_at = datetime('now')
 WHERE key = 'investor-cohorts'
   AND licence_uid IS NULL
   AND status = 'not_built'
   AND member_access = 'not_open';
