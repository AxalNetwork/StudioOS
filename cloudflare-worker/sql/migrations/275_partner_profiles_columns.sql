-- 275 — partner_profiles is three tables under one name; this makes the one
-- production has carry what every reader needs (D187).
--
-- THE COLLISION. `partner_profiles` is declared three times, in two different
-- shapes, and production carries the shape most of the worker does not use:
--
--   1. migrations/028_partner_deals.sql:34 — id / invitation_id / organization
--      / role_title / …, keyed on an AUTOINCREMENT `id`. This is the shape
--      routes/partner_onboarding.ts, services/advisor/writeRouter.ts and
--      routes/partners.ts were all written against.
--   2. schema_baseline.sql:3297 — `email TEXT PRIMARY KEY` / user_id /
--      legal_entity_name / extracted_data / …  The baseline is a dump OF
--      production, so this is what production is.
--   3. routes/profiling.ts:24-58 — a runtime CREATE TABLE IF NOT EXISTS in
--      shape 2, plus an ALTER … ADD COLUMN loop. This is the one that won.
--
-- Measured read-only against production studioos-db on 2026-09-21:
-- pragma_table_info returns the 22 columns of shape 2, and ALL EIGHTEEN of
-- shape 1's own columns are absent — id, invitation_id, full_name,
-- organization, role_title, expertise, sectors, geography, capacity_per_month,
-- capital_capacity_usd, motivation, prior_deals, linkedin_url, raw_chat_json,
-- services_offered, dealflow_channels, conflicts_text, focus_text.
--
-- A CREATE TABLE IF NOT EXISTS cannot add a column to a table that already
-- exists, so 028 was a no-op wherever shape 2 got there first and 042's four
-- ALTERs went with it. That is the metrics_snapshots collision (#183, #202)
-- for a third time, and the largest instance: the table is one name over two
-- schemas, and every reader of shape 1 is broken on every environment.
--
-- WHAT THIS DOES. Production's shape wins and this is purely additive: the
-- seventeen columns shape 1's readers need are ADDed to the table the 18 live
-- rows already sit in. No row is rewritten and nothing is dropped.
--
-- `id` IS DELIBERATELY NOT ADDED. Shape 2's primary key is `email`, and the
-- readers repoint from `id` to `user_id` / `email` in the same commit. Adding
-- a second identity column to a table that already has one is how a fourth
-- shape would start.
--
-- ONLY ONE OF THE TWO INDEXES BELOW IS NEW, and saying which matters.
-- `idx_partner_profiles_user` is already declared at schema_baseline.sql:6199
-- (and again in 028), so production already carries it — confirmed by reading
-- sqlite_master on 2026-09-21, which returns it beside the email primary key's
-- own sqlite_autoindex and nothing else. It is restated here `IF NOT EXISTS`
-- so a fresh build that skips the baseline still gets it, and it is a no-op
-- everywhere else. `uq_partner_profiles_invitation` is the genuinely new one.
--
-- That unique index is a plain UNIQUE rather than a partial one on purpose:
-- SQLite treats NULLs as distinct in a unique index, so the 18 existing rows
-- (which have no invitation — production holds zero partner_invitations)
-- coexist without a WHERE clause, and a conflict target needs no matching
-- predicate. It is NOT what partner_onboarding.ts binds to any more: that
-- upsert is rekeyed in this same commit to ON CONFLICT(email), the table's own
-- primary key. The index stays because invitation_id must still be unique once
-- the invitation flow runs for the first time — which, production holding zero
-- invitations, it never yet has.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

ALTER TABLE partner_profiles ADD COLUMN invitation_id INTEGER;
ALTER TABLE partner_profiles ADD COLUMN full_name TEXT;
ALTER TABLE partner_profiles ADD COLUMN organization TEXT;
ALTER TABLE partner_profiles ADD COLUMN role_title TEXT;
ALTER TABLE partner_profiles ADD COLUMN expertise TEXT;             -- comma list
ALTER TABLE partner_profiles ADD COLUMN sectors TEXT;               -- comma list
ALTER TABLE partner_profiles ADD COLUMN geography TEXT;
ALTER TABLE partner_profiles ADD COLUMN capacity_per_month TEXT;
ALTER TABLE partner_profiles ADD COLUMN capital_capacity_usd INTEGER;
ALTER TABLE partner_profiles ADD COLUMN motivation TEXT;
ALTER TABLE partner_profiles ADD COLUMN prior_deals TEXT;
ALTER TABLE partner_profiles ADD COLUMN linkedin_url TEXT;
ALTER TABLE partner_profiles ADD COLUMN raw_chat_json TEXT NOT NULL DEFAULT '{}';

-- The four advisor-bank columns migration 042 declared and never landed,
-- because 042 sits below BASELINE_CUTOFF = 219 and the baseline does not
-- carry them — which is the baseline drift D186 filed for check-baseline-drift.
ALTER TABLE partner_profiles ADD COLUMN services_offered TEXT;
ALTER TABLE partner_profiles ADD COLUMN dealflow_channels TEXT;
ALTER TABLE partner_profiles ADD COLUMN conflicts_text TEXT;
ALTER TABLE partner_profiles ADD COLUMN focus_text TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_profiles_invitation
  ON partner_profiles(invitation_id);
CREATE INDEX IF NOT EXISTS idx_partner_profiles_user
  ON partner_profiles(user_id);
