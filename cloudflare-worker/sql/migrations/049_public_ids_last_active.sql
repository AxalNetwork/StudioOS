-- Task #1 (DB) — Admin user-profile detail.
--
-- FULLY IDEMPOTENT MIGRATION. Re-runnable any number of times with no
-- errors and no side effects after the first apply.
--
-- The three new `users` columns (founder_public_id, partner_public_id,
-- last_active_at) are added by a PRAGMA-guarded runtime helper rather
-- than by raw `ALTER TABLE ... ADD COLUMN` statements in this file.
-- SQLite/D1 has no native `ADD COLUMN IF NOT EXISTS` form, so emitting
-- bare ALTERs would abort the file on re-run with "duplicate column
-- name". Instead, the columns are guaranteed by:
--
--   * services/publicIds.ts::ensurePublicIdColumns() — PRAGMA
--       table_info() probe + conditional ALTER + index creation. Called
--       at the top of every assign / select code path BEFORE the
--       columns are referenced (see assignPublicId, esign envelope
--       counterparty seeding, /api/admin/users/:id/profile).
--   * middleware/lastActive.ts::ensureLastActiveColumn() — same pattern
--       for the last_active_at column; runs on every authenticated
--       request before the throttled UPDATE.
--   * routes/admin.ts::ensureAdminAuditLogTable() — same pattern for the
--       three new admin_audit_log transcript-view columns
--       (viewed_user_id, conversation_id, viewed_at).
--
-- The CANONICAL schema baseline lives in cloudflare-worker/sql/schema.sql,
-- which DOES declare the new columns inline on `CREATE TABLE users` so
-- a fresh `wrangler d1 execute --file=schema.sql` bootstrap produces
-- the correct shape without any runtime side effects. This migration
-- file is for upgrading an EXISTING D1 instance: it creates the
-- supporting tables (id_sequences, admin_profile_audit) and seeds the
-- counter rows. The runtime helpers cover the column-add side. Running
-- the file again is a no-op because every CREATE uses `IF NOT EXISTS`
-- and every counter-row INSERT uses `INSERT OR IGNORE`.
--
-- Apply on a new environment via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/049_public_ids_last_active.sql
-- Then optionally backfill ids for legacy rows via the admin endpoint:
--   POST /api/admin/maintenance/public-ids/backfill?limit=5000

CREATE TABLE IF NOT EXISTS id_sequences (
  name        TEXT PRIMARY KEY,
  next_value  INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1);

-- Per-conversation profile-view audit trail with first-class columns.
-- routes/admin.ts::auditConversationView writes a row HERE for the
-- SQL-friendly investigator surface AND mirrors the same data into
-- admin_audit_log.{viewed_user_id, conversation_id, viewed_at} for the
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
