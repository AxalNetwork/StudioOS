-- 197 — the founder's company, on the advisors they keep.
--
-- Company scoping, stage 9, and NOT the surface the plan expected. The
-- ADVISOR role's own three rows cannot be scoped, and that is a finding rather
-- than a shortfall:
--
--   * Practice (/advisor/advisory/*) and Expertise (/office-hours) are two
--     sidebar rows over ONE API — routes/advisors.ts, the office-hours
--     implementation. `/office-hours` is task #124 and under a standing
--     do-not-touch instruction; `documentation/architecture/UNRESOLVED_ITEMS.md`
--     U4 records the same collision from the other direction ("Advisory
--     Practice needs /office-hours to change, and /office-hours is frozen").
--     Scoping either row means editing frozen code.
--
--   * Cohorts has no store at all. `AdvisorBucketRoutes.jsx` renders a
--     deliberate empty state and says why: "Nothing in the product links an
--     advisor to a cohort. The Lab knows its founders and the practice knows
--     its clients; no table joins them." There is no ownership to narrow.
--
-- What IS unscoped, and was missed when the founder surfaces were done, is the
-- FOUNDER-side advisor roster in routes/advisory.ts. Its `ownedProjectScope`
-- says "Mirrors contacts.ts" in its own comment — and contacts.ts was narrowed
-- in stage 3 while this copy was not. That is the fifth appearance of the
-- inlined-ownership pattern this rollout keeps finding, after compliance's
-- GET /events, contacts' own scope, portfolio's visibleProjectIds and the
-- deals founder branch.
--
-- WHY A COLUMN AND NOT A JOIN THROUGH THE ASSIGNMENTS. An advisor is linked to
-- projects through `advisor_startups`, and a project carries a company (189),
-- so the company could in principle be derived. It must not be: an advisor
-- profile with NO assignment yet — the state every newly added advisor is in —
-- would then belong to no company and vanish from every view. The roster is
-- the founder's own list, so it carries its own company.
--
-- BACKFILL: identical to 189, bridge included. `advisor_profiles.founder_id`
-- keys on `founders(id)`, not `users(id)`, so the hop is
-- founders -> users.founder_id -> user_company_links, and the row lands in its
-- founder's PRIMARY company. A founder with no primary company keeps NULL,
-- which every scope in this rollout reads as "visible under every company".

ALTER TABLE advisor_profiles ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_advisor_profiles_company
  ON advisor_profiles(founder_id, company_id);

UPDATE advisor_profiles
   SET company_id = (
     SELECT ucl.company_id
       FROM users u
       JOIN user_company_links ucl ON ucl.user_id = u.id
      WHERE u.founder_id = advisor_profiles.founder_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC
      LIMIT 1
   )
 WHERE company_id IS NULL
   AND founder_id IS NOT NULL;
