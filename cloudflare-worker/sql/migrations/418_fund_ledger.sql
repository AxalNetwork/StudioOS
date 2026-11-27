-- D628: a fund's operational books, separate from investment decision journals.
-- No inferred administrator, fee terms, opening balances or historical entries.
ALTER TABLE vc_funds ADD COLUMN fund_admin_user_id INTEGER REFERENCES users(id);

CREATE TABLE IF NOT EXISTS fund_ledger_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
  code TEXT NOT NULL, name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('asset','liability','equity','income','expense')),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, code), UNIQUE (fund_id, id)
);
CREATE TABLE IF NOT EXISTS fund_accounting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
  label TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id), closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_date <= end_date), UNIQUE (fund_id, id)
);
CREATE INDEX IF NOT EXISTS idx_fund_period_dates ON fund_accounting_periods(fund_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS fund_fee_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
  effective_date TEXT NOT NULL,
  annual_bps INTEGER NOT NULL CHECK (typeof(annual_bps)='integer' AND annual_bps BETWEEN 0 AND 10000),
  basis_cents INTEGER NOT NULL CHECK (typeof(basis_cents)='integer' AND basis_cents BETWEEN 0 AND 9007199254740991),
  source TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 500),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, id)
);
CREATE INDEX IF NOT EXISTS idx_fund_fee_terms_date ON fund_fee_terms(fund_id,effective_date DESC,id DESC);
CREATE TABLE IF NOT EXISTS fund_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id), period_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL, description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('journal','expense','fee_accrual')),
  fee_terms_id INTEGER,
  posted INTEGER NOT NULL DEFAULT 0 CHECK (posted IN (0,1)),
  debit_cents INTEGER, credit_cents INTEGER, line_count INTEGER,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (fund_id,period_id) REFERENCES fund_accounting_periods(fund_id,id),
  FOREIGN KEY (fund_id,fee_terms_id) REFERENCES fund_fee_terms(fund_id,id),
  UNIQUE (fund_id,id),
  CHECK (posted=0 OR (typeof(debit_cents)='integer' AND typeof(credit_cents)='integer'
    AND debit_cents BETWEEN 0 AND 9007199254740991 AND debit_cents=credit_cents AND typeof(line_count)='integer' AND line_count BETWEEN 2 AND 50))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_fee_once ON fund_ledger_entries(fund_id,period_id) WHERE kind='fee_accrual';
CREATE INDEX IF NOT EXISTS idx_fund_journal ON fund_ledger_entries(fund_id,period_id,posted,entry_date,id);
CREATE TABLE IF NOT EXISTS fund_ledger_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  fund_id INTEGER NOT NULL REFERENCES vc_funds(id), entry_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
  debit_cents INTEGER NOT NULL, credit_cents INTEGER NOT NULL,
  statement_reference TEXT, statement_line_reference TEXT, statement_date TEXT,
  statement_amount_cents INTEGER, reconciled_by INTEGER REFERENCES users(id), reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (fund_id,entry_id) REFERENCES fund_ledger_entries(fund_id,id),
  FOREIGN KEY (fund_id,account_id) REFERENCES fund_ledger_accounts(fund_id,id),
  CHECK (typeof(debit_cents)='integer' AND typeof(credit_cents)='integer'
    AND debit_cents BETWEEN 0 AND 9007199254740991 AND credit_cents BETWEEN 0 AND 9007199254740991
    AND (debit_cents=0 OR credit_cents=0)),
  CHECK ((reconciled_by IS NULL AND statement_reference IS NULL AND statement_line_reference IS NULL
    AND statement_date IS NULL AND statement_amount_cents IS NULL AND reconciled_at IS NULL)
    OR (reconciled_by IS NOT NULL AND statement_reference IS NOT NULL AND statement_line_reference IS NOT NULL
    AND statement_date IS NOT NULL AND typeof(statement_amount_cents)='integer' AND statement_amount_cents=debit_cents-credit_cents AND reconciled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_fund_ledger_lines_entry ON fund_ledger_lines(fund_id,entry_id,account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_statement_line_once ON fund_ledger_lines(fund_id,statement_reference,statement_line_reference)
  WHERE statement_reference IS NOT NULL;
