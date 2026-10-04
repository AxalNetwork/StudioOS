-- 375 — declare the 24 research_company_directory columns production already
-- holds (D531).
--
-- WHERE THEY CAME FROM. No commit has ever declared them. `git log -S` and
-- `git grep` over all 44 branches find none of the 24 names on this table. The
-- one hit, `valuation_currency`, is `company_funding_rounds`' own column in
-- migration 370, and no PR search finds them. Migration 228 created the table
-- on 2026-09-29 with the
-- thirteen columns it still declares, so the 24 were added on production by hand
-- after that, without a migration. They are the same data family as the four
-- `company_*` tables created by hand on 2026-09-30 (D520, migration 370):
-- funding, valuation, revenue, employees, market share and the evidence behind
-- them. The drift check compared table names only until D359, so nothing
-- reported them until deploy run 37197266231 on 2026-10-04.
--
-- WHAT EACH STATEMENT IS. Production's own column, as that run printed it:
-- `check-baseline-drift` reads `pragma_table_info` and prints type, NOT NULL
-- and DEFAULT whenever production has them, so a bare type here means
-- production's column is nullable with no default. Nothing is re-chosen. The
-- four money columns are REAL dollars as production holds them, recorded as
-- legacy in scripts/money-cents-baseline.json, as D520 did for the company_*
-- tables.
--
-- WHY THESE ARE PLAIN ALTERs, AND THE ONE STEP PRODUCTION NEEDS. SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, and the runner executes a pending file whole, so
-- no statement here can be a no-op on production the way 370's
-- `CREATE TABLE IF NOT EXISTS` was. On a fresh database and on every branch
-- database (built from this repo, so without the columns) the file applies as
-- written. On production every column already exists. So before the deploy that
-- carries this file, production's ledger records it as applied, the way
-- scripts/lib/migrationPlan.mjs `applyPlan` already tells the operator to when
-- an effect is present but unrecorded:
--
--   INSERT INTO schema_migrations (filename, checksum)
--   VALUES ('375_research_company_directory_columns.sql', '<sha256 of this file>');
--
-- `migrate-d1 --remote` then skips it, and `--verify-marked` checks that the
-- 24 columns exist. D531 gives the exact command. If the deploy runs first, the
-- first ALTER fails with "duplicate column", nothing changes, the deploy stops
-- before the Worker ships, and recording the row then re-running recovers it.
--
-- SIZE. 13 + 24 = 37 columns, well under D1's 100-column cap. Nothing is
-- rewritten or dropped. No code reads these columns yet (D531).
--
-- No BEGIN/COMMIT — D1 rejects transaction statements in a migration (#26).

ALTER TABLE research_company_directory ADD COLUMN competitor_status TEXT;
ALTER TABLE research_company_directory ADD COLUMN diligence_status TEXT;
ALTER TABLE research_company_directory ADD COLUMN employee_as_of TEXT;
ALTER TABLE research_company_directory ADD COLUMN employee_count INTEGER;
ALTER TABLE research_company_directory ADD COLUMN employee_growth_pct REAL;
ALTER TABLE research_company_directory ADD COLUMN funding_currency TEXT;
ALTER TABLE research_company_directory ADD COLUMN funding_total REAL;
ALTER TABLE research_company_directory ADD COLUMN last_funding_amount REAL;
ALTER TABLE research_company_directory ADD COLUMN last_funding_currency TEXT;
ALTER TABLE research_company_directory ADD COLUMN last_funding_date TEXT;
ALTER TABLE research_company_directory ADD COLUMN last_funding_type TEXT;
ALTER TABLE research_company_directory ADD COLUMN market_share_as_of TEXT;
ALTER TABLE research_company_directory ADD COLUMN market_share_pct REAL;
ALTER TABLE research_company_directory ADD COLUMN metrics_confidence TEXT;
ALTER TABLE research_company_directory ADD COLUMN metrics_evidence_json TEXT;
ALTER TABLE research_company_directory ADD COLUMN metrics_source_name TEXT;
ALTER TABLE research_company_directory ADD COLUMN metrics_source_url TEXT;
ALTER TABLE research_company_directory ADD COLUMN metrics_updated_at TEXT;
ALTER TABLE research_company_directory ADD COLUMN revenue REAL;
ALTER TABLE research_company_directory ADD COLUMN revenue_as_of TEXT;
ALTER TABLE research_company_directory ADD COLUMN revenue_currency TEXT;
ALTER TABLE research_company_directory ADD COLUMN valuation REAL;
ALTER TABLE research_company_directory ADD COLUMN valuation_as_of TEXT;
ALTER TABLE research_company_directory ADD COLUMN valuation_currency TEXT;
