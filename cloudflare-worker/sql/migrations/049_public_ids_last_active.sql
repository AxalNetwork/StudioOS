-- Task #1 (DB) — Admin user-profile detail.
--
-- Idempotent migration. Re-runnable with no errors and no side effects
-- the second time. We deliberately do NOT use `ALTER TABLE ... ADD
-- COLUMN` here because D1 / SQLite have no `IF NOT EXISTS` form for
-- column adds, which would make the file abort on the second run with
-- "duplicate column name". Instead, the new columns are added by
-- runtime PRAGMA-guarded bootstraps that run on every relevant request:
--
--   * users.founder_public_id / partner_public_id —
--       services/publicIds.ts::ensurePublicIdColumns()
--   * users.last_active_at —
--       middleware/lastActive.ts::ensureLastActiveColumn()
--   * admin_audit_log.viewed_user_id / conversation_id / viewed_at —
--       routes/admin.ts::ensureAdminAuditLogTable()
--
-- Each helper PRAGMA-checks the table and only issues `ALTER TABLE
-- ADD COLUMN` for columns that do not yet exist, so partial runs in
-- any environment self-heal.
--
-- This file therefore only creates new tables / indexes (CREATE …
-- IF NOT EXISTS), seeds the id-sequence rows (INSERT OR IGNORE), and
-- is safe to apply against an empty DB, a freshly-bootstrapped DB, or
-- a DB that already has every object below.
--
-- Apply on a new environment via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/049_public_ids_last_active.sql
-- Then optionally backfill ids for legacy rows via the admin endpoint:
--   POST /api/admin/maintenance/public-ids/backfill?limit=5000

-- The unique partial indexes on the new public-id columns are created
-- here AFTER the lazy column-add helper has had a chance to run; if
-- the columns don't yet exist the CREATE INDEX statements fail. We
-- therefore guard them by emitting them only conditionally in app
-- code via ensurePublicIdColumns(), and KEEP THIS FILE limited to
-- objects that don't depend on the new columns. The helper creates
-- the indexes on the same code path.

CREATE TABLE IF NOT EXISTS id_sequences (
  name        TEXT PRIMARY KEY,
  next_value  INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axf', 1);
INSERT OR IGNORE INTO id_sequences (name, next_value) VALUES ('axp', 1);

-- Per-conversation profile-view audit trail with first-class columns.
-- Mirrored into admin_audit_log by routes/admin.ts::auditConversationView
-- so existing Trust-Center oversight reports continue to work, but
-- this table is the SQL-friendly investigator surface ("who looked at
-- whose transcript when").
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
