-- Task #8 — Universal Referral Attribution + Commission.
--
-- First-touch referral attribution for PURCHASES (any SKU), distinct from the
-- registration-time `referrals` table. A visitor arriving with `?ref=CODE`
-- gets that code persisted (client cookie); the first time they create a
-- PaymentIntent while signed in we record a first-touch row here (30-day
-- window) and stamp `metadata.referral_code` + `metadata.referrer_user_id`
-- onto the PI. On payment_intent.succeeded the billing webhook reads the
-- product's `commission_pct` and queues a post-charge Connect transfer.
--
-- first-touch-wins: user_id is UNIQUE, so INSERT OR IGNORE keeps the earliest
-- attribution for a buyer (matching the existing 30-day refund/attribution
-- window used by the payouts approval engine).
--
-- D1/SQLite lack ALTER TABLE ... IF NOT EXISTS, so `ensureAttributionSchema`
-- in services/referralAttribution.ts lazily bootstraps this table when this
-- migration hasn't been applied; re-running the migration is harmless.

CREATE TABLE IF NOT EXISTS referral_attributions (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                     INTEGER NOT NULL UNIQUE,   -- buyer; first-touch wins
  referral_code               TEXT NOT NULL,             -- normalized code captured
  referrer_user_id            INTEGER NOT NULL,          -- resolved referrer
  first_touch_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at                  TIMESTAMP NOT NULL,        -- first_touch + 30d
  converted_payment_intent_id TEXT,                      -- first PI that earned
  converted_at                TIMESTAMP,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
  ON referral_attributions(referrer_user_id);
