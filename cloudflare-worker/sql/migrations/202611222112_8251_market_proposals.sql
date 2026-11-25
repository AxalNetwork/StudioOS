-- D8251 (#8251, GR-24): what Eadwyn proposes for a market, stored until the founder decides. A proposal is a score
-- for one part with its source, a drafted entry plan, or a written comparison; nothing reaches the market's own
-- fields until the founder accepts, and accepting writes through the market's Edit path, never from this table.
-- It goes with its market (ON DELETE CASCADE). `payload` and `sources` are JSON the Worker validates before it writes.
CREATE TABLE IF NOT EXISTS market_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('score', 'plan', 'comparison')),
  payload TEXT NOT NULL,
  sources TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'accepted', 'dismissed')),
  proposed_by TEXT NOT NULL DEFAULT 'eadwyn',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by INTEGER,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_proposals_market ON market_proposals(market_id, state);
