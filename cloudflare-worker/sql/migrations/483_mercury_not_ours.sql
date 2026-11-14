-- 483 — "Not ours" for an unmatched Mercury credit (D749, #1838).
--
-- WHAT IT ADDS. One table, `mercury_not_ours`: an Admin's mark on a posted
-- bank credit that no record here should claim (a misrouted wire, another
-- entity's deposit, a duplicate). A marked line is no longer unmatched in
-- `GET /api/admin/mercury/transactions?match=none`, the monthly cash summary
-- or the quarterly report's count (#1777). A mark is withdrawn with a reason,
-- never deleted, and a sync that changes the line turns it `needs_review`.
--
-- A MARK, NOT A MATCH. `mercury_matches.target_kind` keeps 474's CHECK; a
-- match points at a record, and a mark says there is none. A line holds at
-- most one live match or one live mark: the writers check both inside their
-- INSERT, and the partial unique index below allows one live mark per line.
--
-- NOTHING IN IT CAN MOVE MONEY. A mark records an Admin's judgement about a
-- line already read back from a read-only token. No column holds a payment,
-- a recipient or an instruction to Mercury.
--
-- NO ACCOUNT NUMBER IS STORED. A mark names its line by
-- `mercury_transactions.id`; the line's account is its last four only (474).
-- `reason` is a key from `services/mercury/notOurs.ts` (kept in code so the
-- canvas can rename the labels without a migration); `note` is the Admin's
-- own words, returned on the Admin routes only. Money is integer cents.
--
-- Grepped first: no `mercury_not_ours` table, and no "not ours" column,
-- exists in schema_baseline.sql or an earlier migration. Seeds nothing.

CREATE TABLE IF NOT EXISTS mercury_not_ours (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  transaction_id   INTEGER NOT NULL REFERENCES mercury_transactions(id),
  reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 40),
  note             TEXT CHECK (note IS NULL OR length(note) <= 500),
  state            TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'needs_review', 'withdrawn')),
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  marked_by        INTEGER NOT NULL REFERENCES users(id),
  marked_at        TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_by     INTEGER REFERENCES users(id),
  withdrawn_at     TEXT,
  withdraw_reason  TEXT CHECK (withdraw_reason IS NULL OR length(withdraw_reason) BETWEEN 10 AND 500),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL))
);

-- One live mark per bank line.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mercury_not_ours_one_live
  ON mercury_not_ours(transaction_id) WHERE state <> 'withdrawn';

CREATE TRIGGER IF NOT EXISTS mercury_not_ours_block_delete
BEFORE DELETE ON mercury_not_ours
BEGIN
    SELECT RAISE(ABORT,
        'mercury_not_ours is append-only (D749). Withdraw a mark with a reason instead of deleting it.'
    );
END;
