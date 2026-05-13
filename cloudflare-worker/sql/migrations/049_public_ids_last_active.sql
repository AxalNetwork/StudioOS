-- Task #1 (DB) — Admin user-profile detail.
--
-- Adds public-facing FOUNDER_ID / PARTNER_ID columns and a
-- last_active_at index. The columns themselves on `users` are
-- created lazily by ensureProfileColumns() in routes/admin.ts so
-- this migration is safe-to-rerun on environments that already
-- self-healed.
--
-- AXF-/AXP- IDs are TEXT (Crockford-base32 of an opaque sequence)
-- and are populated by services/publicIds.ts. They are NOT FKs to
-- founders/partners — those are the existing INTEGER `users.founder_id`
-- and `users.partner_id` columns. The new TEXT columns are the
-- public, contract-merge-field-safe identifiers.

ALTER TABLE users ADD COLUMN founder_public_id TEXT;
ALTER TABLE users ADD COLUMN partner_public_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founder_public_id
  ON users(founder_public_id) WHERE founder_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_partner_public_id
  ON users(partner_public_id) WHERE partner_public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_active
  ON users(last_active_at);
