-- 103_mi_pro_subscriptions.sql
-- Task #6 — Take payments live: move Market Intel Pro subscription state OFF the
-- `users` table and into a side table.
--
-- WHY: the prod `users` table is at Cloudflare D1's hard 100-column limit. Any
-- `ALTER TABLE users ADD COLUMN` (which is how the MI Pro mi_subscription_*
-- columns used to be bootstrapped) throws "too many columns" and re-threw out of
-- the webhook handler, 500ing EVERY Stripe webhook and blocking fulfilment for
-- all products. D1 also rejects any result set wider than 100 columns, so MI Pro
-- state cannot be JOINed into `SELECT * FROM users` either — it is hydrated onto
-- the user object with a separate keyed lookup at auth time.
-- See .agents/memory/d1-users-column-limit.md.

CREATE TABLE IF NOT EXISTS mi_pro_subscriptions (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'free',
  subscription_id TEXT,
  plan TEXT,
  period_end TEXT,
  stripe_customer_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mi_pro_customer ON mi_pro_subscriptions(stripe_customer_id);
-- UNIQUE: a Stripe subscription_id identifies at most one row. The webhook's
-- subscription_id-scoped updates and the cancel handler rely on this invariant.
-- (SQLite allows multiple NULLs, so rows awaiting a subscription_id are fine.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mi_pro_subscription ON mi_pro_subscriptions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_mi_pro_status ON mi_pro_subscriptions(status);
