-- Epic 6 — Market Intel free vs Pro paywall.
-- D1/SQLite migration. Mirrored at runtime by `ensureMiPaywallSchema()`
-- in cloudflare-worker/src/middleware/miAccess.ts and by
-- `ensure_mi_paywall_columns()` in backend/app/models/migrations.py so
-- both backends boot with the same columns.

ALTER TABLE users ADD COLUMN mi_subscription_status TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN mi_subscription_id TEXT;
ALTER TABLE users ADD COLUMN mi_subscription_plan TEXT;
ALTER TABLE users ADD COLUMN mi_subscription_period_end TIMESTAMP;
ALTER TABLE users ADD COLUMN mi_stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_mi_status ON users(mi_subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_mi_customer ON users(mi_stripe_customer_id);
