-- 521 — D840 part 3 (#2348): the founder's own Mercury feeds their Grow modules.
--
-- Three stores, all written only by the founder's own Mercury read
-- (`services/mercury/growFeeds.ts`), each linked through the
-- `connector_fed_items` ledger (D655, migration 445) so a re-sync updates a
-- row and a row the founder deleted stays deleted.
--
--   project_metrics.cash_in
--     Revenue and traction's monthly snapshot (`source = 'mercury'`, one row
--     per full month, dated the month's last day) records the month's
--     operating money in beside its net burn. Dollars, as the other columns.
--     Never a balance: cash on hand stays D752's confirmed save.
--
--   mercury_grow_facts
--     The figures that are the venture's team's alone: cash, treasury and
--     runway (Durable company-building), payroll by month (Team expansion),
--     marketing and advertising spend by month and channel (Distribution),
--     and invoices by state (Revenue and traction). Read only by the
--     founder's company's members, never by anyone else. `subject` is the
--     channel uid for a channel's spend, '' otherwise. No counterparty name,
--     account number or transaction id is stored.
--
--   mercury_partner_proposals
--     Partner network: payments to a recipient whose name is an Axal
--     partner's company. A proposal, never a link, until the founder
--     accepts it; then it links one `growth_partners` row. A dismissed one
--     stays dismissed.
--
-- Nothing creates these at runtime: a database without them reads the Mercury
-- parts as "Unreadable", never as zero.
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`).

ALTER TABLE project_metrics ADD COLUMN cash_in REAL;

CREATE TABLE IF NOT EXISTS mercury_grow_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('revenue_and_traction', 'durable_company_building', 'team_expansion', 'distribution')),
  kind TEXT NOT NULL CHECK (kind IN ('cash', 'treasury', 'runway', 'payroll', 'marketing_spend', 'channel_spend', 'invoices_paid', 'invoices_open', 'invoices_overdue')),
  period TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER,
  count INTEGER,
  value REAL,
  note TEXT,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, period, subject)
);

CREATE INDEX IF NOT EXISTS idx_mercury_grow_facts_module ON mercury_grow_facts (project_id, module);

CREATE TABLE IF NOT EXISTS mercury_partner_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  partner_uid TEXT NOT NULL,
  partner_company TEXT NOT NULL,
  paid_cents INTEGER NOT NULL CHECK (paid_cents > 0),
  payments INTEGER NOT NULL CHECK (payments > 0),
  since TEXT NOT NULL,
  as_of TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'dismissed')),
  growth_partner_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, partner_uid)
);
