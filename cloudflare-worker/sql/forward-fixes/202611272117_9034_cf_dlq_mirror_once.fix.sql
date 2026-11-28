-- Forward fix for 202611272117_9034_cf_dlq_mirror_once.sql (D9034, #9034).
--
-- When to run it: the Worker was rolled back past #9034 while the migration stays applied (D1 is never rolled back).
-- The previous Worker's DLQ consumer mirrors a dead letter with a plain INSERT, so a redelivery of a message already
-- mirrored hits the unique index on message_id, throws, and is retried instead of acknowledged; the email and
-- syndication marks that follow the insert never run for it. This trigger skips that duplicate row without an error
-- (RAISE(IGNORE)), so the previous Worker acknowledges it and the table keeps one row per message. The candidate
-- Worker's INSERT OR IGNORE behaves the same with or without it. The migration's DELETE only removed duplicate
-- copies of a message, keeping the first; the previous Worker reads the remaining row, so nothing else needs undoing.
--
-- Idempotent (IF NOT EXISTS), and it deletes no row. The release-window rehearsal runs it on the migrated database
-- and on a clean build (D8532, step 5).

CREATE TRIGGER IF NOT EXISTS cf_dlq_mirror_skip_duplicate
BEFORE INSERT ON cf_dlq_mirror
WHEN EXISTS (SELECT 1 FROM cf_dlq_mirror m WHERE m.message_id = NEW.message_id)
BEGIN
  SELECT RAISE(IGNORE);
END;
