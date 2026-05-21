-- Admin-managed Service Provider Directory approval.
--
-- Adds two flags + audit columns to the `partners` table:
--   directory_listed     — admin has approved this partner for /directory
--   directory_featured   — admin promotes this partner above standard rows
--   directory_decided_at — ISO timestamp of the most recent admin decision
--   directory_decided_by — admin user_id who flipped the flag last
--
-- D1 does NOT support `ADD COLUMN IF NOT EXISTS`, so this file is intended
-- to be applied exactly once. The worker also carries a lazy
-- `ensurePartnerDirectoryColumns()` PRAGMA-checked helper that adds the
-- columns on first request if this migration has not been run yet — same
-- pattern as `ensureAdvisorWeekColumn()` and `ensureMarketIntelSchema()`.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/063_partner_directory_approval.sql

ALTER TABLE partners ADD COLUMN directory_listed     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partners ADD COLUMN directory_featured   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partners ADD COLUMN directory_decided_at TEXT;
ALTER TABLE partners ADD COLUMN directory_decided_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_partners_directory_listed
  ON partners (directory_listed, directory_featured);
