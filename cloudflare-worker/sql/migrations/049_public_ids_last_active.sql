-- Task #1 (DB) — Admin user-profile detail.
--
-- Adds the three new `users` columns (founder_public_id,
-- partner_public_id, last_active_at), the id_sequences counter table,
-- and the dedicated admin_profile_audit per-view trail.
--
-- Idempotency strategy:
--   * CREATE TABLE / INDEX statements all use IF NOT EXISTS — safe.
--   * The three `ALTER TABLE users ADD COLUMN` statements have no
--     native IF NOT EXISTS form in SQLite/D1, so on a SECOND apply the
--     engine reports "duplicate column name" and the file aborts. To
--     keep the migration deterministically safe to re-run, the column
--     adds are also performed at runtime by a PRAGMA-guarded helper
--     (services/publicIds.ts::ensurePublicIdColumns), which is invoked
--     by every assign / select call site BEFORE it touches the new
--     columns. Operators apply this file ONCE on a fresh prod DB; the
--     runtime helper covers re-applies, dev, preview, and any partial
--     prod state.
--
-- Apply on a new environment via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/049_public_ids_last_active.sql
-- Then optionally backfill ids for legacy rows via the admin endpoint:
--   POST /api/admin/maintenance/public-ids/backfill?limit=5000

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

-- Per-conversation profile-view audit trail with first-class columns.
-- routes/admin.ts::auditConversationView writes a row HERE for the
-- SQL-friendly investigator surface AND mirrors the same data into
-- admin_audit_log.{viewed_user_id,conversation_id,viewed_at} for the
-- canonical Trust-Center oversight reports.
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
