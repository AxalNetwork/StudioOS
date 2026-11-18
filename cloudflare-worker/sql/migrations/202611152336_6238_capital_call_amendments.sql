-- D6238 (#6238): a capital call's corrections and its withdrawal, each with who and when.
--
-- Migration 312 sealed `fund_capital_calls`: an issued call is what its LPs were told, so
-- the header refuses every UPDATE and DELETE. That seal stays. A correction is written
-- BESIDE the header, never over it: one row per act, append-only and sealed the same way.
--
--   kind 'due_date'   new_value is the corrected due date (YYYY-MM-DD); old_value the one
--                     it replaced (NULL when the call had none). The call's lines in
--                     `capital_calls` take the new date in the same batch, because every
--                     line reader (overdue, the LP's own view, the reminder draft) reads
--                     the line's date.
--   kind 'purpose'    new_value / old_value are the corrected and replaced purpose.
--   kind 'withdrawn'  the call is withdrawn. Allowed only while no line has a receipt, is
--                     paid, or carries a management-fee line (checked inside the write).
--                     lines_json keeps each line's share as issued, in cents
--                     ([{"line_id":…,"lp_id":…,"owed_cents":…}]), because the lines
--                     themselves are set to status 'withdrawn' with a zero amount, so no
--                     reader that sums what is owed or called counts them. The issued
--                     amount also stays on the sealed header.
--
-- The effective due date and purpose of a call are its latest row of that kind, else the
-- header's. One withdrawal per call (the partial unique index).
--
-- No transaction statements: D1 applies the file as one batch. The BEGIN below opens a
-- TRIGGER BODY, which `scripts/check-sql-migrations.mjs` allows.

CREATE TABLE IF NOT EXISTS fund_capital_call_amendments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  fund_call_id  INTEGER NOT NULL REFERENCES fund_capital_calls(id),
  fund_id       INTEGER NOT NULL REFERENCES vc_funds(id),
  kind          TEXT    NOT NULL CHECK (kind IN ('due_date', 'purpose', 'withdrawn')),
  old_value     TEXT,
  new_value     TEXT,
  reason        TEXT    CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  lines_json    TEXT    CHECK (lines_json IS NULL OR json_valid(lines_json)),
  recorded_by   INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (kind <> 'due_date' OR (new_value IS NOT NULL AND length(new_value) = 10)),
  CHECK (kind <> 'purpose' OR (new_value IS NOT NULL AND length(new_value) BETWEEN 1 AND 500)),
  CHECK (kind <> 'withdrawn' OR lines_json IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fund_capital_call_amendments_call
  ON fund_capital_call_amendments(fund_call_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_capital_call_withdrawn
  ON fund_capital_call_amendments(fund_call_id) WHERE kind = 'withdrawn';

CREATE TRIGGER IF NOT EXISTS fund_capital_call_amendments_block_update
BEFORE UPDATE ON fund_capital_call_amendments
BEGIN
    SELECT RAISE(ABORT,
        'fund_capital_call_amendments is append-only (D6238). A correction is answered by the next correction.'
    );
END;

CREATE TRIGGER IF NOT EXISTS fund_capital_call_amendments_block_delete
BEFORE DELETE ON fund_capital_call_amendments
BEGIN
    SELECT RAISE(ABORT,
        'fund_capital_call_amendments is append-only (D6238). Deleting it would lose who corrected or withdrew the call.'
    );
END;
