-- 340 — the firm a recorded transfer was made by (D467, issue #1018).
--
-- `deal_transfers` (migration 335, D462) records a transfer OUT to a company:
-- the deal, the cents, the reference, who recorded it and when. It records no
-- FIRM, and `deals` carries no company by design (migration 194 says why), so
-- a transfer could not be attributed to the firm that made it. D467 decides
-- that IC work is scoped by firm, and the wire is the act that IC work clears.
--
-- WHAT THE ROUTE STAMPS. `POST /api/deals/:id/transfers` writes the firm it
-- can prove, never one it guesses:
--   - the caller's VERIFIED active company (`activeCompanyFor`, checked
--     against `user_company_links`), when the switcher names one;
--   - otherwise the caller's only firm, when they belong to exactly one;
--   - a caller who belongs to several firms and has not chosen one is
--     refused (`transfer_firm_required`) rather than filed under one of them;
--   - a caller who belongs to no firm writes NULL.
--
-- NO BACKFILL. Every row written before this column has no recorded firm, and
-- the recorder's company today is not proof of the company they acted for
-- then. Such a row reads as "Firm not recorded", never as a firm.
--
-- Additive and nullable, so it stands alone. No transaction statements and no
-- PRAGMA (see `scripts/check-sql-migrations.mjs`). Apply through the
-- ledger-driven runner: `npm run d1:migrate:remote`.

ALTER TABLE deal_transfers ADD COLUMN company_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_deal_transfers_company
  ON deal_transfers(company_id);
