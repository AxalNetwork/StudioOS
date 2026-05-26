-- 074_discovery_validation_rating.sql — Task #14
--
-- Adds the founder-facing "How well does this solution address the
-- problem you experience?" rating + free-text comment on each
-- discovery interview. Both columns are additive and nullable so
-- existing rows keep rendering unchanged.
--
-- D1 has no `ADD COLUMN IF NOT EXISTS`. The worker's
-- `ensureDiscoveryValidationRatingColumns()` helper in
-- `services/discoveryInterviewSchema.ts` self-heals on first read
-- so the deck renders on environments where this migration has not
-- yet been applied. Apply with:
--
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/074_discovery_validation_rating.sql
--
-- Renumbered from the source branch's `041_discovery_validation_rating.sql`
-- (main was already at 073_telegram_signature.sql when this landed).

ALTER TABLE discovery_interviews ADD COLUMN validation_rating INTEGER;
ALTER TABLE discovery_interviews ADD COLUMN validation_comment TEXT;
