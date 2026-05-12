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

ALTER TABLE users ADD COLUMN spinout_lab_week INTEGER;
