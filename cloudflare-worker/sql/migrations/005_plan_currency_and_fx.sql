-- Task #14 — Multi-currency MRR/ARR.
--
-- Subscription plans previously stored only `monthly_price_usd`, which loses
-- fidelity the moment a plan is sold in EUR/GBP/etc.: Stripe charges in the
-- native currency but our analytics rounded everything to USD on the way in.
-- This migration:
--   1. Records the original Stripe currency + native amount alongside the USD
--      figure on every plan row, so MRR can later be displayed in any
--      currency without re-querying Stripe.
--   2. Adds a small `fx_rates` lookup so `?currency=EUR` style queries on the
--      Admin Analytics endpoints can convert at a single, auditable as-of
--      rate (admin updates by editing the row directly).
--
-- Apply via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/005_plan_currency_and_fx.sql --remote --env=""
--
-- Re-runs will print "duplicate column name" on the 3 ALTERs, which is the
-- standard idempotent-ALTER pattern used elsewhere in the worker schema.

ALTER TABLE subscription_plans ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE subscription_plans ADD COLUMN native_amount REAL;        -- per-billing-period in native currency
ALTER TABLE subscription_plans ADD COLUMN native_interval TEXT;      -- 'month' | 'year' | 'week' | 'day'

CREATE TABLE IF NOT EXISTS fx_rates (
    currency   TEXT PRIMARY KEY,            -- ISO 4217 (USD, EUR, GBP, ...)
    usd_rate   REAL NOT NULL,               -- 1 USD = `usd_rate` <currency>
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed a small starter set so /financial?currency=EUR works out of the box.
-- These are mid-2026 illustrative values — admins should refresh them via
-- their preferred FX feed (the as-of timestamp surfaces in the API response).
INSERT OR IGNORE INTO fx_rates (currency, usd_rate) VALUES
  ('USD', 1.0000),
  ('EUR', 0.9200),
  ('GBP', 0.7900),
  ('CAD', 1.3700),
  ('AUD', 1.5200),
  ('JPY', 152.0000),
  ('INR', 83.5000),
  ('SGD', 1.3500),
  ('CHF', 0.8800),
  ('SEK', 10.4000);
