-- Migration 152 — One-time CART ORDER support (products cart/checkout).
--
-- A cart order combines one or more `one_time` catalog SKUs into a SINGLE
-- combined PaymentIntent. Prices come from the mirrored Stripe catalog
-- (stripe_products); VAT (5% UAE) and promo discounts are recomputed
-- server-side. Fulfilment (Stripe webhook payment_intent.succeeded with
-- metadata.kind='cart_order', or POST /api/orders/confirm) marks the order
-- paid, grants user_products, records the promo redemption, renders a PDF
-- invoice and emails the buyer — idempotent on order_ref.
--
-- Apply via:
--   wrangler d1 execute studioos-db \
--     --file=cloudflare-worker/sql/migrations/152_cart_orders.sql \
--     --remote --env=""
--
-- All statements use IF NOT EXISTS so re-runs are no-ops. Also bootstrapped at
-- runtime by services/orders.ts::ensureOrdersSchema for dev/preview self-heal.

CREATE TABLE IF NOT EXISTS orders (
    id                TEXT PRIMARY KEY,
    order_ref         TEXT NOT NULL UNIQUE,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    currency          TEXT NOT NULL DEFAULT 'usd',
    subtotal_cents    INTEGER NOT NULL DEFAULT 0,
    discount_cents    INTEGER NOT NULL DEFAULT 0,
    vat_cents         INTEGER NOT NULL DEFAULT 0,
    total_cents       INTEGER NOT NULL DEFAULT 0,
    promo_code        TEXT,
    billing_country   TEXT,
    payment_intent_id TEXT,
    items_json        TEXT NOT NULL DEFAULT '[]',
    invoice_number    TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pi
    ON orders(payment_intent_id) WHERE payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_products (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    order_ref    TEXT NOT NULL REFERENCES orders(order_ref),
    product_id   TEXT,
    price_id     TEXT,
    kind         TEXT,
    label        TEXT,
    quantity     INTEGER NOT NULL DEFAULT 1,
    activated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_products_user  ON user_products(user_id);
CREATE INDEX IF NOT EXISTS idx_user_products_order ON user_products(order_ref);
