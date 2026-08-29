-- 185 — a general person-to-person inbox.
--
-- The canvas describes "one unified inbox across intro / co-founder match /
-- role search / engagement / advisory threads". The word to be careful about
-- is UNIFIED, because it implies merging conversations that already exist.
-- They do not. D1 holds exactly two message-shaped stores today and neither is
-- a peer conversation:
--
--   * `advisor_messages` — the AI assistant transcript. Its `role` column is
--     'user' | 'assistant' | 'tool' | 'system'. Folding a model transcript into
--     a human inbox would misrepresent both.
--   * `customer_chat_threads` / `customer_chat_messages` — a Slack-bridged
--     support thread, keyed on `slack_channel` + `slack_thread_ts`. That is a
--     support channel with its own surface, not a message between two members.
--
-- So there is nothing to unify, and this is genuinely new. The inbox starts
-- empty, which is the honest state — and the page says where the assistant
-- transcript and support live rather than pretending they were merged in.
--
-- Three tables:
--
--   message_threads               a conversation, optionally ABOUT something
--   message_thread_participants   who is in it, and how far they have read
--   messages                      the messages themselves
--
-- The `subject_type` / `subject_id` pair is what makes a thread more than a
-- DM: a conversation can be pinned to the introduction, match, engagement,
-- service or session it is about, which is what lets the UI show a context
-- rail instead of a wall of names. Both are nullable — a plain direct message
-- is a thread about nothing, and that is a legitimate row, not a defect.
--
-- Unread is derived from `last_read_at` rather than stored as a count. A
-- stored counter is a second source of truth that drifts the first time a
-- write fails halfway, and it cannot answer "unread for whom" without a row
-- per participant anyway — which is this table.
--
-- NOT here: reactions, attachments, typing indicators, delivery receipts.
-- None of them have a surface asking for them yet, and an empty column is a
-- promise the UI has to keep.

CREATE TABLE IF NOT EXISTS message_threads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  subject            TEXT,
  -- What the conversation is about. NULL/NULL is a direct message.
  subject_type       TEXT,      -- introduction | match | engagement | service | session | job
  subject_id         INTEGER,
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'open',   -- open | archived
  last_message_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_threads_subject ON message_threads(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_msg_threads_recent  ON message_threads(last_message_at DESC);

CREATE TABLE IF NOT EXISTS message_thread_participants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id    INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL means "has never opened it", which is different from "read nothing
  -- since epoch" only in intent — but the intent is what the UI shows.
  last_read_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_msg_participants_user ON message_thread_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT NOT NULL UNIQUE,
  thread_id      INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
