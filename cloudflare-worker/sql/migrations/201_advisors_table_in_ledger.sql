-- 201 — `advisors` into the migration ledger.
--
-- WHAT IS TRUE. `advisors` is created in exactly one place in this repository:
-- `sql/t13_t14_t15.sql`, a top-level file applied BY HAND. `scripts/migrate-d1.mjs`
-- enumerates only `sql/migrations/*.sql`, so nothing the runner knows about has
-- ever created it — while migration 182 ALTERs it and 202 below adds seven more
-- columns to it.
--
-- WHAT IS NOT TRUE, and was assumed when this migration was planned: that a
-- database built from `sql/migrations/` alone "fails at 182". It fails at 006
-- (`no such table: users` — `users` is a schema.sql table too), and 53 of the
-- 202 files fail when replayed over schema.sql. There is no from-scratch build
-- path in this repository to repair, and no file numbered 201 could repair one
-- anyway: 182 runs 19 files earlier. `--baseline` exists precisely because
-- replaying this history does not work; production was hand-migrated and then
-- adopted into the ledger.
--
-- SO WHAT THIS IS FOR. `--baseline` MARKS non-idempotent files without executing
-- them (182 is one — it is a bare ALTER), and EXECUTES idempotent ones. This
-- migration is idempotent, so on a baseline adoption of an environment that
-- never received the hand-applied file, it is the statement that puts the table
-- there before 202 reaches for it. On production, which has had the table
-- since T13 shipped, it is a no-op. That is the whole claim — not a repaired
-- build path, just a migration set that no longer rests on a hand-applied one.
--
-- THE SHAPE IS COPIED VERBATIM FROM `sql/t13_t14_t15.sql:15`, deliberately. Two
-- definitions of one table is how this repo has been bitten repeatedly — D1
-- holds one table per name and every definition is IF NOT EXISTS, so the first
-- to run wins and the losers are silent no-ops. A verbatim copy cannot lose an
-- argument it is not having. 182's three columns (topics_willing_json,
-- topics_unwilling_json, weekly_hours_band) are NOT included here for the same
-- reason: `check-migration-column-shapes` allows a migration to name a column of
-- a multiply-defined table only when it is in every definition OR added by an
-- ALTER, and leaving them to 182's ALTER keeps them squarely in the second case.
--
-- `advisor_office_hour_slots`, `advisor_bookings` and `advisor_reviews` come
-- from the same hand-applied file and are deliberately NOT declared here.
-- `advisor_bookings` already carries TWO shapes — schema.sql:1002's six-column
-- version and the live t13 one, recorded in
-- `scripts/sqlite-table-collisions-baseline.json` — and a third would add a
-- permanent hazard to guard against a hypothetical. Migration 205 ALTERs it
-- with a bare `ADD COLUMN`, which needs no opinion about which shape won.

CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  bio TEXT,
  expertise_json TEXT NOT NULL DEFAULT '[]',
  sectors_json TEXT NOT NULL DEFAULT '[]',
  linkedin_url TEXT,
  hourly_rate_usd INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advisors_active ON advisors(is_active);
