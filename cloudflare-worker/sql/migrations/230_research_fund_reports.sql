-- 230 — quarterly public fund-size and performance reports for founder research.
-- Values are nullable because a report may disclose only part of the snapshot.
-- Monetary values are USD cents; rates are basis points; TVPI is basis points.
CREATE TABLE IF NOT EXISTS research_fund_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    fund_uid TEXT NOT NULL REFERENCES research_funds(uid) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    report_date TEXT,
    fund_size_cents INTEGER,
    nav_cents INTEGER,
    quarterly_return_bps INTEGER,
    net_irr_bps INTEGER,
    tvpi_bps INTEGER,
    source_url TEXT,
    report_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (fund_uid, owner_user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_research_fund_reports_fund
    ON research_fund_reports (fund_uid, owner_user_id, period DESC);
