-- D811 (#2257). Next free number after 516, allocated by the issue.
-- No recipient addresses or payloads in link reads, nonces or event receipts.
CREATE TABLE IF NOT EXISTS mail_link_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  audience TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mail_link_nonces (
  signature TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_link_nonces_expiry ON mail_link_nonces(expires_at);
-- The digest identifies (type, normalized email, message_id), not an address.
-- Each delivery's writes and its receipt commit together in one D1 batch.
CREATE TABLE IF NOT EXISTS mail_link_events (
  uid TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('unsubscribe', 'bounce', 'complaint')),
  audience TEXT,
  occurred_at TEXT NOT NULL,
  claim_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mail_link_events_claim ON mail_link_events(claim_uid);

-- Owner's option A: programme consent is independent of newsletters.
-- An opted-out programme keeps its consent history; fresh opt-in retires links.
ALTER TABLE testing_applications ADD COLUMN mail_enabled INTEGER NOT NULL DEFAULT 1 CHECK (mail_enabled IN (0, 1));
ALTER TABLE testing_applications ADD COLUMN mail_token_version INTEGER NOT NULL DEFAULT 1;
