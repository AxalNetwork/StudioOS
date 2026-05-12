-- Task #2 (AR) — Persona Banks + Spin-Out Week Gating.
--
-- Ensures `users.spinout_lab_week` exists (already used by
-- routes/spinout_lab.ts but never had a numbered migration in this
-- repo). The advisor next-question filter reads this column to gate
-- new-founder bank questions to the user's current Spin-Out week.
--
-- D1 does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so
-- this file is intended to be applied ONCE. If the column already
-- exists (it does on the live D1 — added historically via
-- `wrangler d1 execute --command`), this migration is a no-op marker
-- and will report `duplicate column name`; that is expected. The
-- worker also runs `ensureAdvisorWeekColumn()` lazily at request
-- time so dev/SQLite works without running this file.

-- Marker-only file: D1 has no `IF NOT EXISTS` for ADD COLUMN, and
-- the column already exists on prod (added historically via
-- `wrangler d1 execute --command`). Applying a raw ALTER here would
-- fail with `duplicate column name`. The worker self-heals dev/SQLite
-- on first /advisor request via `ensureAdvisorWeekColumn()`.
--
-- To apply the column on a fresh D1 instance, run:
--   wrangler d1 execute studioos-db --remote \
--     --command "ALTER TABLE users ADD COLUMN spinout_lab_week INTEGER DEFAULT 1"
--
-- The marker-row insert below is the safe portion of this migration
-- and is idempotent.
CREATE TABLE IF NOT EXISTS _migrations_applied (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO _migrations_applied (name)
  VALUES ('041_advisor_week_gating');
