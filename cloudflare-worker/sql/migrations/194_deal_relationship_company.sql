-- 194 — the investor's firm, on the two deal relationships 193 did not reach.
--
-- Company scoping, stage 6. Migration 193 put `company_id` on the three
-- relationships that decide which PROJECTS an investor can see (dealroom
-- membership, introductions, converted watchlist items). The Deals surface
-- answers a different question — which DEALS are mine — and it reads two more
-- tables to do it: `deal_invitations` and `commitments`. Both are keyed on
-- `investor_user_id` alone, so neither can say which of the investor's firms
-- the invitation or the cheque belongs to.
--
-- WHAT IS DELIBERATELY NOT SCOPED. `deals` itself gets no company column and
-- the deal LIST is not narrowed. Browsing open deals is a marketplace, not a
-- firm's private data: an investor is meant to see deals they have no
-- relationship with yet, which is the entire point of the surface. Narrowing
-- the browse list would hide the deals they could invest in and leave the
-- switcher looking broken. What narrows is the RELATIONSHIP — `is_member`, and
-- the `scope=mine` filter — because those are claims about this firm.
--
-- This is the same rule the whole rollout follows, stated for a marketplace
-- rather than for a project: company narrows what you reach by OWNING it,
-- never what you reach another way.
--
-- BACKFILL: mirrors 189 and 193. The row lands in its investor's PRIMARY
-- company (`user_company_links.is_primary_admin = 1`, oldest link first), the
-- id spaces line up directly (these key on `users(id)`), and an investor with
-- no primary company keeps NULL — which `projectInActiveCompany` and the deal
-- queries both read as "visible under every company". Nothing is invented.

ALTER TABLE deal_invitations ADD COLUMN company_id INTEGER;
ALTER TABLE commitments ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_deal_invitations_company
  ON deal_invitations(investor_user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_commitments_company
  ON commitments(investor_user_id, company_id);

UPDATE deal_invitations
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = deal_invitations.investor_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;

UPDATE commitments
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = commitments.investor_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL;
