-- Liquidity / Secondary Market schema (additive + idempotent).
-- All money columns are stored as INTEGER cents.
-- Run via: npx wrangler d1 execute studioos-db --file=sql/liquidity.sql --remote

-- ---------- liquidity_events ----------
CREATE TABLE IF NOT EXISTS liquidity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subsidiary_id INTEGER REFERENCES subsidiaries(id),
    deal_id INTEGER REFERENCES deals(id),
    event_type TEXT NOT NULL,                    -- secondary_sale | m&a_exit | ipo_prep | distribution
    status TEXT NOT NULL DEFAULT 'listed',       -- listed | matched | executed | cancelled
    valuation_cents INTEGER NOT NULL DEFAULT 0,
    shares_offered REAL NOT NULL DEFAULT 0,
    buyer_type TEXT,                             -- secondary_fund | strategic | lp_rollover
    executed_price_cents INTEGER,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_liqevt_sub  ON liquidity_events(subsidiary_id);
CREATE INDEX IF NOT EXISTS idx_liqevt_deal ON liquidity_events(deal_id);
CREATE INDEX IF NOT EXISTS idx_liqevt_type_status ON liquidity_events(event_type, status, created_at);

-- ---------- secondary_listings ----------
CREATE TABLE IF NOT EXISTS secondary_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    subsidiary_id INTEGER NOT NULL REFERENCES subsidiaries(id),
    shares REAL NOT NULL,
    asking_price_cents INTEGER NOT NULL,
    ai_valuation_cents INTEGER,
    status TEXT NOT NULL DEFAULT 'open',         -- open | matched | sold | cancelled
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    matched_at TEXT,
    sold_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_listing_status ON secondary_listings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_listing_user ON secondary_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_sub ON secondary_listings(subsidiary_id);

-- ---------- exit_matches ----------
CREATE TABLE IF NOT EXISTS exit_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES secondary_listings(id),
    buyer_user_id INTEGER REFERENCES users(id),
    buyer_type TEXT NOT NULL DEFAULT 'lp_rollover',
    match_score REAL NOT NULL DEFAULT 0,
    ai_explanation TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',     -- proposed | accepted | rejected | executed
    proposed_price_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_match_listing ON exit_matches(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_match_buyer ON exit_matches(buyer_user_id);
