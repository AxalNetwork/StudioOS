-- D9017 (#9017): a capital-call line's "bank reversed" state, which a person resolves (D8534 owner answer b).
--
-- One row per receipt whose bank line failed, was cancelled or was restated after the receipt was recorded. The
-- Mercury sync writes it (services/mercury/store.ts `upsertTransaction`) in the same batch that turns the confirmed
-- match `needs_review`, once per receipt: a replayed sync, or a second change to the same bank line, finds the row
-- and adds nothing (`UNIQUE (receipt_id)`).
--
-- Nothing is reversed. The receipt, the line's paid state, the LP's paid-in and the fund's deployed capital stand
-- (answer b). The row is what keeps the reversal visible after the match is rejected; only the resolve act
-- (`POST /api/funds/:id/capital-calls/bank-reversals/:uid/resolve`, the GP of record or an Admin) closes it, and it
-- records who, when and why on the row itself.
--
-- KEPT, NOT REWRITTEN. The triggers below refuse a DELETE, any change to what was detected, and any change once the
-- row is resolved: a resolution is said once and stays. The CHECK keeps the three resolution columns together.
CREATE TABLE IF NOT EXISTS capital_call_bank_reversals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  fund_id             INTEGER NOT NULL REFERENCES vc_funds(id),
  capital_call_id     INTEGER NOT NULL REFERENCES capital_calls(id),
  receipt_id          INTEGER NOT NULL UNIQUE REFERENCES capital_call_receipts(id),
  match_id            INTEGER NOT NULL REFERENCES mercury_matches(id),
  transaction_id      INTEGER NOT NULL REFERENCES mercury_transactions(id),
  cause               TEXT NOT NULL CHECK (cause IN ('failed', 'cancelled', 'restated')),
  -- The bank's status and amount when the change was read, beside the receipt's cents.
  bank_status         TEXT,
  bank_amount_cents   INTEGER NOT NULL,
  receipt_cents       INTEGER NOT NULL CHECK (receipt_cents > 0),
  detected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at         TEXT,
  resolved_by         INTEGER REFERENCES users(id),
  resolution_note     TEXT,
  CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL
        AND length(trim(resolution_note)) BETWEEN 10 AND 1000)
  )
);

CREATE INDEX IF NOT EXISTS idx_capital_call_bank_reversals_line
  ON capital_call_bank_reversals(capital_call_id);
CREATE INDEX IF NOT EXISTS idx_capital_call_bank_reversals_open
  ON capital_call_bank_reversals(fund_id) WHERE resolved_at IS NULL;

CREATE TRIGGER IF NOT EXISTS capital_call_bank_reversals_block_delete
BEFORE DELETE ON capital_call_bank_reversals
BEGIN
  SELECT RAISE(ABORT, 'capital_call_bank_reversals: a bank reversal is kept (D9017); resolve it instead of deleting it.');
END;

CREATE TRIGGER IF NOT EXISTS capital_call_bank_reversals_block_rewrite
BEFORE UPDATE ON capital_call_bank_reversals
WHEN OLD.resolved_at IS NOT NULL
  OR NEW.uid IS NOT OLD.uid OR NEW.fund_id IS NOT OLD.fund_id OR NEW.capital_call_id IS NOT OLD.capital_call_id
  OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.match_id IS NOT OLD.match_id OR NEW.transaction_id IS NOT OLD.transaction_id
  OR NEW.cause IS NOT OLD.cause OR NEW.bank_status IS NOT OLD.bank_status OR NEW.bank_amount_cents IS NOT OLD.bank_amount_cents
  OR NEW.receipt_cents IS NOT OLD.receipt_cents OR NEW.detected_at IS NOT OLD.detected_at
BEGIN
  SELECT RAISE(ABORT, 'capital_call_bank_reversals: what was detected is kept, and a resolution is final (D9017).');
END;
