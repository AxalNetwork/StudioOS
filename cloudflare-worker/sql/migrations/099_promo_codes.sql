-- Task #9 — Promo Code Admin + Checkout.
--
-- D1 mirror of Stripe Coupons + Promotion Codes (Stripe is the source of
-- truth). Admins create promos via /api/admin/promos which proxies a Stripe
-- Coupon (percent_off XOR amount_off) + a Promotion Code (the redeemable
-- string); this table mirrors them for cheap admin lookup + out-of-band
-- redemption accounting at checkout.
--
-- WHY a mirror counter (`times_redeemed`): one-time PaymentIntents do NOT
-- natively redeem Stripe Promotion Codes (coupons only apply to
-- Invoice/Subscription/Checkout flows), so Stripe's own `times_redeemed`
-- never increments for embedded one-time purchases. We therefore enforce
-- usage limits ourselves: the billing webhook records a `promo_redemptions`
-- row (UNIQUE on payment_intent_id → idempotent) and bumps `times_redeemed`
-- only when a row is genuinely inserted. Subscription redemptions still
-- increment Stripe's native counter, so validation sums both.
--
-- D1/SQLite lack ALTER TABLE ... IF NOT EXISTS, so `ensurePromoSchema` in
-- services/promos.ts lazily bootstraps these tables if this migration hasn't
-- been applied; re-running this migration errors harmlessly on existing tables.

CREATE TABLE IF NOT EXISTS promo_codes (
  id               TEXT PRIMARY KEY,              -- Stripe promotion_code id (promo_...)
  code             TEXT NOT NULL,                 -- display code (as entered)
  code_normalized  TEXT NOT NULL,                 -- UPPER(TRIM(code)) — lookup key
  coupon_id        TEXT NOT NULL,                 -- Stripe coupon id (coupon_...)
  percent_off      REAL,                          -- one of percent_off / amount_off
  amount_off       INTEGER,                       -- minor units (cents)
  currency         TEXT,                          -- ISO currency for amount_off
  duration         TEXT NOT NULL DEFAULT 'once',  -- coupon.duration: once|forever|repeating
  product_ids_json TEXT NOT NULL DEFAULT '[]',    -- allow-list of Stripe product ids ([] = all)
  max_redemptions  INTEGER,                       -- usage limit (NULL = unlimited)
  times_redeemed   INTEGER NOT NULL DEFAULT 0,    -- our out-of-band redemption counter
  active           INTEGER NOT NULL DEFAULT 1,
  expires_at       TEXT,                          -- ISO; promotion code expiry (NULL = none)
  created_by       INTEGER,                       -- admin user id who created it
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Codes are matched case-insensitively; normalized code is the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_normalized
  ON promo_codes(code_normalized);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active
  ON promo_codes(active);

-- One row per redemption. `payment_intent_id` is UNIQUE so re-delivered
-- webhooks (paid path) and re-entrant free grants are idempotent. For the
-- free (100%-off) path the id is synthetic: `promo:{promoId}:{userId}` so a
-- given user redeems a given free promo at most once.
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id          TEXT NOT NULL,
  user_id           INTEGER NOT NULL,
  payment_intent_id TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_pi
  ON promo_redemptions(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo
  ON promo_redemptions(promo_id);
