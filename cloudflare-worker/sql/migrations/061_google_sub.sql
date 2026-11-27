-- Task #51 — "Continue with Google" sign-in / sign-up.
--
-- Adds an OPTIONAL Google identity link to existing user rows. The column
-- is nullable so accounts that only use magic-link / TOTP / SMS remain
-- unchanged. The partial unique index enforces "one Axal account per
-- Google sub" without forcing every row to carry a value (SQLite/D1
-- supports partial indexes via the WHERE clause; full-table UNIQUE
-- would have failed at scale because hundreds of legacy rows have
-- NULL google_sub and SQLite treats multiple NULLs as distinct under
-- a partial index, which is exactly the semantics we want).
--
-- Per the Task #51 spec, Google sign-in counts as ONE factor only.
-- Sensitive routes still demand TOTP/passkey/SMS step-up via
-- requireFactor() — see middleware/recoveryCoolOff and routes/auth.ts.
-- Adding google_sub does NOT relax any factor gate.
--
-- One-shot ALTER (SQLite/D1 does NOT support `ADD COLUMN IF NOT EXISTS`,
-- so the ALTER below will error with "duplicate column name" on a second
-- apply — that error is safe to ignore and is the same pattern used by
-- prior migrations 011/039/etc. The partial unique index uses
-- `IF NOT EXISTS` so a re-run after a failed ALTER never breaks the
-- index step. The route ALSO carries a runtime/schema-bootstrap safety
-- net — if the column is missing at request time the worker logs the
-- discrepancy via console.error rather than 500-ing every signup —
-- matching the `ensureAdvisorWeekColumn()` / `ensureMarketIntelSchema()`
-- pattern documented in replit.md.
ALTER TABLE users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
  ON users(google_sub)
  WHERE google_sub IS NOT NULL;
