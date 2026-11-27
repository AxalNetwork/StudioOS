-- consolidate_capital_alters.sql
--
-- Phase 1 of the capital-table consolidation. Adds the new columns needed by
-- the canonical schema. Each ALTER aborts the script on duplicate-column
-- error in SQLite, so this file MUST be executed in a deploy step that
-- tolerates the failure (`|| true`) and the backfill phase MUST run as a
-- separate file. Re-runs are no-ops once columns exist.

ALTER TABLE capital_calls    ADD COLUMN limited_partner_id INTEGER REFERENCES limited_partners(id);
ALTER TABLE limited_partners ADD COLUMN name  TEXT;
ALTER TABLE limited_partners ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_limited_partners_fund_email
    ON limited_partners(fund_id, email);
