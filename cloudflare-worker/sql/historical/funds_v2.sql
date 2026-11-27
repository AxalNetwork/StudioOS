-- VC Fund / Investment Entity v2 schema (additive — one-time migration).
-- Run via: npx wrangler d1 execute studioos-db --file=sql/funds_v2.sql --remote
--
-- Notes:
-- * SQLite/D1 has no `ADD COLUMN IF NOT EXISTS`; if a column already exists this
--   single ALTER will fail. Each `ALTER TABLE ADD COLUMN` is independent so
--   re-running just the failing line is safe.
-- * All new money columns are integer cents.

-- ---------- vc_funds extensions ----------
ALTER TABLE vc_funds ADD COLUMN lpa_doc_id INTEGER REFERENCES legal_documents(id);
ALTER TABLE vc_funds ADD COLUMN fund_size_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vc_funds ADD COLUMN carried_interest REAL NOT NULL DEFAULT 0.20;
ALTER TABLE vc_funds ADD COLUMN management_fee REAL NOT NULL DEFAULT 0.02;

-- ---------- limited_partners extensions ----------
ALTER TABLE limited_partners ADD COLUMN lpa_signed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE limited_partners ADD COLUMN lpa_signed_at TEXT;
ALTER TABLE limited_partners ADD COLUMN commitment_date TEXT;
ALTER TABLE limited_partners ADD COLUMN distribution_history TEXT;          -- json array of { ts, amount_cents, type }

-- ---------- legal_documents extension (fund-level docs like LPA) ----------
ALTER TABLE legal_documents ADD COLUMN fund_id INTEGER REFERENCES vc_funds(id);

-- ---------- fund_distributions ----------
CREATE TABLE IF NOT EXISTS fund_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    lp_id INTEGER NOT NULL REFERENCES limited_partners(id),
    amount_cents INTEGER NOT NULL,
    distribution_type TEXT NOT NULL,           -- return_of_capital | profit_share | exit_proceeds
    source_liquidity_event_id INTEGER REFERENCES liquidity_events(id),
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | failed
    notes TEXT,
    distributed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dist_fund ON fund_distributions(fund_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dist_lp ON fund_distributions(lp_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dist_event ON fund_distributions(source_liquidity_event_id);
CREATE INDEX IF NOT EXISTS idx_dist_status ON fund_distributions(status);
-- Prevent double-payment when a job is retried for the same liquidity event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dist_event_lp
  ON fund_distributions(source_liquidity_event_id, fund_id, lp_id)
  WHERE source_liquidity_event_id IS NOT NULL;
