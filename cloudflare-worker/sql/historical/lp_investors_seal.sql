-- Epic 11 — D1 write-seal for the deprecated lp_investors table.
--
-- Background:
--   Phase A1+A2 of the capital-tables consolidation moved every legacy
--   lp_investors row into the canonical limited_partners + vc_funds tables.
--   The Python ORM-side guard at backend/app/services/db_guards.py blocks
--   accidental re-writes from the FastAPI dev backend, but D1 has its own
--   surface area (wrangler d1 execute, queue jobs that hit DB.prepare()
--   directly, etc.) that bypasses Python entirely. This file installs a
--   SQLite trigger that RAISEs on any INSERT or UPDATE so D1 itself
--   refuses the write — same fail-loud contract as the ORM listener.
--
-- Run via:
--   npx wrangler d1 execute studioos-db --remote --file=sql/lp_investors_seal.sql
--
-- IDEMPOTENT: CREATE TRIGGER IF NOT EXISTS — re-running this file is a
-- no-op after the first apply. To force-replay, drop the triggers first:
--   DROP TRIGGER IF EXISTS lp_investors_block_insert;
--   DROP TRIGGER IF EXISTS lp_investors_block_update;
--
-- READS still work — the consolidation backfill (sql/consolidate_capital_backfill.sql)
-- and the legacy capital_calls.lp_investor_id FK lookup both need to read
-- this table during the migration window.

CREATE TRIGGER IF NOT EXISTS lp_investors_block_insert
BEFORE INSERT ON lp_investors
BEGIN
    SELECT RAISE(ABORT,
        'lp_investors is sealed (Epic 11). Use limited_partners + vc_funds instead. See backend/app/models/entities.py:LPInvestor docstring for context.'
    );
END;

CREATE TRIGGER IF NOT EXISTS lp_investors_block_update
BEFORE UPDATE ON lp_investors
BEGIN
    SELECT RAISE(ABORT,
        'lp_investors is sealed (Epic 11). Use limited_partners + vc_funds instead.'
    );
END;

INSERT OR IGNORE INTO _migrations (name) VALUES ('lp_investors_seal_v1');
