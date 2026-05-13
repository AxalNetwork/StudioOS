-- Task #1 (DB) — Admin user-profile detail.
--
-- Adds:
--   * users.founder_public_id / partner_public_id (TEXT, UNIQUE)
--   * users.last_active_at (TIMESTAMP)
--   * id_sequences            — atomic monotonic counters for AXF/AXP
--   * admin_profile_audit     — dedicated per-view audit trail with
--                               first-class columns (admin_user_id,
--                               viewed_user_id, conversation_id,
--                               viewed_at) instead of a JSON blob.
--
-- Idempotency: every CREATE uses IF NOT EXISTS. The three ALTER TABLE
-- ADD COLUMN statements are non-idempotent under D1 (the engine has
-- no IF NOT EXISTS for column adds), so on re-run the engine reports
-- "duplicate column name" on the first ALTER and the file aborts.
-- This is the established pattern in this codebase (see replit.md
-- gotchas) and is mitigated by the lazy bootstraps in code:
--   * services/publicIds.ts::ensurePublicIdColumns()
--   * routes/admin.ts::ensureProfileColumns()
-- which are called on every relevant request and self-heal a fresh
-- dev D1 OR a partially-applied prod D1. New environments should
-- apply this migration once via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/049_public_ids_last_active.sql

ALTER TABLE users ADD COLUMN founder_public_id TEXT;
ALTER TABLE users ADD COLUMN partner_public_id TEXT;
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founder_public_id
  ON users(founder_public_id) WHERE founder_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_partner_public_id
  ON users(partner_public_id) WHERE partner_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_active
  ON users(last_active_at);

CREATE TABLE IF NOT EXISTS id_sequences (
  name        TEXT PRIMARY KEY,
  next_value  INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1);

-- Per-conversation view audit. Distinct from the generic
-- admin_audit_log (which is for export/publication actions); this
-- table is the source of truth for "who looked at whose transcript
-- when" and gives investigators a clean SQL surface.
CREATE TABLE IF NOT EXISTS admin_profile_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id   INTEGER NOT NULL REFERENCES users(id),
  viewed_user_id  INTEGER NOT NULL REFERENCES users(id),
  conversation_id INTEGER,
  action          TEXT NOT NULL,
  viewed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_viewed
  ON admin_profile_audit(viewed_user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_profile_audit_admin
  ON admin_profile_audit(admin_user_id, viewed_at DESC);
