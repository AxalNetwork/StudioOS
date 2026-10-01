-- 312_fund_call_ledger.sql — the fund call ledger: a call header and
-- append-only receipts (D371, wave 8, Session 9 item 2).
--
-- A GP's capital call existed only as a queue payload. `POST
-- /api/funds/:id/capital-call` enqueued `capital_call_notice`, whose job wrote
-- one `capital_calls` row per LP — pro-rata, as a REAL dollar share with no
-- rounding, so the rows of a $1,000 call across three equal LPs summed to
-- 999.99…, and nothing named the call they belonged to: no number, no purpose,
-- no total, no record of which line absorbed the rounding. Recording a payment
-- flipped a status and moved two dollar figures, with no receipt behind it and
-- nothing that said when the wire landed, how much of it, or who recorded it.
--
-- THE HEADER. `fund_capital_calls` is one row per call a GP issues: the fund,
-- the call's number within that fund (1, 2, 3…, assigned when it is written),
-- the amount in integer cents, the purpose and due date the GP typed, and the
-- ONE line that absorbed the rounding residual. Each LP's line is
-- floor(amount × commitment ÷ total commitment) cents; the pennies left over
-- (fewer than the number of lines) go to the largest commitment, lowest LP id
-- on a tie, so the lines always sum to the call exactly and the header names
-- where the difference went. Never dropped, never spread silently.
--
--   uid             TEXT     the call_uid the issuing route mints; the job's
--                              idempotency key, so a retried job writes no
--                              second header
--   call_number     INTEGER  per fund, UNIQUE (fund_id, call_number)
--   amount_cents    INTEGER  > 0, the call as issued
--   residual_cents  INTEGER  >= 0, the pennies the residual line carries
--   residual_lp_id  INTEGER  the limited_partners row that carries them, or
--                              NULL when the split came out exact
--   line_count      INTEGER  how many LP lines the call wrote
--
-- THE LINES stay in `capital_calls`, which every existing reader already
-- speaks. Two additive columns: `fund_call_id` names the header a line belongs
-- to (NULL for every line written before this migration, which the ledger
-- reads as "issued before calls were numbered"), and `amount_cents` carries the
-- line's exact share (NULL on those same older lines, whose REAL `amount`
-- readers round to cents). `amount` is still written, in dollars, so no
-- existing reader changes.
--
-- THE RECEIPTS. `capital_call_receipts` is one row per wire the GP records
-- against one LP's line: how much, the date it landed, the wire reference, who
-- recorded it. A line is paid when its receipts reach its amount. APPEND-ONLY
-- AND SEALED BY THE DATABASE: the two triggers below refuse every UPDATE and
-- every DELETE, from any writer — a route, a queue job or a `wrangler d1
-- execute` — the way migration 269 sealed the audit tables. A receipt recorded
-- in error is answered by the next receipt, never by rewriting this one. The
-- header is sealed the same way: a call, once issued, is what its LPs were
-- told.
--
-- STANDS ALONE: it depends on no other wave-8 migration. IDEMPOTENT except for
-- the two ALTERs, which SQLite cannot guard; the migration runner applies each
-- file once. No `BEGIN`/`COMMIT` statements — the `BEGIN` below opens a
-- TRIGGER BODY, which `scripts/check-sql-migrations.mjs` allows.

CREATE TABLE IF NOT EXISTS fund_capital_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  fund_id         INTEGER NOT NULL REFERENCES vc_funds(id),
  call_number     INTEGER NOT NULL CHECK (call_number > 0),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  purpose         TEXT,
  due_date        TEXT,
  residual_cents  INTEGER NOT NULL DEFAULT 0 CHECK (residual_cents >= 0),
  residual_lp_id  INTEGER REFERENCES limited_partners(id),
  line_count      INTEGER NOT NULL CHECK (line_count > 0),
  issued_by       INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fund_id, call_number)
);

CREATE INDEX IF NOT EXISTS idx_fund_capital_calls_fund
  ON fund_capital_calls(fund_id, call_number DESC);

ALTER TABLE capital_calls ADD COLUMN fund_call_id INTEGER REFERENCES fund_capital_calls(id);
ALTER TABLE capital_calls ADD COLUMN amount_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_capital_calls_fund_call
  ON capital_calls(fund_call_id);

CREATE TABLE IF NOT EXISTS capital_call_receipts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  capital_call_id     INTEGER NOT NULL REFERENCES capital_calls(id),
  limited_partner_id  INTEGER NOT NULL REFERENCES limited_partners(id),
  fund_id             INTEGER NOT NULL REFERENCES vc_funds(id),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  received_on         TEXT NOT NULL,
  reference           TEXT,
  source              TEXT NOT NULL DEFAULT 'receipt' CHECK (source IN ('receipt', 'mark_paid')),
  recorded_by         INTEGER NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_capital_call_receipts_line
  ON capital_call_receipts(capital_call_id);
CREATE INDEX IF NOT EXISTS idx_capital_call_receipts_fund
  ON capital_call_receipts(fund_id, created_at DESC);

-- ------------------------------------------------------------------ the seals
CREATE TRIGGER IF NOT EXISTS capital_call_receipts_block_update
BEFORE UPDATE ON capital_call_receipts
BEGIN
    SELECT RAISE(ABORT,
        'capital_call_receipts is append-only (D371). A recorded receipt cannot be rewritten; record the correcting receipt instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS capital_call_receipts_block_delete
BEFORE DELETE ON capital_call_receipts
BEGIN
    SELECT RAISE(ABORT,
        'capital_call_receipts is append-only (D371). Deleting a receipt would remove the record of money that arrived.'
    );
END;

CREATE TRIGGER IF NOT EXISTS fund_capital_calls_block_update
BEFORE UPDATE ON fund_capital_calls
BEGIN
    SELECT RAISE(ABORT,
        'fund_capital_calls is append-only (D371). An issued call is what its LPs were told; issue a new call instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS fund_capital_calls_block_delete
BEFORE DELETE ON fund_capital_calls
BEGIN
    SELECT RAISE(ABORT,
        'fund_capital_calls is append-only (D371). Deleting a call would orphan the lines and receipts written against it.'
    );
END;
