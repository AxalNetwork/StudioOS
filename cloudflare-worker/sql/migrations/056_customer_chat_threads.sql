-- Task #7 (IG) — Customer-chat threads for Studio/Institutional/Partner tiers.
--
-- Maps StudioOS user_id ↔ Slack channel + thread_ts so replies from the
-- Axal team in Slack can route back to the user's chat panel. One row per
-- (user, slack thread); the most-recent row for a user is treated as
-- their active thread.

CREATE TABLE IF NOT EXISTS customer_chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slack_channel TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'closed'
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  last_message_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cct_user
  ON customer_chat_threads(user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_cct_thread
  ON customer_chat_threads(slack_channel, slack_thread_ts);

CREATE TABLE IF NOT EXISTS customer_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  direction TEXT NOT NULL,                       -- 'in' (user→Slack) | 'out' (Slack→user)
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES customer_chat_threads(id)
);

CREATE INDEX IF NOT EXISTS idx_cct_msg_thread
  ON customer_chat_messages(thread_id, created_at);
