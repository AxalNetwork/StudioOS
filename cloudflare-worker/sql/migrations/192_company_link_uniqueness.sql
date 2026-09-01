-- 192 — one membership row per (user, company), enforced.
--
-- THE BUG THIS CLOSES. `user_company_links` carried no uniqueness at all:
-- t13_t14_t15.sql gives it `idx_uclink_user ON user_company_links(user_id)`,
-- a plain index, and nothing else. `/company/create` inserts a link with no
-- pre-check, and `/company/memberships` returns ONE ENTRY PER LINK, so a
-- second link for the same pair renders the same company twice in the
-- switcher — the control that is supposed to be the single source of truth
-- for which company you are looking at.
--
-- DEDUPE BEFORE THE INDEX, or the index fails. CREATE UNIQUE INDEX on a table
-- that already violates it is an error, and a failed migration in `predeploy`
-- blocks the deploy rather than half-applying. So the delete runs first.
--
-- WHICH ROW SURVIVES: the primary-admin link if there is one, then the oldest,
-- then the lowest id as a final tiebreak so the choice is deterministic even
-- when created_at ties (it is a TEXT timestamp, and rows written in the same
-- second do tie). Keeping the primary matters — `/company/me` and the
-- switcher's initial selection both order by `is_primary_admin DESC`, and
-- migration 189 backfilled projects through `is_primary_admin = 1` links
-- specifically. Dropping the primary and keeping a plain member row would
-- silently change which company a founder's projects appear under.
--
-- A duplicate link grants nothing a single link does not, so deleting the
-- redundant copies removes no access. This is the one dedupe in this area
-- that is safe: duplicate COMPANY rows are NOT touched here, because two
-- company_profiles rows sharing a name are two distinct companies that may
-- each hold data, and merging them is a decision for their owner rather than
-- for a migration.

DELETE FROM user_company_links
 WHERE id NOT IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY user_id, company_id
              ORDER BY is_primary_admin DESC, created_at ASC, id ASC
            ) AS rn
       FROM user_company_links
   )
    WHERE rn = 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS idx_uclink_user_company
  ON user_company_links(user_id, company_id);
