-- Migration 058 — Refer & Earn Payouts via Stripe Connect (Task #9)
--
-- Adds the per-user Stripe Connect Express columns used to gate payouts
-- and the `referral_payouts` lifecycle ledger (pending → approved → paid
-- → reversed). One row per commission/redemption.
--
-- Idempotent on a fresh DB (CREATE … IF NOT EXISTS); the four ALTER TABLE
-- statements at the top are NOT idempotent on re-run — the worker route
-- (`ensureReferralPayoutsSchema`) lazily ALTERs the same columns on first
-- request so dev DBs and preview deploys self-heal.

ALTER TABLE users ADD COLUMN stripe_connect_account_id TEXT;
ALTER TABLE users ADD COLUMN stripe_connect_charges_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN stripe_connect_payouts_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN stripe_connect_verification_status TEXT;
ALTER TABLE users ADD COLUMN stripe_connect_country TEXT;
ALTER TABLE users ADD COLUMN stripe_connect_last_synced_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_stripe_connect_account_id
  ON users(stripe_connect_account_id);

CREATE TABLE IF NOT EXISTS referral_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_user_id INTEGER NOT NULL,
  redemption_id    INTEGER NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|paid|reversed|blocked
  block_reason TEXT,
  stripe_transfer_id TEXT,
  stripe_destination TEXT,
  paid_by_admin_id INTEGER,
  earned_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  paid_at     TIMESTAMP,
  reversed_at TIMESTAMP,
  failure_reason TEXT,
  UNIQUE(redemption_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_referrer
  ON referral_payouts(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_status
  ON referral_payouts(status);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_transfer
  ON referral_payouts(stripe_transfer_id);
