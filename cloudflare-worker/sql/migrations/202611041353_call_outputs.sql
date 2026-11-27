-- D4412: a member's selected post-call outputs, their jobs and per-project defaults.
-- NULL keeps older sessions on their existing manual/automatic processing path.
ALTER TABLE interview_sessions ADD COLUMN outputs TEXT;
CREATE TABLE interview_output_preferences (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 outputs TEXT NOT NULL,
 PRIMARY KEY (user_id, project_id)
);
CREATE TABLE interview_output_jobs (
 session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
 output TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 run_id TEXT NOT NULL,
 model TEXT,
 quote_microusd INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (session_id, output)
);
