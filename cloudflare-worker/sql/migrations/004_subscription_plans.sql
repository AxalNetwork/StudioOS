-- Task #11 — Subscription plan catalog.
-- Decouples analytics MRR/ARR from the hardcoded `PLAN_MONTHLY_USD` map in
-- `cloudflare-worker/src/services/analyticsReports.ts` so that adding a new
-- plan in Stripe (or via the admin endpoint) reflects in MRR/ARR immediately
-- without a code change.
--
-- The Stripe webhook upserts a row here on every
-- `customer.subscription.created|updated` event using the line-item price's
-- `unit_amount` + `recurring.interval`, so plans launched in Stripe register
-- automatically the first time anyone subscribes.
--
-- Apply via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/004_subscription_plans.sql --remote --env=""

CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id           TEXT PRIMARY KEY,           -- matches users.mi_subscription_plan
    monthly_price_usd REAL NOT NULL,              -- normalised to $/month for MRR math
    display_name      TEXT,
    stripe_price_id   TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sub_plans_active ON subscription_plans(is_active);

-- Seed the two plans previously hardcoded in PLAN_MONTHLY_USD. INSERT OR IGNORE
-- so re-running the migration is a no-op (and so admins can edit prices later
-- without the seed clobbering them on the next boot-time ensureSchema call).
INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name)
VALUES
  ('mi_pro_monthly', 49, 'MI Pro · Monthly'),
  ('mi_pro_annual',  39, 'MI Pro · Annual');
