-- 505 — what each member pays for each subscription (D783, #2124).
--
-- A plan includes 25% of its price as AI allowance each month. The price that
-- counts is the one on the member's own subscription, so a discounted or
-- grandfathered price counts as paid. No mirror kept it: `users`' tier
-- columns, `mi_pro_subscriptions` and `account_subscriptions` hold the plan's
-- name and status only. The `customer.subscription.created`, `updated` and
-- `deleted` webhook writes this table from the price Stripe already sends
-- (`services/planAllowance.ts`).
--
-- One row per Stripe subscription. `amount_cents` is the sum of
-- `unit_amount × quantity` over the subscription's items at its interval;
-- `interval` and `interval_count` say how often it is charged. A canceled
-- subscription stays canceled: Stripe never reactivates one.
--
-- Only member plans are recorded (founder, investor, Market Intelligence and
-- persona plans). Registered Agent is a company service and gives no allowance.
-- Additive and idempotent. No row is seeded: a subscriber with no row yet falls
-- back to the catalogue's current price for their recorded plan.
CREATE TABLE IF NOT EXISTS member_subscription_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  plan_family TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT,
  interval TEXT NOT NULL,
  interval_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_subscription_amounts_user
  ON member_subscription_amounts (user_id, status);
