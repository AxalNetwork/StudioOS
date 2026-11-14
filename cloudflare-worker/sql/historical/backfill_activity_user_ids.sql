-- T16 — One-time backfill that used to run on every /api/activity request.
-- Idempotent: safe to re-run. Apply with:
--   npx wrangler d1 execute studioos-db --file=cloudflare-worker/sql/backfill_activity_user_ids.sql --remote
UPDATE activity_logs
   SET user_id = (
     SELECT id FROM users
      WHERE LOWER(users.email) = LOWER(activity_logs.actor)
   )
 WHERE user_id IS NULL
   AND actor IS NOT NULL;
