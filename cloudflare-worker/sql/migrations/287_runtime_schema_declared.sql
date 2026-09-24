-- 287 — every schema object a runtime bootstrap can create, declared (D235).
--
-- THE RULE THIS FILE ENFORCES. A runtime `CREATE … IF NOT EXISTS` is a
-- safety net for a database that is missing a DECLARED object. It is never
-- the only declaration. When it is, the first request that reaches it in
-- production creates an object the repo's own fresh build does not have,
-- and every deploy after that fails.
--
-- WHY IT FAILS THE DEPLOY. Step 9 of cloudflare-worker-deploy.yml
-- ("Repo can still rebuild production's schema", scripts/check-baseline-drift.mjs)
-- asserts schema_baseline.sql + every migration above BASELINE_CUTOFF = 219
-- builds the same set of tables, indexes, triggers and views that production
-- holds. It compares names in both directions. A bootstrap that runs in
-- production adds a name to one side only.
--
-- IT HAPPENED. D190 (migration 278) left `admin_publications` to its D95
-- bootstrap (routes/admin_publications.ts:36) on purpose, because the
-- bootstrap heals a missing table. It does, and that was the problem. The
-- bootstrap first ran in production on 2026-09-24 between 12:44:48Z (run
-- 36000909495, step 9 green) and 12:50:17Z (run 36001483496, step 9 red).
-- Every main deploy since has failed at step 9 with the same three names:
-- admin_publications, idx_admin_publications_slug and
-- idx_admin_publications_status_created. That is #757, #759, #760, #755,
-- #761 and #762 — runs 36001483496, 36002768477, 36003562211, 36004154029,
-- 36004642340 and 36005839758. Step 8 deployed each time, so production code
-- was current and only the check was red. Each run's own message says it:
-- production has an object the repo cannot rebuild.
--
-- WHAT IS DECLARED HERE, and it is every object that can do the same thing.
-- Measured by executing every literal runtime DDL statement in
-- cloudflare-worker/src against a copy of the fresh build, to a fixed point,
-- and naming what appeared: nineteen objects the fresh build lacks. This file
-- takes the thirteen that SQLite can create, each copied verbatim from its
-- runtime statement so the object a reader expects is the object it gets:
--
--   admin_publications  (+2 indexes)   routes/admin_publications.ts:44-47
--   spinout_moderation_cases (+3)      routes/spinout_moderation.ts:50-69
--   referral_attributions (+1)         services/referralAttribution.ts:26-37
--   deck_brand_watermarks              services/decks/branding.ts:30
--   deck_recommendation_overrides      services/decks/recommend.ts:58
--   uniq_discovery_advisor_slot        services/advisor/writeRouter.ts:497
--   uniq_roadmap_okrs_advisor_slot     services/advisor/writeRouter.ts:500
--
-- The other six are not here, each for its own reason:
--   · five are REFUSED by SQLite on every database this repo builds,
--     production included, so no request can create them. They are recorded
--     in scripts/runtime-schema-declared-baseline.json, which verifies the
--     refusal rather than trusting it. capital_calls' three indexes
--     (routes/legalcap.ts:90-91,127) name columns the winning capital_calls
--     shape does not have — the known collision. The metric_anomalies table
--     and its index (integrations/providers/stripe.ts:310-319) use
--     double-quoted DEFAULTs, which SQLite rejects as not constant.
--   · one is DELETED from the code in the same change:
--     idx_financial_models_project (routes/financials.ts). Its statement ran
--     only when financial_models was absent, which no database this repo
--     builds is, and the table's UNIQUE(project_id) already indexes the
--     column. A statement that can only matter where it can never run is not
--     a safety net.
--
-- 045'S THIRD INDEX COMES WITH IT. Migration 045 declares admin_publications
-- with three indexes; the bootstrap copies two.
-- `idx_admin_publications_created_by` is 045's own declaration. It never
-- reached any database because 045 is sub-cutoff (MARKED, never run, by
-- `migrate-d1 --bootstrap`) and the bootstrap omits it. This is the
-- precedent 278 set for 048's `idx_advisor_answers_user_status`. With it,
-- 287 carries 045 whole and 100 whole. Step 7 applies it to production
-- before step 9 compares, so both sides gain the same name.
--
-- MEASURED read-only against production studioos-db on 2026-09-24, schema
-- and aggregates only, no user content:
--   · admin_publications and both of its bootstrap indexes EXIST.
--     sqlite_master holds exactly the runtime statement copied below, so
--     every IF NOT EXISTS here leaves them alone. The table holds 0 rows: a
--     request reached the bootstrap, and nothing has been published.
--   · the other eleven objects are ABSENT, and so are the six in the ledger.
--     discovery_interviews and roadmap_okrs exist and hold 0 rows each, so
--     the two partial UNIQUE indexes cannot fail on a duplicate.
--   · no index in production uses LIKE today. SQLite allows LIKE in a
--     partial index's WHERE (the PRAGMA case_sensitive_like documentation
--     warns about exactly that combination). The node:sqlite test builds
--     both indexes from this file and runs the ON CONFLICT upserts that
--     depend on them.
--
-- SIZING: every object here is created over an empty table. Nothing is
-- rewritten, nothing is dropped, and no column is added anywhere.
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

-- Admin publications — routes/admin_publications.ts:44-47, and 045 ------------
CREATE TABLE IF NOT EXISTS admin_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT, audience TEXT NOT NULL DEFAULT 'internal', section TEXT NOT NULL, filters_json TEXT NOT NULL DEFAULT '{}', summary_text TEXT NOT NULL DEFAULT '', summary_human_edited INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), published_at TEXT);
CREATE INDEX IF NOT EXISTS idx_admin_publications_slug ON admin_publications(slug);
CREATE INDEX IF NOT EXISTS idx_admin_publications_status_created ON admin_publications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_publications_created_by ON admin_publications(created_by, created_at DESC);

-- Spin-out moderation cases — routes/spinout_moderation.ts:50-69 --------------
CREATE TABLE IF NOT EXISTS spinout_moderation_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  status        TEXT NOT NULL,
  reason_code   TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'medium',
  summary       TEXT,
  details       TEXT,
  lab_access_before INTEGER,
  lab_access_after  INTEGER,
  opened_by     INTEGER NOT NULL,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by   INTEGER,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spinout_mod_user   ON spinout_moderation_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_spinout_mod_status ON spinout_moderation_cases(status);
CREATE INDEX IF NOT EXISTS idx_spinout_mod_open   ON spinout_moderation_cases(user_id, resolved_at);

-- Referral attributions — services/referralAttribution.ts:26-37, and 100 -------
CREATE TABLE IF NOT EXISTS referral_attributions (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                     INTEGER NOT NULL UNIQUE,
  referral_code               TEXT NOT NULL,
  referrer_user_id            INTEGER NOT NULL,
  first_touch_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at                  TIMESTAMP NOT NULL,
  converted_payment_intent_id TEXT,
  converted_at                TIMESTAMP,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
  ON referral_attributions(referrer_user_id);

-- Deck brand watermarks — services/decks/branding.ts:30 -----------------------
CREATE TABLE IF NOT EXISTS deck_brand_watermarks (
  user_id INTEGER PRIMARY KEY,
  watermark_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Deck recommendation overrides — services/decks/recommend.ts:58 --------------
CREATE TABLE IF NOT EXISTS deck_recommendation_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,
  stage TEXT NOT NULL,
  method_id TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sector, stage)
);

-- Eadwyn's advisor slots — services/advisor/writeRouter.ts:497-500 ------------
-- One row per (project, advisor question) for the two stores the advisor
-- writes into. The advisor's upserts name these as their ON CONFLICT target,
-- so without the index the write is refused.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_discovery_advisor_slot ON discovery_interviews(project_id, interviewee_role) WHERE interviewee_role LIKE 'advisor:%';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_roadmap_okrs_advisor_slot ON roadmap_okrs(project_id, quarter) WHERE quarter LIKE 'advisor:%';
