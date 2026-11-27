-- 193 — the investor's firm, on the rows that carry their deal flow.
--
-- Company scoping, stage 5. Migration 189 gave `projects` a `company_id` and
-- every project-keyed surface inherited the company transitively through it.
-- The investor surfaces cannot: an investor's visible projects come from
-- explicit RELATIONSHIPS — `_investorProjectScope.investorProjectIds` unions
-- dealroom membership, introductions and converted watchlist items — and each
-- of those rows is keyed on `investor_user_id` / `owner_user_id` alone. There
-- is no project of the investor's to hang a company off, so the relationship
-- itself has to carry one.
--
-- WHY user_company_links AND NOT ONE OF THE OTHER TWO. Three groupings in this
-- schema could each be read as "the investor's firm", and they are not
-- interchangeable:
--
--   * `investor_seat_primary_user_id` (027) groups a firm's colleagues under
--     one SUBSCRIPTION so they inherit the primary's tier. It is a billing
--     concept. An investor with a single seat would have nothing to switch
--     between, so the control would sit inert for almost everyone.
--
--   * `vc_funds.gp_user_id` (163) is a real fund with a GP of record and
--     fiduciary facts. But an investor may be GP of SEVERAL funds, so "the
--     fund" is not one thing, and making the switcher list funds would change
--     what the dropdown means for one role only.
--
--   * `user_company_links` is what the CompanySwitcher already writes, and is
--     already the company dimension for founders. Using it here is the only
--     choice where the control a person clicks is the thing that scopes, and
--     where the switcher means one thing in every role.
--
-- The third was chosen deliberately, and this file records the other two so
-- the next reader does not have to rediscover the fork.
--
-- BACKFILL: mirrors 189 exactly. A relationship lands in its owner's PRIMARY
-- company (`user_company_links.is_primary_admin = 1`, oldest link first). The
-- id spaces line up directly here — these tables key on `users(id)`, not on
-- `founders(id)` — so this needs none of 189's three-hop bridge, and that
-- difference is worth stating because the shapes otherwise look alike.
--
-- NULL IS A REAL STATE, NOT A MISSING BACKFILL. An investor with no primary
-- company keeps NULL, and `projectInActiveCompany` shows a NULL row under
-- every company. Inventing a company for them would be fabricating the very
-- thing the fund surfaces are required to report as "not recorded".
--
-- D1/SQLite: ALTER TABLE ... ADD COLUMN cannot carry a REFERENCES clause with
-- a non-NULL default, and D1 does not enforce foreign keys by default. The
-- relationship is documented here and enforced by the scope function.

ALTER TABLE investor_introductions ADD COLUMN company_id INTEGER;
ALTER TABLE investor_dealroom_members ADD COLUMN company_id INTEGER;
ALTER TABLE watchlist_items ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_intros_company
  ON investor_introductions(investor_user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_dealroom_company
  ON investor_dealroom_members(investor_user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_company
  ON watchlist_items(owner_user_id, company_id);

UPDATE investor_introductions
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = investor_introductions.investor_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

UPDATE investor_dealroom_members
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = investor_dealroom_members.investor_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

UPDATE watchlist_items
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = watchlist_items.owner_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;
