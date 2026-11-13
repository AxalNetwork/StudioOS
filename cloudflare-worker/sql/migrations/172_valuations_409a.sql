-- 172 — 409A valuations and the material events that end their safe harbour.
--
-- services/valuation409a.ts tracks whether a company's option grants sit
-- behind a §409A safe harbour. It had nowhere to read a valuation from,
-- so the answer could never be computed for a real company.
--
-- Two tables because they answer different questions and arrive at
-- different times: a valuation is a dated appraisal by a provider, and a
-- material event is something that happened afterwards which may end the
-- presumption early. Folding events into the valuation row would lose
-- the ones that arrive between appraisals — which are exactly the ones
-- that matter.

-- History, not current state. Every appraisal is kept: an auditor asks
-- what the FMV was on a grant date, not what it is now, and overwriting
-- would destroy the only record that answers them. "Current" is derived
-- as the latest valuation_date.
CREATE TABLE IF NOT EXISTS valuations_409a (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- The date the appraisal SPEAKS AS OF, which is not the date it was
    -- delivered or entered. The 12-month clock runs from this date.
    valuation_date TEXT NOT NULL,
    -- Common-stock fair market value per share, in dollars. Stored as
    -- REAL rather than cents: a sub-cent FMV per share is normal at seed
    -- stage (fractions of a cent), and rounding to cents would report a
    -- real valuation as zero.
    fmv_per_share  REAL NOT NULL,
    provider       TEXT,
    -- income | market | asset | obm | backsolve | other
    method         TEXT,
    -- Last preferred price per share at the time, for the common:preferred
    -- ratio an auditor sanity-checks first. Nullable — a company with no
    -- priced round has no such price, and inventing one would be worse.
    preferred_price_per_share REAL,
    report_url     TEXT,
    notes          TEXT,
    created_by     INTEGER REFERENCES users(id),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_409a_project ON valuations_409a(project_id, valuation_date DESC);

CREATE TABLE IF NOT EXISTS valuation_409a_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- priced_round | material_change | secondary_transaction
    -- | acquisition_discussion | financial_restatement
    kind        TEXT NOT NULL,
    occurred_on TEXT NOT NULL,
    note        TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_409a_event_project ON valuation_409a_events(project_id, occurred_on DESC);
