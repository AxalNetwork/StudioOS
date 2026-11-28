-- D5837 (#5837): a founder's explicit choice of one line of one exact ledger
-- statement revision (D5833) as Raise evidence for one claim.
--
-- A selection keeps its own copy of the chosen fact (revision, line, amount,
-- date, currency, basis), so a pinned value stays intelligible to the founder
-- after the source revision is corrected, its connection is revoked or the
-- revision is deleted (snapshot_id goes NULL). The fact never changes after
-- the choice (trigger below): a correction is a re-review, which writes a new
-- selection that `replaces_id` the old one. The evidence item it creates is
-- an ordinary `raise_evidence_items` row of kind `ledger-fact`, Private.
CREATE TABLE IF NOT EXISTS raise_ledger_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_id INTEGER REFERENCES financial_statement_snapshots(id) ON DELETE SET NULL,
  snapshot_uid TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  report TEXT NOT NULL CHECK (report IN ('balance_sheet', 'profit_and_loss')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  basis TEXT NOT NULL CHECK (basis IN ('cash', 'accrual', 'unknown')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  precision INTEGER NOT NULL CHECK (precision BETWEEN 0 AND 4),
  period_start TEXT,
  period_end TEXT,
  as_of TEXT,
  observed_on TEXT NOT NULL,
  source_key TEXT NOT NULL,
  line_label TEXT NOT NULL,
  figure TEXT NOT NULL CHECK (figure IN ('cash_balance', 'revenue', 'profit')),
  amount TEXT NOT NULL,
  amount_minor TEXT NOT NULL,
  area TEXT NOT NULL,
  claim_id INTEGER REFERENCES raise_claims(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES raise_evidence_items(id) ON DELETE SET NULL,
  replaces_id INTEGER REFERENCES raise_ledger_selections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'replaced', 'withdrawn')),
  selected_by INTEGER NOT NULL,
  selected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_by INTEGER,
  closed_at TEXT,
  closed_token TEXT
);
CREATE INDEX IF NOT EXISTS ix_raise_ledger_selections_project ON raise_ledger_selections(project_id, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_ledger_selections_item ON raise_ledger_selections(item_id) WHERE item_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_raise_ledger_selection_fact_fixed
BEFORE UPDATE OF uid, project_id, snapshot_uid, provider, report, revision, basis, currency, precision, period_start, period_end, as_of,
  observed_on, source_key, line_label, figure, amount, amount_minor, selected_by ON raise_ledger_selections
BEGIN SELECT RAISE(ABORT, 'raise_ledger_selections.fact: a pinned ledger fact is never edited'); END;
