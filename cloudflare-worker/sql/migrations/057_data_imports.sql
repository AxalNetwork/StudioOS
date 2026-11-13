-- Task #8 (IH) — Data Import + Migration Tools.
--
-- Two tables:
--   1. `data_imports` — one row per import attempt for any source. Tracks
--      status, row counts, per-row errors (JSON), and the R2 key of the
--      raw uploaded file. Used both as an audit log AND as the source of
--      the per-user monthly counter that enforces the Free=1/Growth=10/
--      Studio=unlimited tier caps.
--   2. `investor_portfolio_holdings` — destination for the investor
--      portfolio CSV importer. Surfaced in the Investor Portal Portfolio
--      tab.
--
-- All CREATEs are `IF NOT EXISTS` so the file is idempotent on re-run.

CREATE TABLE IF NOT EXISTS data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  rows_attempted INTEGER DEFAULT 0,
  rows_succeeded INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  raw_file_r2_key TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_data_imports_user_created
  ON data_imports(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_imports_user_month_status
  ON data_imports(user_id, started_at);

CREATE TABLE IF NOT EXISTS investor_portfolio_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_user_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  ticker TEXT,
  investment_date TEXT,
  amount REAL,
  instrument TEXT,
  current_valuation REAL,
  source TEXT DEFAULT 'csv',
  data_import_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_iph_investor
  ON investor_portfolio_holdings(investor_user_id, created_at DESC);

-- Optional landing tables for the universal/AngelList importers. These are
-- declared here (rather than in the canonical schema) so the IH importer
-- can write them without depending on follow-on migrations. All are
-- additive and `IF NOT EXISTS`-guarded so re-running the migration is safe.

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT,
  amount REAL,
  closed_at TEXT,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rounds_project ON rounds(project_id);

CREATE TABLE IF NOT EXISTS network_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  title TEXT,
  phone TEXT,
  notes TEXT,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_network_conn_user
  ON network_connections(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kyc_partner_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  legal_name TEXT NOT NULL,
  jurisdiction TEXT,
  entity_type TEXT,
  contact_email TEXT,
  data_import_id INTEGER,
  status TEXT DEFAULT 'pending_review',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kyc_partner_imports_user
  ON kyc_partner_imports(user_id, created_at DESC);

-- Vesting schedules + option pools imported from Carta (and writable by
-- the AngelList CSV path). `source` is tagged so re-syncs/disconnects can
-- flip rows back to 'manual' without deleting historical state.

CREATE TABLE IF NOT EXISTS cap_table_vesting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  holder_id INTEGER,
  security_id INTEGER,
  carta_vesting_id TEXT,
  start_date TEXT,
  cliff_months INTEGER,
  total_months INTEGER,
  total_shares REAL,
  vested_shares REAL,
  source TEXT DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cap_table_vesting_user
  ON cap_table_vesting(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cap_table_vesting_user_carta
  ON cap_table_vesting(user_id, carta_vesting_id)
  WHERE carta_vesting_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cap_table_option_pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  shares_authorized REAL,
  shares_issued REAL,
  shares_available REAL,
  source TEXT DEFAULT 'manual',
  carta_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cap_table_option_pools_user
  ON cap_table_option_pools(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cap_table_option_pools_user_carta
  ON cap_table_option_pools(user_id, carta_id)
  WHERE carta_id IS NOT NULL;
