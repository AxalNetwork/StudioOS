-- 522 — an investor's own Mercury feeds their sections (D840 part 4, #2349).
--
-- Read-only. Every row here is the investor's own and is read only by
-- `/api/mercury/investor/*`, which answers its owner alone: no founder, admin
-- or LP route reads these tables. Each row an investor's Mercury delivers is
-- also a `connector_fed_items` row (D655, migration 445), keyed
-- `<kind>:<Mercury id>`, so a re-sync updates the row it made, and a row the
-- investor deleted or dismissed stays so: a sync never brings it back.
--
-- Grep first (D-t): none of these tables exists in schema_baseline.sql or in
-- an earlier migration. No column is added to an existing table: the closing
-- record, the capital-call receipt and the ledger entry are written through
-- what already exists (an accepted proposal, `capital_call_receipts`,
-- `fund_ledger_entries`). No BEGIN/COMMIT.
--
--   mercury_investor_capacity
--     FACT. Deals · Commit: the available cash across the accounts the
--     investor picked, as of a day, shown beside their own commitments only.
--     The picked accounts are kept by last four, never by account id.
--
--   mercury_investor_proposals
--     JUDGEMENT. One proposal per Mercury item and kind, which the investor
--     accepts or dismisses; nothing it names is written until they accept.
--       closing    an outgoing wire or ACH payment → one of their commitments
--       call       an incoming credit → an open capital-call line of a fund they are GP of
--       ledger     a transaction → a ledger entry of a fund they administer
--       statement  a month's statement → a report period of a fund they are GP of
--     `result_ref` is what Accept wrote: the receipt's uid, the ledger entry's
--     uid, or the statement's id. The counterparty is shown to the owner only.
--
--   mercury_investor_category_map
--     Accounting: a Mercury category, confirmed once per fund, posts to this
--     ledger account against this cash account, and is reused afterwards.
--
--   fund_month_end_cash
--     FACT. Fund · Reporting: the month-end cash of a fund the investor is GP
--     of, from the statements' ending balances of the accounts they picked.

CREATE TABLE IF NOT EXISTS mercury_investor_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL,
  available_cents INTEGER NOT NULL CHECK (available_cents >= 0),
  account_last_fours TEXT NOT NULL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mercury_investor_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('closing', 'call', 'ledger', 'statement')),
  external_id TEXT NOT NULL,
  mercury_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('deal_commitment', 'capital_call_line', 'fund_ledger', 'fund_report_period')),
  target_id INTEGER NOT NULL,
  fund_id INTEGER,
  amount_cents INTEGER,
  posted_on TEXT,
  account_last_four TEXT,
  counterparty TEXT,
  category TEXT,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'accepted', 'dismissed')),
  result_ref TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_mercury_investor_proposals_owner
  ON mercury_investor_proposals (user_id, kind, state);

CREATE TABLE IF NOT EXISTS mercury_investor_category_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fund_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  ledger_account_id INTEGER NOT NULL,
  cash_account_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, fund_id, category)
);

CREATE TABLE IF NOT EXISTS fund_month_end_cash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  cash_cents INTEGER NOT NULL,
  account_last_fours TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fund_id, month)
);
