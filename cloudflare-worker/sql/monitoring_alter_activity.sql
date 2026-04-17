-- One-shot ALTER TABLE migration for activity_logs.
-- Run ONCE: npx wrangler d1 execute studioos-db --file=sql/monitoring_alter_activity.sql --remote
-- Re-running will fail on "duplicate column" — that's expected; it means the
-- migration already succeeded.

ALTER TABLE activity_logs ADD COLUMN latency_ms INTEGER;
ALTER TABLE activity_logs ADD COLUMN status_code INTEGER;
ALTER TABLE activity_logs ADD COLUMN endpoint TEXT;
ALTER TABLE activity_logs ADD COLUMN method TEXT;

INSERT OR IGNORE INTO _migrations (name) VALUES ('activity_logs_observability_columns');
