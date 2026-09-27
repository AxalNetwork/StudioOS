-- 335_deal_transfers_and_closing_checklists.sql — the Closing stage's money
-- and paper (D462, wave 8, Session 17, item 3).
--
-- Canvas ID4 (Pages · Investor Deals, /deals/closing) draws two records the
-- platform did not hold:
--
--   TRANSFERS. "Record wire" / "Funds moved" — a transfer OUT to a company.
--   `capital_calls` is the other direction (an LP paying INTO the fund), so
--   nothing recorded this leg. `deal_transfers` does: integer cents (never a
--   REAL — money is integer cents everywhere this wave), an external
--   reference, a phone-verified flag (the artboard's own fraud note: wire
--   instructions are verified by phone because email-only verification is how
--   funds get defrauded), who recorded it and when. The platform RECORDS the
--   movement of money; it does not move it. An open IC condition on the deal
--   (migration 334) refuses the write.
--
--   THE CLOSING CHECKLIST. `legal_templates` ships the SAFE, stock-purchase
--   and subscription agreements; what was missing is the checklist one is
--   applied TO. `deal_closing_checklists` is one checklist per deal, naming
--   the template it was applied from; `deal_closing_checklist_items` is its
--   rows. THE DEFAULT ITEM SET IS THE OWNER'S CALL — applying a template
--   creates the checklist and items are added by hand until the owner names
--   the defaults; the screen and the PR both say so (standing rule (c)).
--
-- STANDS ALONE: depends on no other wave-8 migration at apply time (the
-- condition refusal is a read in the route, not a schema dependency). Both
-- CREATEs are idempotent. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS deal_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_transfers_deal ON deal_transfers(deal_id, recorded_at);

CREATE TABLE IF NOT EXISTS deal_closing_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  template_slug TEXT,
  applied_by INTEGER NOT NULL REFERENCES users(id),
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(deal_id)
);

CREATE TABLE IF NOT EXISTS deal_closing_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  checklist_id INTEGER NOT NULL REFERENCES deal_closing_checklists(id),
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'blocked', 'skipped')),
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER REFERENCES users(id),
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deal_closing_items_list ON deal_closing_checklist_items(checklist_id, sort);
