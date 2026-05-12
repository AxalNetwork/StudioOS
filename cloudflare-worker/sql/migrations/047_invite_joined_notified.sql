-- Task #10 — Notify inviters when a recipient joins via their link.
--
-- Adds a per-invite `joined_notified_at` timestamp so attachReferral()
-- can fire its "X just joined via your invite" notification exactly
-- once per recipient, even if the user re-registers, the row is
-- backfilled later by /api/email/invites, or attachReferral runs
-- twice for any reason. The column is set to CURRENT_TIMESTAMP at
-- the same time the notification is dispatched.
--
-- Idempotent re-run note: ALTER TABLE … ADD COLUMN is NOT idempotent
-- in D1/SQLite; re-running this file will fail with a duplicate-column
-- error once the column exists. The lazy `ensureSchema()` in
-- routes/email.ts wraps each ALTER in try/catch so dev/stale envs
-- self-heal on first request to the invites surface.

ALTER TABLE referral_invites ADD COLUMN joined_notified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_invites_joined_notified
  ON referral_invites(joined_notified_at);
