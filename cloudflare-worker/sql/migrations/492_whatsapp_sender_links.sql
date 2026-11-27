-- 492 — D754 way B, "Send to Axal" (#1937, wb1): a member links their own
-- WhatsApp to their Axal account by sending a one-time code to Axal's number,
-- then confirming in Axal. Number allocated by S1 (#1899).
--
-- 1. `channel_link_codes.provider` admits 'whatsapp_link' beside 'telegram'.
--    SQLite cannot ALTER a CHECK constraint, so the table is rebuilt the way
--    migration 450 rebuilt `channel_events`: create, copy, drop, rename. Every
--    column from 449, 451 and 458 is kept, with its meaning:
--      telegram_user_id   who redeemed the code. For 'whatsapp_link' it holds
--                         an HMAC of the sender's WhatsApp id, never the id.
--      claim_details_enc  columnCipher, AAD = the code's uid. For
--                         'whatsapp_link', the sender's id and '•••• 1234'.
--    Nothing references this table by foreign key; its three indexes are
--    recreated by name below.
--
-- 2. One member per number: a partial unique index on the HMAC'd number of an
--    active link. With `integrations`' own UNIQUE(user_id, provider_key) that
--    is also one number per member.
--
-- 3. `whatsapp_captures`, for part 2 (wb2, #1938): what a linked member
--    forwarded to Axal's number, waiting on the interviewee's consent. Media
--    refs are encrypted with columnCipher (AAD = the capture's uid).
--    `consent_id` names a `channel_consents` row (migration 488) without a
--    foreign key, so this file applies whichever lands first.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction. Each statement stands
-- alone, in the order SQLite documents.

CREATE TABLE IF NOT EXISTS channel_link_codes_492 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'whatsapp_link')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  telegram_user_id TEXT,
  confirmed_at TEXT,
  claim_details_enc TEXT,
  axal_confirmed_at TEXT,
  activated_at TEXT,
  cancelled_at TEXT
);

-- Columns named rather than `SELECT *`, so a column added to one side and not
-- the other fails here instead of shifting values silently.
INSERT INTO channel_link_codes_492 (id, uid, code_hash, user_id, provider, expires_at, used_at, created_at, updated_at,
    telegram_user_id, confirmed_at, claim_details_enc, axal_confirmed_at, activated_at, cancelled_at)
  SELECT id, uid, code_hash, user_id, provider, expires_at, used_at, created_at, updated_at,
    telegram_user_id, confirmed_at, claim_details_enc, axal_confirmed_at, activated_at, cancelled_at FROM channel_link_codes;

DROP TABLE channel_link_codes;

ALTER TABLE channel_link_codes_492 RENAME TO channel_link_codes;

-- 449's, 451's and 458's indexes, recreated by name on the rebuilt table.
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_user ON channel_link_codes(user_id, provider, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_tg_user ON channel_link_codes(telegram_user_id, provider);
CREATE INDEX IF NOT EXISTS idx_channel_link_codes_member ON channel_link_codes(user_id, provider, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_whatsapp_link
  ON integrations(provider_key, external_account_id)
  WHERE provider_key = 'whatsapp_link' AND status = 'active';

CREATE TABLE IF NOT EXISTS whatsapp_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  media_refs_enc TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'consented', 'imported', 'declined', 'expired')),
  fetch_by TEXT,
  consent_id INTEGER,
  session_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_captures_user ON whatsapp_captures(user_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_captures_fetch_by ON whatsapp_captures(status, fetch_by);
