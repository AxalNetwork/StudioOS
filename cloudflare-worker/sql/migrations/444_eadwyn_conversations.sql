-- 444 — the Worker AI rail's conversations and their connectors (D652, #1464).
--
-- eadwyn_conversations    one conversation in the rail: its member, the
--                         company active when it started, the workspace, a
--                         title from its first question, and the connector
--                         switches it turned on (connectors_json, '[]' by
--                         default: every switch starts off).
-- eadwyn_messages         each turn. An answer keeps the connectors it read
--                         and their freshness (sources_json) and the action
--                         it proposed, if any.
-- eadwyn_pending_actions  a write Eadwyn proposed: the connection, the
--                         target, the exact payload and its SHA-256. Only the
--                         member's confirm sends it (routes/eadwyn.ts), and a
--                         pending action older than 24 hours is refused.
--
-- Retention: kept until the member deletes the conversation, and deleted with
-- the account (ON DELETE CASCADE from users); messages and actions go with
-- their conversation.
--
-- Additive: CREATE TABLE / INDEX IF NOT EXISTS only. No BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS eadwyn_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  connectors_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eadwyn_conversations_user
  ON eadwyn_conversations(user_id, workspace, updated_at);

CREATE TABLE IF NOT EXISTS eadwyn_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES eadwyn_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  action_uid TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eadwyn_messages_conversation
  ON eadwyn_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS eadwyn_pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES eadwyn_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER,
  integration_id INTEGER NOT NULL,
  provider_key TEXT NOT NULL,
  target_label TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed', 'expired')),
  result_summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eadwyn_pending_actions_conversation
  ON eadwyn_pending_actions(conversation_id, id);
