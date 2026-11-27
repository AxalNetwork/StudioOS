-- 198 — the partner's agency, on the perks they list.
--
-- Company scoping, stage 10: the shared user-keyed surfaces that belong to no
-- single role. Three were on the list and only one of them has anything to
-- narrow. Recording why the other two do not is the point of this header —
-- otherwise the next reader sees two unscoped files and assumes they were
-- forgotten.
--
-- PERKS SPLITS THREE WAYS, and only the middle one is a firm's:
--
--   * The CATALOGUE (`GET /`, `GET /:uid`, `POST /:uid/claim`) is a
--     marketplace. Its own header calls it one. A founder is meant to see
--     perks from partners they have no relationship with, so it does not
--     narrow — the rule stages 6 and 8 already applied to the deal list, the
--     founder-needs board and the offering catalog.
--
--   * The PARTNER SIDE (`GET /partner`, `POST /partner`, `PATCH
--     /partner/:uid`, `GET /partner/:uid/stats`) is "what does MY agency
--     offer". That is a claim about a firm, and it is what this column is for.
--
--   * The CREDIT LEDGER and CLAIMS (`perk_credit_ledger.user_id`,
--     `perk_claims.user_id`) are an ACCOUNT balance and what was spent from
--     it. They stay account-level for the same reason `partner_portal`'s
--     referral code and `lpSelfScope`'s positions do: a balance belongs to the
--     person, and splitting one person's credits across their firms would
--     invent an accounting rule nobody asked for.
--
-- WHAT STAGE 10 DELIBERATELY LEAVES ALONE ENTIRELY:
--
--   * `routes/networkfx.ts`. `marketplace_profiles` is ONE row per user —
--     `ON CONFLICT(user_id) DO UPDATE`, a unique key on the account — so a
--     person has a single professional profile and there is no per-company
--     variant to select between. Giving it one is a schema redesign, not a
--     scoping pass. `/marketplace/search` is a directory of people, and
--     syndicate membership is a second path to a row, which this rollout has
--     never narrowed by the caller's own company.
--
--   * `routes/calendar.ts`. `fetchUserEvents(env, user.id, role, ...)`
--     aggregates one person's own events, and the OAuth tokens are per
--     account. A calendar belongs to a person, not to a firm.
--
-- BACKFILL: mirrors 193-197. `perks.partner_user_id` is already a `users(id)`,
-- so this needs no bridge — the direct form, like `service_offerings` in 196
-- and unlike `quotes`/`engagements` in the same migration. A partner with no
-- primary company keeps NULL, which every scope in this rollout reads as
-- "visible under every company".

ALTER TABLE perks ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_perks_company ON perks(partner_user_id, company_id);

UPDATE perks
   SET company_id = (
     SELECT ucl.company_id FROM user_company_links ucl
      WHERE ucl.user_id = perks.partner_user_id
        AND ucl.is_primary_admin = 1
      ORDER BY ucl.created_at ASC LIMIT 1
   )
 WHERE company_id IS NULL
   AND partner_user_id IS NOT NULL;
