-- 202611071530 — #4665 (D4665): a send is an operation with a recorded outcome.
--
-- One row per logical email the composer asks to send, written BEFORE any
-- provider I/O. `op_key` is chosen by the composer for one composition and
-- survives its retries; `fingerprint` binds the row to the intended mailbox,
-- recipient, subject, body and draft, so a replay of the same operation
-- recovers it and a changed message needs a new key.
--
--   pending    admitted; the provider has not answered (or the Worker died mid-call)
--   accepted   the provider accepted the message; whatever bookkeeping follows cannot undo it
--   refused    the provider definitely did not accept it; the reservation is released
--   uncertain  the provider may or may not have it; the member reconciles before another send
--
-- The row IS the per-member hourly reservation (20 an hour): admission is one
-- INSERT ... SELECT that counts the member's rows in the same statement, so
-- two concurrent sends cannot both take the last place. pending, accepted and
-- uncertain hold a place; refused releases it.
--
-- Additive: CREATE TABLE / INDEX IF NOT EXISTS, no data change.
CREATE TABLE IF NOT EXISTS mail_send_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES mail_accounts(id),
  op_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'refused', 'uncertain')),
  provider_message_id TEXT,
  sent_uid TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, op_key)
);
CREATE INDEX IF NOT EXISTS idx_mail_send_ops_user_at ON mail_send_ops (user_id, created_at, state);
