-- 195 — the GP's firm, on the fund they run.
--
-- Company scoping, stage 7. The "Fund" row (/funds) is the GP add-on: an
-- investor running their OWN fund. `shellConfig.js` states the distinction
-- this migration depends on — "Axal VC Fund — LP participation in Axal's own
-- fund. Not the GP add-on" — and the two are different sidebar rows pointing
-- at different places. This file touches only the second.
--
-- WHY vc_funds CARRIES ITS OWN COLUMN. Migration 189's transitive design does
-- not reach here for the same reason 193's did not: a fund is not a project
-- and hangs off no `project_id`. `vc_funds` has exactly one ownership key --
-- `gp_user_id`, the GP of record added by 163 -- and a user id alone cannot
-- say which of that person's firms runs the fund.
--
-- THE DIFFERENCE FROM EVERY EARLIER STAGE, AND IT IS THE IMPORTANT ONE.
-- In stages 1-6 the company was a FILTER: `companyScope` narrowed rows a
-- caller was already entitled to, so getting it wrong showed too little.
-- Here the company enters `fundGpScope`, which is an AUTHORISATION predicate
-- -- it is what makes `requireFundGp` return 404 -- so a mistake here changes
-- who may run capital calls and distributions. `middleware/activeCompany.ts`
-- anticipated this by name when it was written:
--
--     "scope functions get reused -- esignEnvelopeScope and fundGpScope both
--      started narrow -- and the first scope that treats company as an
--      AUTHORISATION rather than a filter would inherit an unverified id from
--      every caller written before it."
--
-- That is this scope. Two properties keep it safe, and both are load-bearing:
--
--   1. The company clause is ANDed onto a conjunct that has already proved
--      `gp_user_id = ?`. It can therefore only ever narrow within the
--      caller's own funds and can never reach another GP's, whatever id
--      arrives. This is why `OR company_id IS NULL` -- which would be an
--      obvious hole in a predicate that stood alone -- is not one here.
--   2. The id is VERIFIED before it arrives. `requireFundGp` passes the
--      result of `resolveActiveCompany`, which checks the header against
--      `user_company_links`; a forged id resolves to NULL and widens nothing.
--
-- WHAT DELIBERATELY DOES NOT NARROW, and one of these is a hard boundary:
--
--   * `GET /funds`, `/funds/analytics`, `/funds/:id`, `/funds/:id/analytics`
--     are untouched. Beyond being a platform directory rather than a firm's
--     private data, `api.fundsList()` is read by SpinoutLabLpWorkspacePage --
--     narrowing it would change a Spin-Out Lab page, which is out of bounds.
--
--   * `/lp-portal` and `/lps/:lpId/sign-lpa` are untouched. They go through
--     `lpSelfScope`, which answers "what do I hold", and a personal LP
--     position is not a claim about a firm. That function exists precisely
--     because returning more there corrupts a personal view rather than
--     granting an oversight one.
--
--   * `/syndication` is a marketplace, so it stays wide -- the same rule
--     stage 6 stated for the deal list.
--
-- What narrows is every control that asserts "I run this fund": the LP
-- register, report periods, LP reports, capital calls, distributions and
-- their execution, fund patch, LPA regeneration. All twelve reach the
-- database through `requireFundGp`, so all twelve narrow at one site.
--
-- BACKFILL: mirrors 189, 193 and 194. The fund lands in its GP's PRIMARY
-- company (`user_company_links.is_primary_admin = 1`, oldest link first), the
-- id spaces line up directly (`gp_user_id` keys on `users(id)`), and a fund
-- whose GP has no primary company keeps NULL.
--
-- NULL IS A REAL STATE HERE TWICE OVER, and neither is a missing backfill. A
-- fund with a NULL `gp_user_id` is owned by nobody and stays unreachable by
-- every non-admin -- 163's deliberate choice, which this migration does not
-- disturb. A fund with a NULL `company_id` is owned by its GP under every one
-- of their companies. Inventing a company for either would be fabricating a
-- fiduciary fact, which is the one thing these surfaces must never do.

ALTER TABLE vc_funds ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_vc_funds_company
  ON vc_funds(gp_user_id, company_id);

UPDATE vc_funds
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = vc_funds.gp_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL AND gp_user_id IS NOT NULL;
