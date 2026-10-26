-- 631 — Promo codes part 4 (D1274, #3300): what each redemption was for.
-- Assigned to #3300 by S21 for S1.
--
-- `promo_redemptions` (099) held only the code, the member, the payment
-- reference and the time. HQ's Usage tab (PRM7) and a code's Redemptions frame
-- (PRM2b) need what was bought, at what price, what the code took off, and
-- how it was paid. These columns say so for every redemption from now on.
--
--   source              cart | payment | free_unlock | subscription
--   product_id          the catalog product, when the redemption was for one
--                       product (a cart of several records none)
--   price_id            the catalog price, likewise
--   billing_interval    month | year | week | day for a subscription; NULL
--                       for a one-time charge
--   amount_before_cents what the member would have paid without the code
--   discount_cents      what the code took off (a free unlock: the whole price)
--   currency            the ISO code, lower case
--
-- SUBSCRIPTIONS. Stripe redeems a promotion code on a subscription natively
-- and counts it in its own `times_redeemed`. The billing webhook now records
-- the first paid invoice of such a subscription here with source
-- 'subscription', keyed `sub:<subscription id>` in `payment_intent_id`, so it
-- is recorded once. It does NOT bump `promo_codes.times_redeemed`: checkout's
-- cap adds Stripe's counter to the mirror's, so bumping both would count it
-- twice.
--
-- ADDITIVE. Every column is nullable and nothing is backfilled: a redemption
-- made before this migration has no recorded source, product or amount, and
-- the reads say "Not recorded" for it rather than inventing one.
ALTER TABLE promo_redemptions ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('cart', 'payment', 'free_unlock', 'subscription'));
ALTER TABLE promo_redemptions ADD COLUMN product_id TEXT;
ALTER TABLE promo_redemptions ADD COLUMN price_id TEXT;
ALTER TABLE promo_redemptions ADD COLUMN billing_interval TEXT
  CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year'));
ALTER TABLE promo_redemptions ADD COLUMN amount_before_cents INTEGER
  CHECK (amount_before_cents IS NULL OR amount_before_cents >= 0);
ALTER TABLE promo_redemptions ADD COLUMN discount_cents INTEGER
  CHECK (discount_cents IS NULL OR discount_cents >= 0);
ALTER TABLE promo_redemptions ADD COLUMN currency TEXT;

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_created ON promo_redemptions(created_at);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_created ON promo_redemptions(promo_id, created_at);
