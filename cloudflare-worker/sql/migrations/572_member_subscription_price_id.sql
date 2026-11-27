-- 572 — the Stripe price each member subscription is charged at (D1010, #2829).
-- Reserved for D1010 on #2829 (from S21's D1008 integration), 2026-10-24.
--
-- `member_subscription_amounts` (migration 505) records each member plan's
-- charge from the subscription webhook, but not which price it is: two plans
-- in one family (Validate + Build and Raise + Grow are both `founder`) cannot
-- be told apart, so Payments could count members per family and interval,
-- never per price. The same webhook write (`recordSubscriptionAmount`, from
-- `customer.subscription.created` and `updated`) now stores the first item's
-- price id beside the amount.
--
-- NULL on every row written before this migration, and on a subscription
-- whose items carry no price id. Nothing is backfilled: a row gains its price
-- the next time Stripe sends an update for it. Payments counts those rows
-- apart ("price not recorded"), never as any one price.
--
-- Grep first (D689 D-t): `price_id` is not a column of
-- `member_subscription_amounts` in any earlier migration or the baseline.
ALTER TABLE member_subscription_amounts ADD COLUMN price_id TEXT;

CREATE INDEX IF NOT EXISTS idx_member_subscription_amounts_price
  ON member_subscription_amounts (price_id, status);
