-- D9034 (#9034): each exhausted job-queue message is mirrored into
-- cf_dlq_mirror exactly once. The DLQ consumer (src/queue-consumer.ts)
-- inserts with INSERT OR IGNORE against a unique message_id, so a retried
-- delivery of the same dead letter cannot add a second row; it also keeps the
-- message's idempotency_key, which a replay (POST /api/infra/dlq/:id/retry)
-- uses as the stem of its own key.
--
-- 1. Remove the duplicates a retried delivery left before this, keeping the
--    lowest id for each message_id (the first mirror of that message).
DELETE FROM cf_dlq_mirror
 WHERE id NOT IN (SELECT MIN(id) FROM cf_dlq_mirror GROUP BY message_id);

-- 2. One row per message from now on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_dlq_message ON cf_dlq_mirror(message_id);

-- 3. The message's idempotency key; NULL for rows mirrored before this file
--    and for a message that carried none.
ALTER TABLE cf_dlq_mirror ADD COLUMN idempotency_key TEXT;
