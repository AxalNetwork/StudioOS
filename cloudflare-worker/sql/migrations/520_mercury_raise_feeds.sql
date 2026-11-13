-- 520 — Mercury feeds the founder's Raise modules (D840 part 2, #2347).
--
-- Two new tables, no change to an existing one.
--
--   mercury_raise_facts  what a Raise sync measured from the founder's own
--       Mercury, as facts: the runway (cash, the last 3 full months' average
--       net burn, and the months it gives), the spend by Mercury category
--       over the last 3, 6 and 12 months (Use of funds' actuals), and the
--       monthly revenue credits that Investor narrative and Pitch deck may cite.
--       One row per (connection, project, fact_key); a re-sync updates it.
--       Each row has its ledger row (`connector_fed_items`), so a row the
--       founder deleted keeps a ledger row with no `local_id` and a re-sync
--       never writes it back. Only the connection's owner reads a row.
--   mercury_raise_proposals  the judgement a Raise sync proposes, written to
--       its module only on the founder's Accept:
--         fund_mapping    a Mercury category to a Use of funds section;
--         statement       a monthly account statement, into the data room;
--         safe            a Mercury SAFE, as a cap-table instrument;
--         investor_credit an incoming wire or ACH credit, as a match to a
--                         capital relationship or as a new investor.
--       Proposed once per (connection, project, kind, source_key): a decided
--       proposal is never proposed again, and a pending one is refreshed.
--       `payload_json` holds what the founder is shown (amounts in cents,
--       dates, a counterparty's name); it goes with the connection.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS mercury_raise_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('runway', 'spend', 'revenue')),
  fact_key TEXT NOT NULL,
  label TEXT,
  months INTEGER,
  amount_cents INTEGER,
  burn_cents INTEGER,
  value REAL,
  as_of TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_mercury_raise_facts_project
  ON mercury_raise_facts (project_id, kind);

CREATE TABLE IF NOT EXISTS mercury_raise_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fund_mapping', 'statement', 'safe', 'investor_credit')),
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  local_table TEXT,
  local_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_mercury_raise_proposals_project
  ON mercury_raise_proposals (project_id, kind, status, id);
