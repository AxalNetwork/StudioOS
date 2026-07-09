-- Explorer completion incentive — one-time 30-day license promo codes.
--
-- Issued when an exploring user completes their track's Problem/Challenge
-- Discovery bank (services/explorerPromo.ts mirrors this DDL for cold DBs).
-- One code per user (user_id UNIQUE), bound to the issued user, single-use
-- (redeemed_at atomic claim), expiring 90 days after issuance. Redemption
-- grants a time-bounded feature_unlocks row — it never touches Stripe, so
-- these rows deliberately live OUTSIDE the Stripe-mirrored promo_codes
-- table (whose lifecycle is tied to real Stripe coupons).

CREATE TABLE IF NOT EXISTS explorer_promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  code TEXT NOT NULL UNIQUE,
  track TEXT NOT NULL,                  -- founder | investor | advisor | partner
  feature_key TEXT NOT NULL,            -- feature_unlocks key the redemption grants
  license_label TEXT NOT NULL,          -- human label shown in chat + receipt
  unlock_days INTEGER NOT NULL DEFAULT 30,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,                      -- code redemption deadline (issued + 90d)
  redeemed_at TEXT
);
