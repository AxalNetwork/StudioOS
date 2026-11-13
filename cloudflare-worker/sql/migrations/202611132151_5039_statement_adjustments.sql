-- D5039 part 3: explicit due dates and governed disputes, retaining every old receipt/key.
ALTER TABLE subsidiary_statements ADD COLUMN due_on TEXT;

CREATE TABLE subsidiary_statement_actions_5039 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  statement_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('issue', 'record_payment', 'void', 'record_dispute', 'set_due_date')),
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  amount_cents INTEGER,
  reference TEXT,
  currency TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO subsidiary_statement_actions_5039 SELECT * FROM subsidiary_statement_actions;
DROP TABLE subsidiary_statement_actions;
ALTER TABLE subsidiary_statement_actions_5039 RENAME TO subsidiary_statement_actions;
CREATE UNIQUE INDEX idx_statement_actions_key ON subsidiary_statement_actions(actor_user_id, idempotency_key);
CREATE INDEX idx_statement_actions_statement ON subsidiary_statement_actions(statement_uid, id);
