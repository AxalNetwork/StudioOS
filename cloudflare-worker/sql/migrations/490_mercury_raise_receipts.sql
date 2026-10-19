-- 490 — raise receipts on a founder's own Mercury (D752 §5, #1887).
--
-- WHAT IT ADDS. Two target kinds for D713's member matcher (#1778, 477):
-- `raise_prospect` (a committed prospect in the founder's raise pipeline) and
-- `deal_commitment` (an investor's commitment on one of the founder's deals).
-- `mercury_personal_matches.target_kind` carries 477's CHECK, and SQLite cannot
-- alter a CHECK, so the table is rebuilt with the wider CHECK and every row
-- copied by name (ids, uids and states kept), and both partial unique indexes
-- are recreated under their names. Then one trigger: a prospect whose amount
-- or stage changes after its receipt was confirmed has that receipt withdrawn
-- with a fixed reason, whichever writer changed it (`routes/contacts.ts`, the
-- D691 writer in `services/raiseWriters.ts`).
--
-- NOTHING IN IT CAN MOVE MONEY. A receipt records which bank line, read back
-- from the founder's Read Only token, paid which commitment.
--
-- NO ACCOUNT NUMBER IS STORED. A match keeps the transaction id, the last four,
-- signed cents and the posted date, as 477 does.
--
-- Grepped first: no `raise_prospect` or `deal_commitment` target kind, and no
-- `trg_raise_receipt_target_changed` trigger, exists in an earlier migration.
-- No runtime bootstrap creates `mercury_personal_matches` (only 477 does; no
-- `CREATE TABLE … mercury_personal_matches` in cloudflare-worker/src), and the
-- remote file import blocks concurrent queries until it completes (D713), so no
-- request can run between the DROP and the RENAME. migrate-d1.mjs sends this
-- whole file. No explicit transaction commands: D1 owns the import transaction.

CREATE TABLE mercury_personal_matches_490 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  integration_id INTEGER NOT NULL,
  mercury_transaction_id TEXT NOT NULL,
  account_last_four TEXT NOT NULL CHECK (length(account_last_four) = 4 AND account_last_four NOT GLOB '*[^0-9]*'),
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer'),
  posted_on TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('engagement_invoice', 'payout', 'partner_deal_settlement', 'raise_prospect', 'deal_commitment')),
  target_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('confirmed', 'withdrawn')),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  withdraw_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO mercury_personal_matches_490 (id, uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on,
                                          target_kind, target_id, state, confirmed_at, withdrawn_at, withdraw_reason, created_at, updated_at)
SELECT id, uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on,
       target_kind, target_id, state, confirmed_at, withdrawn_at, withdraw_reason, created_at, updated_at
  FROM mercury_personal_matches;

DROP TABLE mercury_personal_matches;
ALTER TABLE mercury_personal_matches_490 RENAME TO mercury_personal_matches;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_transaction ON mercury_personal_matches(mercury_transaction_id) WHERE state = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_target ON mercury_personal_matches(target_kind, target_id) WHERE state = 'confirmed';

-- Decision 9: a changed prospect withdraws its receipt. Saving the same values
-- again, or changing `commit_status` alone, does not fire it.
CREATE TRIGGER IF NOT EXISTS trg_raise_receipt_target_changed
AFTER UPDATE OF amount, stage ON raise_prospects
WHEN NEW.amount IS NOT OLD.amount OR NEW.stage IS NOT OLD.stage
BEGIN
  UPDATE mercury_personal_matches
     SET state = 'withdrawn', withdrawn_at = datetime('now'), updated_at = datetime('now'),
         withdraw_reason = 'The prospect''s amount or stage changed after the match (D752).'
   WHERE target_kind = 'raise_prospect' AND target_id = NEW.id AND state = 'confirmed';
END;
