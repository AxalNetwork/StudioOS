-- D713: personal Mercury evidence and Management partner-deal settlements.
-- Nothing here moves money or stores a full account number.
-- migrate-d1.mjs sends this whole file to wrangler d1 execute --file.
-- Remote file import blocks concurrent database queries until completion;
-- the old isolate's bootstrap cannot run between DROP and RENAME. See D713.
-- No explicit transaction commands: D1 owns the import transaction.

CREATE TABLE revenue_entries_477 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  customer          TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'usd',
  revenue_type      TEXT NOT NULL CHECK (revenue_type IN ('recurring', 'pilot', 'one_time', 'deposit')),
  received_on       TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'stripe', 'mercury')),
  source_ref        TEXT,
  verification      TEXT NOT NULL DEFAULT 'manual' CHECK (verification IN ('verified', 'supported', 'manual')),
  proof_document_id INTEGER REFERENCES documents(id),
  notes             TEXT,
  import_batch      TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO revenue_entries_477 (id, uid, project_id, customer, amount_cents, currency, revenue_type, received_on, source, source_ref, verification, proof_document_id, notes, import_batch, created_by, created_at, updated_at)
SELECT id, uid, project_id, customer, amount_cents, currency, revenue_type, received_on, source, source_ref, verification, proof_document_id, notes, import_batch, created_by, created_at, updated_at FROM revenue_entries;
DROP TABLE revenue_entries;
ALTER TABLE revenue_entries_477 RENAME TO revenue_entries;
CREATE INDEX idx_revenue_entries_project ON revenue_entries(project_id, received_on DESC);
CREATE UNIQUE INDEX uq_revenue_entries_stripe_charge ON revenue_entries(project_id, source_ref) WHERE source = 'stripe';
CREATE UNIQUE INDEX uq_revenue_entries_mercury_txn ON revenue_entries(source_ref) WHERE source = 'mercury';

CREATE TABLE IF NOT EXISTS partner_deal_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  partner_deal_id INTEGER NOT NULL REFERENCES partner_deals(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity_key TEXT NOT NULL DEFAULT 'management' CHECK (entity_key = 'management'),
  kind TEXT NOT NULL CHECK (kind IN ('revenue_share', 'capital', 'equity_for_services', 'other')),
  direction TEXT NOT NULL CHECK (direction IN ('to_member', 'from_member')),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  due_on TEXT NOT NULL,
  memo TEXT,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'issued', 'matched', 'void')),
  drafted_by INTEGER NOT NULL REFERENCES users(id),
  drafted_at TEXT NOT NULL DEFAULT (datetime('now')),
  issued_by INTEGER REFERENCES users(id),
  issued_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_user ON partner_deal_settlements(user_id, state);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_deal ON partner_deal_settlements(partner_deal_id);
CREATE TRIGGER IF NOT EXISTS trg_partner_deal_settlements_fixed BEFORE UPDATE ON partner_deal_settlements WHEN OLD.state = 'void' OR (OLD.state <> 'draft' AND (NEW.partner_deal_id IS NOT OLD.partner_deal_id OR NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.direction IS NOT OLD.direction OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.due_on IS NOT OLD.due_on)) BEGIN SELECT RAISE(ABORT, 'settlement_fixed'); END;

CREATE TABLE IF NOT EXISTS mercury_personal_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  integration_id INTEGER NOT NULL,
  mercury_transaction_id TEXT NOT NULL,
  account_last_four TEXT NOT NULL CHECK (length(account_last_four) = 4 AND account_last_four NOT GLOB '*[^0-9]*'),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  posted_on TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('engagement_invoice', 'payout', 'partner_deal_settlement')),
  target_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('confirmed', 'withdrawn')),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  withdraw_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_transaction ON mercury_personal_matches(mercury_transaction_id) WHERE state = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_target ON mercury_personal_matches(target_kind, target_id) WHERE state = 'confirmed';
