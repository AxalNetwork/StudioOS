-- Task #4 — Invite tracking & reminders
-- Adds per-invite reminder counters so /api/email/invites/:id/remind can
-- enforce the "1 reminder per invite per 7 days" rule and the UI can show
-- e.g. "Reminded 2× — last on Mar 3".
--
-- Note (apply order): the `045_*` slot is already taken by
-- 045_admin_publications.sql, so this migration is numbered 046.
--
-- Idempotent re-run note: ALTER TABLE … ADD COLUMN is NOT idempotent in
-- D1/SQLite; re-running this file will fail at the first ALTER once the
-- column exists. The lazy `ensureSchema()` in routes/email.ts wraps each
-- ALTER in try/catch so dev/stale envs self-heal on first request.

ALTER TABLE referral_invites ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE referral_invites ADD COLUMN last_reminded_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_invites_signed_up_user ON referral_invites(signed_up_user_id);
