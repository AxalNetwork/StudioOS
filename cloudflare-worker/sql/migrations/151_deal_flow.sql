-- Task #4 — Deal Flow: deal-term columns + commitments + deal_invitations.
-- Mirrors backend ensure_deal_flow_tables() (Postgres). D1/SQLite dialect.

ALTER TABLE deals ADD COLUMN target_raise REAL;
ALTER TABLE deals ADD COLUMN capital_committed REAL DEFAULT 0;
ALTER TABLE deals ADD COLUMN minimum_check REAL;
ALTER TABLE deals ADD COLUMN valuation_cap REAL;
ALTER TABLE deals ADD COLUMN carry_pct REAL;
ALTER TABLE deals ADD COLUMN management_fee_pct REAL;
ALTER TABLE deals ADD COLUMN instrument TEXT;
ALTER TABLE deals ADD COLUMN spv_jurisdiction TEXT;
ALTER TABLE deals ADD COLUMN closing_deadline TEXT;
ALTER TABLE deals ADD COLUMN website TEXT;
ALTER TABLE deals ADD COLUMN description TEXT;
ALTER TABLE deals ADD COLUMN lead_partner_id INTEGER REFERENCES users(id);
ALTER TABLE deals ADD COLUMN stage_changed_at TEXT;

UPDATE deals SET stage_changed_at = COALESCE(updated_at, created_at, datetime('now')) WHERE stage_changed_at IS NULL;

CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    investor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'withdrawn')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commitments_deal ON commitments(deal_id);
CREATE INDEX IF NOT EXISTS idx_commitments_investor ON commitments(investor_user_id);

CREATE TABLE IF NOT EXISTS deal_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    investor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    message TEXT,
    email_opt_in INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'interested', 'passed')),
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_invites_pair ON deal_invitations(deal_id, investor_user_id);
CREATE INDEX IF NOT EXISTS idx_deal_invites_investor ON deal_invitations(investor_user_id, status);
