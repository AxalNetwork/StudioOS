-- D4423 (#4423): HQ's opt-in list; inert while AGENT_ENGINE remains off.
CREATE TABLE agent_engine_cohort (
 uid TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('user', 'company', 'project')),
 target_id INTEGER NOT NULL CHECK (target_id > 0),
 added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(kind, target_id)
);
