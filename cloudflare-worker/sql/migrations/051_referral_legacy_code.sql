-- 051_referral_legacy_code.sql
-- Task #4 (DH) — Referral-code short form (with back-compat).
--
-- Adds users.legacy_referral_code (nullable, indexed) and migrates every
-- existing AXAL-XXXXXXXX user code to the new 6-char short form, copying
-- the original to legacy_referral_code so historical invite URLs continue
-- to resolve via services/referrals/resolveCode.ts.
--
-- D1 forbids BEGIN/COMMIT in raw SQL (use --command per statement when
-- applying remotely):
--   wrangler d1 execute studioos-db --remote --command="ALTER TABLE users ADD COLUMN legacy_referral_code TEXT"
--   wrangler d1 execute studioos-db --remote --command="UPDATE users SET legacy_referral_code = referral_code WHERE referral_code LIKE 'AXAL-%' AND legacy_referral_code IS NULL"
--   wrangler d1 execute studioos-db --remote --command="UPDATE users SET referral_code = SUBSTR(referral_code, 6, 6) WHERE referral_code LIKE 'AXAL-%'"
--   wrangler d1 execute studioos-db --remote --command="CREATE INDEX IF NOT EXISTS idx_users_legacy_referral_code ON users(legacy_referral_code)"
--
-- Re-running ALTER on a DB that already has the column will fail with
-- "duplicate column"; that's expected and a no-op for the rest of the file.
-- The runtime ensureSchema() in routes/network.ts also creates the column
-- defensively so dev/SQLite stays self-healing.
--
-- Truncating the original 8-char AXAL- suffix to 6 chars carries a small
-- collision risk (~few users per million for the current alphabet). The
-- runtime path in ensureReferralCode() detects collisions on read and
-- regenerates a fresh short code via generateUniqueShortReferralCode().

ALTER TABLE users ADD COLUMN legacy_referral_code TEXT;
UPDATE users SET legacy_referral_code = referral_code WHERE referral_code LIKE 'AXAL-%' AND legacy_referral_code IS NULL;
UPDATE users SET referral_code = SUBSTR(referral_code, 6, 6) WHERE referral_code LIKE 'AXAL-%';
CREATE INDEX IF NOT EXISTS idx_users_legacy_referral_code ON users(legacy_referral_code);
