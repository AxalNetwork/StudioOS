-- T8 — atomic queue-job idempotency.
--
-- Problem: `queue-consumer.ts` previously deduped via KV (get-then-put),
-- which is not atomic — two concurrent redeliveries of the same Cloudflare
-- Queue message both pass the `await env.RATE_LIMITS.get(k)` check before
-- either writes, and both side-effect the world (double-charge LPs,
-- double-bump fund ledgers, etc.). A SQL PRIMARY KEY makes the race
-- impossible: `INSERT OR IGNORE` either inserts (we own this delivery) or
-- silently no-ops (`changes() == 0` → ack-skip).
--
-- `result_json` lets the consumer cache the original outcome so a
-- duplicate redelivery can be ack'd with the same response shape (useful
-- when we later expose synchronous /enqueue + poll APIs).
--
-- Retention: rows live forever for now (cheap — one row per job). A daily
-- prune job can drop entries older than 30d once we observe steady state.
--
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS job_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  first_seen_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_json     TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_idem_first_seen
  ON job_idempotency(first_seen_at);

-- Backfill: every queue_jobs row that is already terminal (completed/failed)
-- gets a sentinel idempotency entry so a redelivery from CF Queue after the
-- migration deploys doesn't re-execute it. Synthetic key format
-- "queue_job:<id>" matches what we'll write for in-flight legacy jobs.
INSERT OR IGNORE INTO job_idempotency (idempotency_key, first_seen_at)
  SELECT 'queue_job:' || id,
         COALESCE(completed_at, dead_at, updated_at, created_at)
    FROM queue_jobs
   WHERE status IN ('completed', 'failed');
