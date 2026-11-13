-- D627: dated USD position marks. Existing portfolio_positions.fund_id is the attribution.
-- No backfill: invested cost is not fair value, and missing marks remain unknown.
CREATE TABLE IF NOT EXISTS fund_position_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  position_id INTEGER NOT NULL REFERENCES portfolio_positions(id),
  valuation_date TEXT NOT NULL,
  value_cents INTEGER NOT NULL CHECK(typeof(value_cents) = 'integer' AND value_cents >= 0),
  source TEXT NOT NULL CHECK(length(trim(source)) BETWEEN 1 AND 500),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fund_position_valuations_latest
  ON fund_position_valuations(position_id, valuation_date DESC, id DESC);
