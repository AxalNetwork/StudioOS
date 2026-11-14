-- Task #18 — Founder-curated quotes on the Demo Day deck.
--
-- Adds a `featured` flag to discovery_interviews. The Demo Day deck's
-- "Early signal" slide quotes are picked by recency today; when at least
-- one interview is starred, the deck uses the starred ones instead.
--
-- Additive only (no rewrite): single ALTER TABLE + partial index. The
-- worker also lazily bootstraps this column via
-- `services/discoveryInterviewSchema.ts::ensureDiscoveryInterviewFeaturedColumn`
-- so first-hit on an environment that hasn't applied this migration yet
-- still works.

ALTER TABLE discovery_interviews ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project_featured
    ON discovery_interviews (project_id, featured);
