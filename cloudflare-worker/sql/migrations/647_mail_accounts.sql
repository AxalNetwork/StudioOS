-- 647 — the member's own mailboxes, what was sent from them, and the one-use
-- nonces a send and an OAuth handshake spend (D1340, #3548; part 1 of #3547).
--
-- Mail always goes from the member's own mailbox, never from Axal's house
-- token (`services/email.ts` stays for system mail).
--
-- `mail_accounts.credentials` is the provider's secrets (an OAuth refresh
-- token, or an IMAP/SMTP app password with its hosts) sealed by
-- `services/columnCipher.ts`, the helper EIN storage uses, its AAD bound to
-- the row's uid. It is never read back to a client. Disconnecting revokes at
-- the provider where it can, empties `credentials` and marks the row
-- `revoked`; the row stays so its sent rows still name the address.
--
-- `mail_sent.recipient_hash` is `indexHmac` of the lower-cased address, for
-- counting without the address; `recipient` is shown to the member alone.
--
-- `mail_nonces` holds a hash of each nonce, never the nonce: `send` (the
-- composer's pressed confirmation) and `oauth` (a connect's state). A nonce is
-- spent once, by setting `used_at`.
--
-- Additive: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS mail_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap', 'mcp')),
  address TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  scopes TEXT,
  can_read INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0, 1)),
  credentials TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_user ON mail_accounts(user_id, status);

CREATE TABLE IF NOT EXISTS mail_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES mail_accounts(id),
  recipient TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider_message_id TEXT,
  draft_uid TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_sent_user ON mail_sent(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_sent_account ON mail_sent(account_id);

CREATE TABLE IF NOT EXISTS mail_nonces (
  nonce_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('send', 'oauth')),
  provider TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_nonces_user ON mail_nonces(user_id, kind);
