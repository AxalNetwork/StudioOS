-- 612 — Closing part 2: a closing becomes a record (D1215, #3212, part 2 of
-- #2424). Reserved for this part by #3212.
--
-- A closing is the step from "terms agreed" to "money in the company's
-- account". Until now its paper (envelopes, `safe_issuances`), its money
-- (`commitments`, `deal_transfers`, `fund_capital_calls`) and the cap table
-- never met. Four stores join them:
--
--   closings          one closing of a deal: its venture, round, instrument,
--                     template, status, owner and deadline. At most one OPEN
--                     closing per deal.
--   closing_lines     one line per commitment (or Raise prospect): its capital
--                     route, its amount in integer cents with the deal's
--                     currency, its envelope, `safe_issuances` uid, vehicle
--                     reference and status.
--   closing_evidence  what shows the money moved: its kind, which side it comes
--                     from, its source reference and file key, who recorded and
--                     who accepted it, and its withdrawal. A line reads
--                     `received` only on RECEIVING-side evidence (#2424 owner
--                     question 4); the sender's alone reads `sent`.
--   closing_events    one row per step, append-only (the triggers below refuse
--                     an UPDATE or a DELETE). An event names who, what, when and
--                     a source reference. It has no amount, name or account
--                     number column, and the Worker writes none into
--                     `source_ref`.
--
-- MONEY. `commitments.amount` is dollars as REAL. It gains `amount_cents`,
-- copied once by CAST(ROUND(amount * 100) AS INTEGER) for an amount from 0 to
-- ten trillion dollars, and kept in step by two triggers on every insert and
-- every change of `amount`, by the same rule (migration 607's pattern). A
-- missing or out-of-range amount stays NULL, never 0. The commitment's currency
-- is its deal's (`deals.currency`, migration 599). `amount` is kept.
--
-- THE LINKS. `fund_capital_calls`, `portfolio_positions`, `safe_issuances` and
-- `deal_transfers` each gain a nullable `closing_line_uid`: the closing line
-- the call, position, issuance or recorded transfer serves. Existing rows keep
-- NULL; nothing is guessed.
--
-- Grep first (D689 D-t): no `closings`, `closing_lines`, `closing_evidence` or
-- `closing_events` table, and no `amount_cents` or `closing_line_uid` column on
-- these tables, exists in an earlier migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS closings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  deal_id          INTEGER NOT NULL REFERENCES deals(id),
  project_id       INTEGER NOT NULL REFERENCES projects(id),
  round_label      TEXT,
  instrument       TEXT,
  template_slug    TEXT,
  currency         TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  owner_user_id    INTEGER REFERENCES users(id),
  deadline         TEXT,
  captable_state   TEXT CHECK (captable_state IS NULL OR captable_state IN ('accepted', 'dismissed')),
  captable_decided_by INTEGER REFERENCES users(id),
  captable_decided_at TEXT,
  closed_by        INTEGER REFERENCES users(id),
  closed_at        TEXT,
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_closings_open_deal ON closings (deal_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_closings_project ON closings (project_id, id);

CREATE TABLE IF NOT EXISTS closing_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  closing_id        INTEGER NOT NULL REFERENCES closings(id),
  commitment_id     INTEGER REFERENCES commitments(id),
  prospect_id       INTEGER REFERENCES raise_prospects(id),
  investor_user_id  INTEGER REFERENCES users(id),
  route             TEXT CHECK (route IS NULL OR route IN ('direct', 'syndicate', 'axal_fund', 'third_party_fund')),
  amount_cents      INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  envelope_id       INTEGER REFERENCES esign_envelopes(id),
  safe_issuance_uid TEXT,
  vehicle_ref       TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'received', 'withdrawn')),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (commitment_id IS NOT NULL OR prospect_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_closing_lines_commitment ON closing_lines (closing_id, commitment_id) WHERE commitment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_closing_lines_prospect ON closing_lines (closing_id, prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_closing_lines_investor ON closing_lines (investor_user_id, closing_id);

CREATE TABLE IF NOT EXISTS closing_evidence (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  line_id          INTEGER NOT NULL REFERENCES closing_lines(id),
  kind             TEXT NOT NULL CHECK (kind IN ('company_mercury', 'investor_mercury', 'axal_mercury', 'phone_verified_record', 'bank_confirmation')),
  side             TEXT NOT NULL CHECK (side IN ('receiving', 'sending')),
  source_ref       TEXT NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 200),
  file_key         TEXT,
  recorded_by      INTEGER NOT NULL REFERENCES users(id),
  accepted_by      INTEGER REFERENCES users(id),
  accepted_at      TEXT,
  withdrawn_by     INTEGER REFERENCES users(id),
  withdrawn_at     TEXT,
  withdrawn_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_closing_evidence_line ON closing_evidence (line_id, id);

CREATE TABLE IF NOT EXISTS closing_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_id    INTEGER NOT NULL REFERENCES closings(id),
  line_id       INTEGER REFERENCES closing_lines(id),
  actor_user_id INTEGER REFERENCES users(id),
  event         TEXT NOT NULL CHECK (event IN (
                  'opened', 'line_added', 'line_withdrawn', 'route_set', 'evidence_added', 'evidence_withdrawn',
                  'captable_accepted', 'captable_dismissed', 'closed')),
  source_ref    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_closing_events_closing ON closing_events (closing_id, id);

CREATE TRIGGER IF NOT EXISTS trg_closing_events_no_update
BEFORE UPDATE ON closing_events
BEGIN
  SELECT RAISE(ABORT, 'closing_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_closing_events_no_delete
BEFORE DELETE ON closing_events
BEGIN
  SELECT RAISE(ABORT, 'closing_events is append-only');
END;

-- Money in cents beside the commitment's dollars.
ALTER TABLE commitments ADD COLUMN amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0);

-- The copy, once.
UPDATE commitments SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER)
 WHERE amount IS NOT NULL AND amount >= 0 AND amount <= 10000000000000;

-- Kept in step, by the same rule, on every insert and every change of the dollars.
CREATE TRIGGER IF NOT EXISTS trg_commitments_cents_ins
AFTER INSERT ON commitments
BEGIN
  UPDATE commitments
     SET amount_cents = CASE WHEN NEW.amount IS NOT NULL AND NEW.amount >= 0 AND NEW.amount <= 10000000000000
                             THEN CAST(ROUND(NEW.amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_commitments_cents_upd
AFTER UPDATE OF amount ON commitments
WHEN NEW.amount IS NOT OLD.amount
BEGIN
  UPDATE commitments
     SET amount_cents = CASE WHEN NEW.amount IS NOT NULL AND NEW.amount >= 0 AND NEW.amount <= 10000000000000
                             THEN CAST(ROUND(NEW.amount * 100) AS INTEGER) END
   WHERE id = NEW.id;
END;

-- The closing links.
ALTER TABLE fund_capital_calls ADD COLUMN closing_line_uid TEXT;
ALTER TABLE portfolio_positions ADD COLUMN closing_line_uid TEXT;
ALTER TABLE safe_issuances ADD COLUMN closing_line_uid TEXT;
ALTER TABLE deal_transfers ADD COLUMN closing_line_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_fund_capital_calls_closing_line ON fund_capital_calls (closing_line_uid) WHERE closing_line_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_positions_closing_line ON portfolio_positions (closing_line_uid) WHERE closing_line_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_safe_issuances_closing_line ON safe_issuances (closing_line_uid) WHERE closing_line_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_transfers_closing_line ON deal_transfers (closing_line_uid) WHERE closing_line_uid IS NOT NULL;
