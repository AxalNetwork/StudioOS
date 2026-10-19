-- 488 — consent before anything from a chat is kept (D754, #1893).
--
-- WHAT IT ADDS. One table and one column.
--   channel_consents          One row per consent request on a chat: Axal's
--                             in-chat notice (its version, when it was asked,
--                             when WhatsApp reported it delivered) and, on the
--                             same row, the answer — the interviewee's own
--                             ('interviewee_reply', method 'chat_reply') or the
--                             member's word once the notice reached them
--                             ('member_attested', method verbal | written |
--                             pre_agreed). A "No" or STOP after 'given'
--                             withdraws it ('withdrawn', `withdrawn_at`). A
--                             request the member moves away from is 'expired'.
--   channel_threads.consent_state
--                             What the gate reads: 'awaiting' | 'given' |
--                             'declined' | 'withdrawn', NULL where the provider
--                             asks for no consent (Telegram, until D756). It is
--                             written in the same batch as the consent row, so
--                             every reader of a thread row has it without a join.
--
-- NO MESSAGE TEXT, NO PHONE NUMBER, NO WAMID. `request_ref_hash` and
-- `reply_ref_hash` are `refKey` SHA-256 hashes of provider:id, as
-- `services/channels/events.ts` explains: a WhatsApp wamid carries the
-- customer's number in base64, and equality is all these columns are read for.
-- `reply_ref_hash` is UNIQUE, so a redelivered answer (a new event id, the
-- same wamid) is counted once.
--
-- WHY interview_sessions NEEDS NO CHANGE. Its `consent_method` has no CHECK
-- (438:35), so 'chat_reply' lands as is; `consent_status` already admits
-- given | declined | not_recorded (438:33-34).
--
-- WHY channel_events NEEDS NO REBUILD. Its `kind` CHECK already admits
-- 'command' (450:31), which is what a consent reply is claimed as.
--
-- THE FOREIGN KEYS. `session_id` is ON DELETE CASCADE: a consent goes with the
-- interview session it was given for, and with nothing else. `thread_id` is
-- ON DELETE SET NULL: a disconnect deletes the connection's threads but keeps
-- the interviews already made from them (D754 §7), and a consent given for one
-- of those must outlive the thread. Open requests do not outlive a disconnect:
-- `forgetConnection` deletes them explicitly. `capture_id` is NULL here and
-- has no foreign key; D754's forwarded-capture task deletes a capture's rows
-- with the capture in code.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction. Each statement stands
-- alone. Grepped first: no `channel_consents` table and no
-- `channel_threads.consent_state` column exists in schema_baseline.sql or an
-- earlier migration. Seeds nothing.

CREATE TABLE IF NOT EXISTS channel_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whatsapp', 'telegram')),
  integration_id INTEGER,
  thread_id INTEGER REFERENCES channel_threads(id) ON DELETE SET NULL,
  capture_id INTEGER,
  interview_id INTEGER,
  session_id INTEGER REFERENCES interview_sessions(id) ON DELETE CASCADE,
  source TEXT CHECK (source IS NULL OR source IN ('interviewee_reply', 'member_attested')),
  method TEXT CHECK (method IS NULL OR method IN ('chat_reply', 'verbal', 'written', 'pre_agreed')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'given', 'declined', 'withdrawn', 'expired')),
  notice_version INTEGER,
  request_ref_hash TEXT,
  reply_ref_hash TEXT UNIQUE,
  requested_at TEXT,
  delivered_at TEXT,
  answered_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status <> 'given' OR (source IS NOT NULL AND method IS NOT NULL AND answered_at IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL)
);

-- One open request per thread: of two concurrent presses, one insert wins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_consents_open_thread
  ON channel_consents(thread_id) WHERE status = 'requested' AND thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_consents_session ON channel_consents(session_id);
CREATE INDEX IF NOT EXISTS idx_channel_consents_thread ON channel_consents(thread_id, id);

ALTER TABLE channel_threads ADD COLUMN consent_state TEXT
  CHECK (consent_state IS NULL OR consent_state IN ('awaiting', 'given', 'declined', 'withdrawn'));
