-- Task #10 (AC-1) — Personal Advisor backend.
--
-- Persistent dashboard chatbot that profiles every persona through Q&A
-- and writes answers back into the right pages via writeRouter.ts.
-- Replaces the standalone "Tell us about yourself" panel.
--
-- Tables:
--   advisor_conversations  — one row per persistent advisor session
--   advisor_messages       — raw chat turn log (user/assistant/tool)
--   advisor_answers        — Q&A history with the routed write target
--
-- The route layer (routes/advisor.ts) also runs `ensureSchema()` at
-- request time so an un-migrated dev D1 still boots cleanly. This file
-- is the canonical migration for `wrangler d1 execute --remote`.

CREATE TABLE IF NOT EXISTS advisor_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- 'founder' | 'investor' | 'mentor' | 'partner' | 'admin' | 'unknown'
  persona TEXT NOT NULL,
  -- 'active' | 'paused' | 'complete'
  state TEXT NOT NULL DEFAULT 'active',
  current_question_id TEXT,
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advisor_conv_user ON advisor_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS advisor_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  -- 'user' | 'assistant' | 'tool' | 'system'
  role TEXT NOT NULL,
  question_id TEXT,
  content TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advisor_msg_conv ON advisor_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS advisor_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  question_id TEXT NOT NULL,
  raw_value TEXT,
  -- where the writeRouter persisted the value (NULL when paywalled / skipped)
  saved_to_table TEXT,
  saved_to_column TEXT,
  saved_to_id TEXT,
  -- 'saved' | 'skipped' | 'paywalled' | 'failed' | 'noop'
  saved_status TEXT NOT NULL,
  saved_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(conversation_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_advisor_answers_user_q ON advisor_answers(user_id, question_id);
