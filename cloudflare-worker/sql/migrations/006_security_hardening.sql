-- Task #33 — Security hardening + safe Cloudflare storage.
--
-- Apply via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/006_security_hardening.sql --remote --env=""
--
-- Idempotent. Re-runs will report "duplicate column" on the ALTERs, which
-- D1 surfaces as an error that aborts the transaction. The worker's lazy
-- ensureSchema() in services/authTotp.ts catches each ALTER individually
-- and ignores duplicate-column errors, so prod boots fine even if this
-- migration was already applied piecemeal. Treat the .sql file as the
-- canonical record; the runtime ensureSchema is the safety net.

-- 1) Dedicated TOTP secret store. See services/authTotp.ts for the lazy
--    migration path off the legacy users.password_hash misuse.
CREATE TABLE IF NOT EXISTS auth_totp (
  user_id          INTEGER PRIMARY KEY,
  secret_ct        TEXT NOT NULL,                       -- AES-GCM ciphertext (AAD-bound)
  recovery_hashes  TEXT NOT NULL DEFAULT '[]',          -- JSON array of SHA-256 hex
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at     TEXT
);

-- 2) Force-reset flag for users whose legacy password_hash got overwritten
--    with a base32 TOTP secret. Login route honours this.
ALTER TABLE users ADD COLUMN password_reset_required INTEGER NOT NULL DEFAULT 0;
