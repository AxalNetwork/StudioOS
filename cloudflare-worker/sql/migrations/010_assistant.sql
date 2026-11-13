-- Task #5 — Dashboard personal assistant chatbot.
--
-- Tables:
--   assistant_conversations  one per user-initiated chat thread
--   assistant_messages       full history (user + assistant + tool turns)
--   assistant_feedback       thumbs up/down per assistant message
--
-- Retention is enforced by the worker scheduled() handler:
--   * free  tier  -> 90 days
--   * paid  tier  -> 1 year
--   * admin opt-in (extended_retention=1) -> 5 years
-- The retention sweep runs daily at 04:10 UTC and deletes conversations
-- (CASCADE deletes messages + feedback) past their bucket TTL.

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid            TEXT UNIQUE NOT NULL,
  user_id        INTEGER NOT NULL,
  title          TEXT NOT NULL DEFAULT 'New conversation',
  model_default  TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  -- Aggregated per-conversation token + cost rollup. Updated atomically
  -- after every assistant turn so admin analytics can read these without
  -- scanning the messages table.
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cached_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,  -- USD * 1e6 to keep integer math
  message_count  INTEGER NOT NULL DEFAULT 0,
  extended_retention INTEGER NOT NULL DEFAULT 0, -- admin opt-in only
  archived_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_conv_user ON assistant_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conv_uid  ON assistant_conversations(uid);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content         TEXT NOT NULL,
  -- Optional structured payload: tool_calls JSON for assistant turns,
  -- tool_results JSON for tool turns, deep-link suggestions, etc.
  meta_json       TEXT,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cached_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistant_msg_conv ON assistant_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS assistant_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(message_id, user_id)
);

-- One-shot column add on users. SQLite has no IF NOT EXISTS for ADD
-- COLUMN, so re-running this file produces "duplicate column" — that's
-- expected and idempotent for our boot helper, which catches it.
ALTER TABLE users ADD COLUMN assistant_enabled INTEGER NOT NULL DEFAULT 0;
-- Admin-only opt-in for the 5-year retention bucket. Defaults off so no
-- regular user is silently held longer than the paid-tier 1y window.
ALTER TABLE users ADD COLUMN assistant_retain_history INTEGER NOT NULL DEFAULT 0;
