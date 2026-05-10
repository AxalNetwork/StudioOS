-- Task #6 — Founder subscription tiers (FREE / GROWTH / STUDIO).
--
-- Layered ON TOP OF the existing Market Intel Pro columns (mi_*) which gate a
-- different product (sector intel) — DO NOT collapse the two. `subscription_tier`
-- gates founder workspace features (Build/Validate/Capital/Legal/Network).
--
-- Apply via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/011_subscription_tiers.sql --remote --env=""
--
-- Re-runs report "duplicate column name" on each ALTER (D1 rolls the file back
-- but every statement is safe-by-design via ensureTierSchema() at boot).

ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN subscription_renews_at TIMESTAMP;
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_subscription_tier   ON users(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer     ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id);
