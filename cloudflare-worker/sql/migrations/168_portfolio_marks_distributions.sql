-- Build queue #125 — portfolio performance: marks, realisations, KPI set.
--
-- Closes the three data gaps that forced the portfolio surfaces onto
-- mock analytics (frontend/src/data/portfolioAnalytics.js):
--
--   1. portfolio_marks — dated carrying value per position. Without
--      this there is no FMV, so no TVPI/RVPI/MOIC, only cost basis.
--      A position with NO mark carries at cost by design (see
--      rollUpPosition in services/portfolioMetrics.ts) — the engine
--      never invents a step-up.
--   2. portfolio_distributions — dated realisations FROM A PORTFOLIO
--      COMPANY back to the fund. This is deliberately NOT the same
--      thing as `fund_distributions` (sql/funds_v2.sql:26), which
--      records fund → LP payouts: the two differ by fees, carry,
--      recycling, and timing, and conflating them would misstate both
--      DPI figures. Portfolio DPI (here) answers "what did the
--      companies return?"; LP DPI (fund_distributions) answers "what
--      did the LP receive?". Without this table portfolio DPI is
--      structurally 0 and IRR has no inflows to solve against.
--
--      UNITS: amounts here are REAL DOLLARS, matching
--      portfolio_positions.invested_amount and capital_calls.amount.
--      `fund_distributions.amount_cents` and `vc_funds.fund_size_cents`
--      are CENTS — never mix the two without dividing by 100.
--   3. portfolio_kpi_definitions — the KPI set companies are asked to
--      report. Compliance itself is DERIVED from portfolio_updates
--      (period + kpis_json, migration 049) rather than duplicated here:
--      one reporting channel, not two.
--
-- Money columns are REAL to match portfolio_positions.invested_amount
-- (migration 126). Dates are TEXT (YYYY-MM-DD) for D1 portability.

CREATE TABLE IF NOT EXISTS portfolio_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),            -- nullable = firm-level, mirrors portfolio_positions
  project_id INTEGER NOT NULL REFERENCES projects(id),
  as_of_date TEXT NOT NULL,                           -- YYYY-MM-DD, the date the mark speaks for
  fmv REAL NOT NULL,                                  -- OUR carrying value of the position
  post_money REAL,                                    -- company post-money at the marking event, if known
  event TEXT,                                         -- 'Series B', 'Annual review', 'Write-down'…
  -- How the mark was arrived at. Drives the "Mark basis" column in the
  -- LP export: a round-priced mark and a GP estimate must never look
  -- alike to an LP.
  basis TEXT NOT NULL DEFAULT 'gp_estimate',          -- round_price | secondary | gp_estimate | write_down | cost
  source TEXT,                                        -- free text provenance ('Series B term sheet', '409A')
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The latest-mark lookup is (project, date desc) on every page load.
CREATE INDEX IF NOT EXISTS idx_marks_project_date ON portfolio_marks(project_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_marks_fund ON portfolio_marks(fund_id);

CREATE TABLE IF NOT EXISTS portfolio_distributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fund_id INTEGER REFERENCES vc_funds(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  distribution_date TEXT NOT NULL,                    -- YYYY-MM-DD
  amount REAL NOT NULL,                               -- positive magnitude; direction is implied by the table
  kind TEXT NOT NULL DEFAULT 'exit',                  -- exit | secondary | dividend | recapitalization
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_distributions_project ON portfolio_distributions(project_id, distribution_date);
CREATE INDEX IF NOT EXISTS idx_distributions_fund ON portfolio_distributions(fund_id);

CREATE TABLE IF NOT EXISTS portfolio_kpi_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER REFERENCES vc_funds(id),            -- nullable = firm-wide default set
  kpi_key TEXT NOT NULL,                              -- matches a key inside portfolio_updates.kpis_json
  name TEXT NOT NULL,
  definition TEXT,                                    -- the wording companies are held to
  unit TEXT,                                          -- 'USD', '%', 'count', 'months'
  cadence TEXT NOT NULL DEFAULT 'quarterly',          -- monthly | quarterly
  required INTEGER NOT NULL DEFAULT 1,
  applies_to TEXT NOT NULL DEFAULT 'all',             -- 'all' or a stage label
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, kpi_key)
);
CREATE INDEX IF NOT EXISTS idx_kpi_defs_cadence ON portfolio_kpi_definitions(cadence, sort_order);

-- Firm-wide default KPI set. fund_id IS NULL rows are the fallback any
-- fund inherits until it defines its own. Idempotent: re-running the
-- migration leaves an edited set alone.
INSERT OR IGNORE INTO portfolio_kpi_definitions (fund_id, kpi_key, name, definition, unit, cadence, required, applies_to, sort_order) VALUES
  (NULL, 'cash_balance',   'Cash balance',        'Cash and equivalents on the last day of the period, across all accounts.', 'USD',    'monthly',   1, 'all', 10),
  (NULL, 'net_burn',       'Net burn',            'Cash out minus cash in for the period. Negative means cash-flow positive.', 'USD',    'monthly',   1, 'all', 20),
  (NULL, 'runway_months',  'Runway',              'Cash balance divided by trailing three-month average net burn.',           'months', 'monthly',   1, 'all', 30),
  (NULL, 'revenue',        'Revenue',             'Recognised revenue for the period, on the same basis each time.',          'USD',    'monthly',   1, 'all', 40),
  (NULL, 'arr',            'ARR',                 'Annualised run-rate of committed recurring revenue at period end.',        'USD',    'quarterly', 1, 'all', 50),
  (NULL, 'headcount',      'Headcount',           'Full-time equivalents at period end, contractors excluded.',               'count',  'quarterly', 1, 'all', 60),
  (NULL, 'gross_margin',   'Gross margin',        'Revenue less cost of revenue, as a percentage of revenue.',                '%',      'quarterly', 0, 'all', 70),
  (NULL, 'net_retention',  'Net revenue retention','Revenue from the prior cohort this period over that cohort last period.', '%',      'quarterly', 0, 'all', 80);
