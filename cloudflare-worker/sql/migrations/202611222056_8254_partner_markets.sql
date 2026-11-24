-- D8254 (#8254): which markets a growth partner works. A link is a plan, not history: it goes when the partner or the
-- market does (ON DELETE CASCADE, which D1 enforces). Both rows belong to one venture; the Worker checks that before
-- it writes. A partner linked to no market is simply not linked.
CREATE TABLE IF NOT EXISTS growth_partner_markets (
  partner_id INTEGER NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (partner_id, market_id)
);
CREATE INDEX IF NOT EXISTS idx_growth_partner_markets_market ON growth_partner_markets(market_id);
