-- One-shot ALTERs for queue_jobs. Run once.
-- Will throw "duplicate column" on re-run (expected — migration already applied).

ALTER TABLE queue_jobs ADD COLUMN started_at TEXT;
ALTER TABLE queue_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE queue_jobs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE queue_jobs ADD COLUMN dead_at TEXT;

INSERT OR IGNORE INTO _migrations (name) VALUES ('queue_jobs_lifecycle_columns');
