-- Additive migration: extend the legacy activity_logs to also support
-- the partnernet-style columns. Existing inserts using (action, details,
-- actor) keep working; partnernet's (action_type, entity_type, entity_id,
-- ip_address, user_agent, metadata) writes/reads now succeed.
ALTER TABLE activity_logs ADD COLUMN action_type TEXT;
ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
ALTER TABLE activity_logs ADD COLUMN ip_address TEXT;
ALTER TABLE activity_logs ADD COLUMN user_agent TEXT;
ALTER TABLE activity_logs ADD COLUMN metadata TEXT DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_al_action ON activity_logs(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_entity ON activity_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_job_id INTEGER,
  job_type TEXT NOT NULL,
  payload TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  moved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dlq_type ON dead_letter_queue(job_type, moved_at);
