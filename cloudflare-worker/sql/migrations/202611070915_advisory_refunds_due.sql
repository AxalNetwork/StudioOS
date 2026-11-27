-- D4703 (#4703) part 3: a charge that lands on a booking that was cancelled
-- or missed. Part 1 made such a booking unpayable, and the no-cancellation-fee
-- policy says it owes nothing; but a payment started before the cancel can
-- still succeed at the provider. The money was collected, so the booking says
-- `collected` (that is what happened), and this row says it is owed back.
--
-- One row per booking. Nothing refunds it automatically: moving money back is
-- an operator's act, recorded when they resolve the row.
CREATE TABLE IF NOT EXISTS advisory_refunds_due (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL UNIQUE,
  booking_uid       TEXT NOT NULL,
  booking_status    TEXT NOT NULL,
  payment_intent_id TEXT,
  amount_cents      INTEGER,
  currency          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT,
  resolved_by       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_advisory_refunds_due_open ON advisory_refunds_due (resolved_at, created_at);
