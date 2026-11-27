-- D5039 (#5039, part 2) — the governed actions on a subsidiary statement:
-- Mark issued, Record a payment and Void, each with a reason, a revision and a
-- client idempotency key.
--
--   subsidiary_statements.revision  starts at 0 and goes up by one on every
--       write to the row: a draw or re-draw, the dispute PATCH and each governed
--       action. A client reads it with the statement and sends it back as
--       `expected_revision`; an action whose revision is not the stored one
--       changes no row and answers 409 `changed_since_open` with the row as it
--       now stands. Existing statements read 0.
--
--   subsidiary_statements.last_action_uid  the uid of the governed action that
--       last wrote the row. The action's own insert below is conditional on it,
--       so the statement change and its action row land together or not at all,
--       inside one D1 batch, without relying on `changes()`.
--
--   subsidiary_statement_actions  one row per governed action that was
--       APPLIED: who, what, the reason, the before and after figures, and the
--       reply the client got. `(actor_user_id, idempotency_key)` is unique, so
--       a retry with the same key gets the stored reply (`replayed: true`)
--       instead of a second payment, and the same key sent with a different
--       request is refused (409 `idempotency_key_reused`). A refused action
--       writes nothing here: a refusal moved nothing, and the next try with the
--       same key is a new attempt.
--
-- Money stays integer minor units in the statement's own currency, as in 260.

ALTER TABLE subsidiary_statements ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subsidiary_statements ADD COLUMN last_action_uid TEXT;

CREATE TABLE IF NOT EXISTS subsidiary_statement_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  statement_uid TEXT NOT NULL,
  --   issue           draft -> issued
  --   record_payment  adds a received amount to paid; issued -> paid when settled
  --   void            draft or issued -> void, with nothing paid against it
  action TEXT NOT NULL CHECK (action IN ('issue', 'record_payment', 'void')),
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  -- A digest of what was asked (action, statement, revision, amount, reason,
  -- reference), so a reused key with a different request is told apart.
  request_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  -- record_payment only: what this payment added, and its bank reference.
  amount_cents INTEGER,
  reference TEXT,
  currency TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  -- The JSON reply the client got, replayed verbatim for the same key.
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_actions_key
  ON subsidiary_statement_actions(actor_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_statement_actions_statement
  ON subsidiary_statement_actions(statement_uid, id);
