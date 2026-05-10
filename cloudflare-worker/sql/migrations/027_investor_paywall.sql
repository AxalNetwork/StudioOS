-- Task #6 (W-1) — Investor paywall: tier columns + seats + intros + dealroom membership.
--
-- Tiers: free | professional | institutional. Default 'free' so existing
-- investor rows keep working; new signups are flipped to 'professional'
-- with a 14-day trial in routes/auth.ts. The cron in index.ts downgrades
-- expired trials nightly.
--
-- All ALTERs are wrapped in IF NOT EXISTS-style guards via the runtime
-- bootstrap in middleware/requireInvestorTier.ts so this file is the
-- canonical record only — re-runs error harmlessly on duplicate-column.

ALTER TABLE users ADD COLUMN investor_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN investor_subscription_status TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN investor_trial_ends_at TIMESTAMP;
ALTER TABLE users ADD COLUMN investor_subscription_renews_at TIMESTAMP;
ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN investor_stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN investor_seat_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN investor_quota_intros_quarter TEXT;
ALTER TABLE users ADD COLUMN investor_quota_intros_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN investor_dealroom_max INTEGER NOT NULL DEFAULT 5;
ALTER TABLE users ADD COLUMN investor_seat_primary_user_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_investor_tier ON users(investor_tier);
CREATE INDEX IF NOT EXISTS idx_users_investor_trial ON users(investor_trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_users_investor_seat_primary ON users(investor_seat_primary_user_id);
CREATE INDEX IF NOT EXISTS idx_users_investor_stripe_cust ON users(investor_stripe_customer_id);

CREATE TABLE IF NOT EXISTS investor_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_user_id INTEGER NOT NULL,
  seat_email TEXT NOT NULL,
  seat_user_id INTEGER,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  invite_token TEXT,
  UNIQUE(primary_user_id, seat_email)
);
CREATE INDEX IF NOT EXISTS idx_investor_seats_primary ON investor_seats(primary_user_id);
CREATE INDEX IF NOT EXISTS idx_investor_seats_email ON investor_seats(seat_email);
CREATE INDEX IF NOT EXISTS idx_investor_seats_token ON investor_seats(invite_token);

CREATE TABLE IF NOT EXISTS investor_introductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  investor_user_id INTEGER NOT NULL,
  founder_user_id INTEGER,
  founder_id INTEGER,
  project_id INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  quarter TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_intros_investor ON investor_introductions(investor_user_id);
CREATE INDEX IF NOT EXISTS idx_intros_quarter ON investor_introductions(investor_user_id, quarter);

CREATE TABLE IF NOT EXISTS investor_dealroom_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_user_id INTEGER NOT NULL,
  deal_id INTEGER NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(investor_user_id, deal_id)
);
CREATE INDEX IF NOT EXISTS idx_dealroom_investor ON investor_dealroom_members(investor_user_id);
