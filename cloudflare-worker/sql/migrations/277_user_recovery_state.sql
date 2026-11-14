-- 277 — the two facts migration 060 could never store, and the one 053 could
-- never store, moved off `users` and onto side tables keyed by user_id.
-- D189. Supersedes nothing; 060 and 053 stay on disk with their ledger rows.
--
-- WHY A SIDE TABLE AND NOT THREE MORE `ADD COLUMN`s.
-- D1 caps a table at 100 columns and `users` is at EXACTLY 100 — measured
-- read-only against production on 2026-09-22 (`SELECT COUNT(*) FROM
-- pragma_table_info('users')` = 100) and on a fresh local build the same day
-- (also 100). cloudflare-worker/src/util/schemaBootstrap.ts's header records
-- the same figure against production from 2026-09-04. Migration 199 hit the
-- cap for real on 2026-09-03 (#413): its `ALTER TABLE users ADD COLUMN`
-- failed with "too many columns on sqlite_altertab_users" and, because the
-- runner is forward-only and ordered, held 200–207 out of production behind
-- it. So an ALTER here would not merely fail — it would strand every later
-- migration. `super_admins` (199, D35) and `user_advisor_extras` (276, D188)
-- are the precedents.
--
-- node:sqlite has NO column cap, so a fresh local build applies 060's and
-- 053's ALTERs happily and reports `users` at 101+ columns. Local succeeds,
-- production fails. That asymmetry is why these three columns were declared
-- in 2025, marked applied by `migrate-d1 --bootstrap` (both files sit below
-- BASELINE_CUTOFF = 219, so they are MARKED and never run), and have been
-- absent from every environment ever since while their ledger rows said
-- otherwise. scripts/check-migration-declarations.mjs (D188) is what finally
-- made them visible.
--
-- WHAT WAS BROKEN, AND IT WAS NOT COSMETIC.
-- `routes/auth_recover.ts:292`'s UPDATE names both 060 columns and is
-- UNGUARDED at all four of its call sites — :425 backup-code, :526
-- sms/verify, :610 email/verify, :783 claim — which is EVERY layer that mints
-- a recovery session. An UPDATE naming a missing column throws (unlike the
-- `SELECT *` in getCurrentUser, which is why the READS were silent), so
-- account recovery returned a 500 on all four layers: a user who had lost
-- their authenticator could not complete recovery by any route. Worse on the
-- backup-code layer, where the single-use code is consumed BEFORE the throw,
-- so the user lost a code and got no session.
-- `routes/settings.ts:563` and `:587` name the column in a SELECT, so the
-- /totp/re-enrol pair — the remediation path that exists precisely for a user
-- who lost their authenticator — threw too.
-- `routes/notifications.ts`'s marketing unsubscribe ran a lazy ALTER that
-- cannot succeed at the cap, then an UPDATE that therefore failed, swallowed
-- by its own catch. An unsubscribe recorded nothing.
--
-- TIMESTAMP FORMATS ARE DELIBERATE AND DIFFERENT, so this header says which.
-- cooling_off_until and step_up_due_at hold ISO-8601 (`inHours`/`inDays` in
-- auth_recover.ts build them with `new Date(...).toISOString()`), and every
-- reader compares them IN JAVASCRIPT — middleware/recoveryCoolOff.ts and
-- auth.ts both do `new Date(x).getTime()` against `Date.now()`. Nothing
-- compares them in SQL, so the ISO-vs-CURRENT_TIMESTAMP trap this repo has
-- been bitten by four times (D124, D125, #588, D143) has no purchase here.
-- Keep it that way: a future SQL predicate over these two columns must wrap
-- both sides in datetime(), because `2026-01-01T00:00:00Z` sorts above
-- `2026-01-01 00:00:00` at position 10 ('T' 0x54 vs ' ' 0x20).
-- unsubscribed_at holds SQLite format, because its only writer used
-- CURRENT_TIMESTAMP and its only reader (services/email/send.ts:117) is a
-- truthiness check that reads either.
--
-- NO BEGIN/COMMIT — D1 rejects transaction control in a migration (the #26
-- lesson). CREATE TABLE IF NOT EXISTS so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS user_recovery_state (
  user_id           INTEGER PRIMARY KEY,
  cooling_off_until TEXT,
  step_up_due_at    TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_marketing_prefs (
  user_id         INTEGER PRIMARY KEY,
  unsubscribed_at TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
