/**
 * D652 (#1464) — the three tables behind an Eadwyn conversation, as the
 * migration will create them. HELD HERE UNTIL S1 GIVES THE MIGRATION NUMBER:
 * a CREATE in src/ that no migration declares fails
 * runtime_schema_declared_d235, and the Worker never creates these tables
 * itself. When the number comes, this text moves verbatim into
 * `cloudflare-worker/sql/migrations/<n>_eadwyn_conversations.sql` and the
 * tests read that file instead.
 *
 * Retention: a conversation is kept until the member deletes it, and goes
 * with the account (`ON DELETE CASCADE` from `users`). Its messages and
 * pending actions go with it.
 */
export const EADWYN_SCHEMA_SQL = `
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
`;
