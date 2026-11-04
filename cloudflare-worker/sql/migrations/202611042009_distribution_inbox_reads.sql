-- D4494: a member's read receipts for actual Distribution messages, not a shared unread flag.

CREATE TABLE IF NOT EXISTS grow_inbox_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  message_key TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, contact_id, message_key)
);
