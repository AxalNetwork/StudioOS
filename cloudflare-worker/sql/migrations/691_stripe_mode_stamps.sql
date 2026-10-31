-- D1433/D1434 (#3703): Stripe modes, event receipts and the owner cutover audit.
-- S1 verified that the pre-691 catalogue was written with the sandbox key
-- (654_token_packs_on_sale.sql). Only those existing rows are backfilled.
-- Later unstamped rows remain NULL and cannot be sold.
ALTER TABLE stripe_products ADD COLUMN livemode INTEGER;
UPDATE stripe_products SET livemode = 0 WHERE livemode IS NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_products_livemode ON stripe_products(livemode);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  livemode INTEGER NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT,
  processing_uid TEXT,
  processing_until TEXT
);

CREATE TABLE IF NOT EXISTS stripe_mode_cutovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_mode TEXT NOT NULL CHECK (from_mode IN ('test', 'live')),
  to_mode TEXT NOT NULL CHECK (to_mode IN ('test', 'live')),
  actor_user_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  customers_cleared INTEGER NOT NULL,
  subscriptions_cleared INTEGER NOT NULL,
  plans_reset INTEGER NOT NULL,
  mirror_rows_dropped INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
