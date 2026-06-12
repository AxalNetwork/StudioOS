-- Task — Stripe-backed Product Catalog.
--
-- D1 mirror of the Stripe Products + Prices catalog. Stripe is the source of
-- truth; this table is a cache/mirror repopulated by the catalog sync service
-- (`services/catalog.ts`) via `POST /api/admin/catalog/sync`. The read path
-- (`GET /api/catalog/products`) serves from here so the rest of the payments
-- overhaul reads SKUs from one place instead of the scattered STRIPE_PRICE_*
-- env vars.
--
-- Caveat: D1/SQLite lack ALTER TABLE ... IF NOT EXISTS. The in-code lazy
-- bootstrap (`ensureCatalogSchema`) creates this table on first run if this
-- migration hasn't been applied yet; re-running this migration errors
-- harmlessly on an already-existing table.

CREATE TABLE IF NOT EXISTS stripe_products (
  id           TEXT PRIMARY KEY,            -- Stripe Product id (prod_...)
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'alacarte', -- subscription | incorporation | session | alacarte
  active       INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}', -- Stripe product metadata
  prices_json  TEXT NOT NULL DEFAULT '[]',  -- array of normalised prices
  synced_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_products_kind ON stripe_products(kind);
CREATE INDEX IF NOT EXISTS idx_stripe_products_active ON stripe_products(active);
