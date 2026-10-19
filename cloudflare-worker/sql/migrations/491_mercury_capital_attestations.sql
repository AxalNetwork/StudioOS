-- 491 — An investor's proof of capital from their own Mercury (D752, #1888).
--
-- WHAT IT ADDS. One table, `capital_attestations`: a dated statement an
-- investor on HQ shares with Axal's admins, "at least $X was available on
-- <as_of>, in accounts held by <holder>", about one of their own open
-- commitments (a deal commitment, their Fund I application, or their Fund I
-- LP commitment). The Worker checks the floor against the investor's own
-- accounts inside the investor's own request (`services/capitalAttestations.ts`)
-- and stores the statement only.
--
-- A STATEMENT, NEVER A BALANCE. The sum the check reads is a local variable:
-- it is never stored, returned or logged. Only the floor the investor chose is
-- kept. A row is the investor's word, checked once, on its date: a later
-- balance or commitment change does not alter it. A correction is a new row,
-- which supersedes the active one for the same target.
--
-- NOTHING IN IT CAN MOVE MONEY. No column holds a payment, a recipient or an
-- instruction to Mercury.
--
-- NO ACCOUNT DATA IS STORED. No account number, account id, last four,
-- transaction or counterparty column exists, and no `integration_id`:
-- disconnecting Mercury does not revoke a dated statement. Money is integer
-- cents, a whole-dollar floor of at least $1,000.
--
-- FIXED AND FINAL. A trigger refuses any change to what the statement says
-- and who made it; the only moves are active → superseded, active → revoked
-- and superseded → revoked. The admin view count and the last view (#1890)
-- may change in any state. A row is never deleted.
--
-- `deal_id` and `fund_id` carry no foreign key, as
-- `mercury_personal_matches.target_id` carries none (477): deleting a deal
-- must never fail on a statement.
--
-- Grepped first: no `capital_attestations` table exists in schema_baseline.sql
-- or an earlier migration. Seeds nothing.

CREATE TABLE IF NOT EXISTS capital_attestations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  purpose             TEXT NOT NULL CHECK (purpose IN ('deal_commitment', 'lp_application', 'lp_commitment')),
  target_id           INTEGER NOT NULL CHECK (typeof(target_id) = 'integer' AND target_id > 0),
  deal_id             INTEGER CHECK (deal_id IS NULL OR deal_id > 0),
  fund_id             INTEGER CHECK (fund_id IS NULL OR fund_id > 0),
  amount_floor_cents  INTEGER NOT NULL CHECK (typeof(amount_floor_cents) = 'integer' AND amount_floor_cents >= 100000 AND amount_floor_cents % 100 = 0),
  as_of               TEXT NOT NULL CHECK (date(as_of) = as_of),
  expires_on          TEXT NOT NULL CHECK (expires_on = date(as_of, '+30 days')),
  holder_name         TEXT NOT NULL CHECK (length(trim(holder_name)) BETWEEN 1 AND 200),
  accounts_counted    INTEGER NOT NULL CHECK (typeof(accounts_counted) = 'integer' AND accounts_counted BETWEEN 1 AND 20),
  consent_version     TEXT NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 40),
  consented_at        TEXT NOT NULL DEFAULT (datetime('now')),
  state               TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'superseded', 'revoked')),
  revoked_at          TEXT,
  admin_view_count    INTEGER NOT NULL DEFAULT 0 CHECK (typeof(admin_view_count) = 'integer' AND admin_view_count >= 0),
  last_admin_view_at  TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((purpose = 'deal_commitment' AND deal_id IS NOT NULL AND fund_id IS NULL)
      OR (purpose = 'lp_commitment' AND fund_id IS NOT NULL AND deal_id IS NULL)
      OR (purpose = 'lp_application' AND deal_id IS NULL))
);

-- One active statement per target: a newer one supersedes it in the same batch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_capital_attestations_active
  ON capital_attestations(user_id, purpose, target_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_capital_attestations_user ON capital_attestations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capital_attestations_target ON capital_attestations(purpose, target_id, state);
CREATE INDEX IF NOT EXISTS idx_capital_attestations_fund ON capital_attestations(fund_id, state) WHERE fund_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_capital_attestations_fixed
BEFORE UPDATE ON capital_attestations
WHEN NEW.uid IS NOT OLD.uid OR NEW.user_id IS NOT OLD.user_id OR NEW.purpose IS NOT OLD.purpose
  OR NEW.target_id IS NOT OLD.target_id OR NEW.deal_id IS NOT OLD.deal_id OR NEW.fund_id IS NOT OLD.fund_id
  OR NEW.amount_floor_cents IS NOT OLD.amount_floor_cents OR NEW.as_of IS NOT OLD.as_of
  OR NEW.expires_on IS NOT OLD.expires_on OR NEW.holder_name IS NOT OLD.holder_name
  OR NEW.accounts_counted IS NOT OLD.accounts_counted OR NEW.consent_version IS NOT OLD.consent_version
  OR NEW.consented_at IS NOT OLD.consented_at
  OR (OLD.state = 'revoked' AND (NEW.state IS NOT OLD.state OR NEW.revoked_at IS NOT OLD.revoked_at))
  OR (OLD.state = 'superseded' AND NEW.state = 'active')
BEGIN
  SELECT RAISE(ABORT, 'capital_attestation_fixed');
END;

CREATE TRIGGER IF NOT EXISTS trg_capital_attestations_block_delete
BEFORE DELETE ON capital_attestations
BEGIN
  SELECT RAISE(ABORT, 'capital_attestations is append-only (D752). Revoke a statement instead of deleting it.');
END;
