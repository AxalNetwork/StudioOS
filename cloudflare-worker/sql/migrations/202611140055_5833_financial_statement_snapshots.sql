-- D5833 (#5833): provider-neutral, read-only accounting statement snapshots.
-- One row per revision of one provider/entity/report/window/basis/currency.
-- An unchanged resync writes nothing; a corrected source appends the next
-- revision, which supersedes the one before. Revisions and their lines are
-- never updated (the triggers below), so a founder's pinned evidence keeps
-- pointing at exactly what the source said then.
CREATE TABLE financial_statement_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id),
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  entity_key TEXT NOT NULL,
  report TEXT NOT NULL CHECK (report IN ('balance_sheet', 'profit_and_loss')),
  window_key TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('cash', 'accrual', 'unknown')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  precision INTEGER NOT NULL CHECK (precision BETWEEN 0 AND 4),
  requested_start TEXT,
  requested_end TEXT,
  requested_as_of TEXT,
  returned_start TEXT,
  returned_end TEXT,
  returned_as_of TEXT,
  period_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (period_mismatch IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  supersedes_id INTEGER REFERENCES financial_statement_snapshots(id),
  line_count INTEGER NOT NULL CHECK (line_count >= 0),
  imported_by INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, provider, entity_key, report, window_key, basis, currency, revision)
);
CREATE INDEX idx_fin_statement_latest ON financial_statement_snapshots(project_id, report, provider, entity_key, window_key, basis, currency, revision DESC);

CREATE TABLE financial_statement_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES financial_statement_snapshots(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  label TEXT NOT NULL,
  section TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('cash_total', 'cash_account', 'revenue_total', 'expense_total', 'net_income', 'other')),
  state TEXT NOT NULL CHECK (state IN ('value', 'zero', 'absent', 'unreadable')),
  -- Exact: a canonical signed decimal at the snapshot's precision, and its minor units as a decimal integer string.
  amount TEXT,
  amount_minor TEXT,
  reason TEXT,
  CHECK ((state IN ('value', 'zero')) = (amount IS NOT NULL AND amount_minor IS NOT NULL)),
  UNIQUE (snapshot_id, source_key),
  UNIQUE (snapshot_id, position)
);

-- A founder's pin on one exact revision, kept when a later revision supersedes it.
CREATE TABLE financial_statement_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id INTEGER NOT NULL REFERENCES financial_statement_snapshots(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (length(purpose) BETWEEN 1 AND 200),
  pinned_by INTEGER NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (snapshot_id, purpose)
);
CREATE INDEX idx_fin_statement_pins_project ON financial_statement_pins(project_id, pinned_at);

CREATE TRIGGER trg_fin_statement_snapshot_immutable BEFORE UPDATE ON financial_statement_snapshots
BEGIN SELECT RAISE(ABORT, 'financial_statement_snapshot_immutable'); END;
CREATE TRIGGER trg_fin_statement_line_immutable BEFORE UPDATE ON financial_statement_lines
BEGIN SELECT RAISE(ABORT, 'financial_statement_line_immutable'); END;
