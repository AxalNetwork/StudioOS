-- 276 — migration 042 declared eighteen columns and eleven never reached any
-- database. This lands them (D188).
--
-- WHY A MIGRATION'S COLUMNS CAN GO MISSING WHILE ITS LEDGER ROW SAYS APPLIED.
-- `042_advisor_field_sources.sql` is below BASELINE_CUTOFF = 219. On a new
-- database `migrate-d1 --bootstrap` loads `schema_baseline.sql` and then MARKS
-- every file at or below the cutoff as applied WITHOUT RUNNING A STATEMENT OF
-- IT (scripts/lib/migrationPlan.mjs, mode 'bootstrap'). That is correct — the
-- sub-cutoff files are not replayable, because CREATE TABLE users, projects,
-- deals and documents live only in sql/historical/schema.sql. So a sub-cutoff
-- migration's effect reaches a database only if the BASELINE already carries
-- it, and the baseline is a dump of production taken before 042's ALTERs.
--
-- The file looks applied from every angle: its ledger row is there, and the
-- table it creates — `field_sources` — does exist, because the baseline dump
-- happened to include it. Only the ALTERs went missing.
--
-- MEASURED read-only against production studioos-db on 2026-09-21, schema and
-- aggregates only. 042 declares eighteen columns over five tables:
--
--   mentors            3   the table exists NOWHERE — see below
--   partner_profiles   4   landed 2026-09-21 in migration 275 (D187)
--   investor_profiles  3   ABSENT — 0 of 3 in production
--   projects           7   ABSENT — 0 of 7 in production
--   users              1   ABSENT (advisor_extras_json)
--
-- EVERY ONE OF THE ELEVEN HAS A LIVE READER, and the blast radius is wider
-- than the advisor. services/advisor/writeRouter.ts reads all eleven — it is
-- the same file D187 repaired one migration over. Beyond it:
--   runway_months     services/scoring.ts, services/decks/autofill.ts,
--                     decks/methods.ts, decks/axalSpinoutDemoDay.ts,
--                     services/saasMetrics.ts, services/exploringSchema.ts,
--                     routes/decks.ts, financials.ts, legalcap.ts, advisory.ts
--   mrr_usd           services/analyticsReports.ts
--   raise_target_usd  routes/research.ts
--
-- Because `SELECT *` does not throw on a missing column and `writeRouter`'s
-- saves sit inside a catch, none of this surfaced as an error. It surfaced as
-- an advisor answer that appeared to save and a founder metric that read as
-- unrecorded.
--
-- THE mentors TRIO IS DELIBERATELY NOT HERE, and that is a decision rather
-- than an omission. `182_advisor_topics_calendar.sql:6-10` already quotes
-- 042's three `mentors` ALTERs and states: "There is no `CREATE TABLE mentors`
-- anywhere in this repository." It repaired them onto `advisors` at :37-39,
-- where all three exist today. Confirmed: `mentors` is absent from a fresh
-- build AND from production, and has zero readers — no FROM, no INTO, no
-- UPDATE anywhere in cloudflare-worker/src. Re-adding it would create a table
-- for a concept D186 finished retiring when it repointed the advisor
-- checklist's capacity detector at `advisors.weekly_hours_band`.
--
-- TYPES ARE 042'S OWN, not re-chosen, so the column a reader expects is the
-- column it gets. `monthly_burn_usd`, `mrr_usd` and `raise_target_usd` stay
-- REAL dollars rather than becoming *_cents: all three are already recorded
-- in scripts/money-cents-baseline.json as legacy float money, and converting
-- them is a data migration over live records, not something to slip into a
-- column-restoration migration. That baseline's citations gain this file.
--
-- SIZING, re-measured rather than trusted: projects 5 rows, investor_profiles
-- 2 rows, users 51 rows. Eleven ADD COLUMNs are instant, nothing is rewritten
-- and nothing is dropped.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

-- Investor pipeline / coinvest / seed-watchlist ----------------------------
ALTER TABLE investor_profiles ADD COLUMN deal_volume_band TEXT;
ALTER TABLE investor_profiles ADD COLUMN coinvest_pref_text TEXT;
ALTER TABLE investor_profiles ADD COLUMN watchlist_seed_text TEXT;

-- Founder existing-bank columns on projects --------------------------------
-- runway / burn / MRR are surfaced on /build/financials and /build/metrics.
ALTER TABLE projects ADD COLUMN runway_months INTEGER;
ALTER TABLE projects ADD COLUMN monthly_burn_usd REAL;
ALTER TABLE projects ADD COLUMN mrr_usd REAL;
-- Active raise flag + target are surfaced on /capital/fundraise.
ALTER TABLE projects ADD COLUMN raise_active TEXT;       -- 'Yes'|'No'|'Soon'
ALTER TABLE projects ADD COLUMN raise_target_usd REAL;
-- Cap-table entity label, kept distinct from users.entity_type which is the
-- cross-project identity setting.
ALTER TABLE projects ADD COLUMN entity_label TEXT;
-- Free-form answers with no canonical column yet (compliance.status,
-- captable.ownership, mentors.needs, team.cofounders, pipeline.top_deals),
-- stored as a JSON object keyed by question_id so a future bank addition
-- needs no migration.
ALTER TABLE projects ADD COLUMN advisor_extras_json TEXT;

-- Cross-project advisor extras (partner.profile.focus, etc.) ---------------
-- A SIDE TABLE, NOT A COLUMN ON `users`, AND THAT IS NOT A STYLE CHOICE.
-- 042 declares `ALTER TABLE users ADD COLUMN advisor_extras_json`, and on D1
-- that statement CANNOT SUCCEED: D1 caps a table at 100 columns and `users` is
-- at exactly 100 — measured read-only against production on 2026-09-21,
-- `SELECT COUNT(*) FROM pragma_table_info('users')` = 100. Migration 199 hit
-- this for real on 2026-09-03 (#413): its `ALTER TABLE users ADD COLUMN`
-- failed with "too many columns on sqlite_altertab_users", and because the
-- runner is forward-only and ordered it held 200–207 out of production behind
-- it. So 042's eighteenth declaration is dead as written and always was, and
-- writing it here would have failed this deploy and blocked every migration
-- after it. `frontend/test/migration_column_shapes.test.mjs` refuses the shape
-- for exactly that reason and is what caught this one.
--
-- node:sqlite has no such cap, which is why a fresh local build applies 042's
-- ALTER happily and only the source-text guard can see the problem — the same
-- local-succeeds/production-fails shape this whole migration is about.
--
-- GOTCHAS names the remedy and `super_admins` (199, D35) is the precedent: a
-- side table keyed by user_id. `users.advisor_extras_json` is recorded in
-- scripts/migration-declarations-baseline.json as a declaration that can never
-- land, with this table named as what carries the fact instead.
CREATE TABLE IF NOT EXISTS user_advisor_extras (
  user_id     INTEGER PRIMARY KEY,
  extras_json TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
