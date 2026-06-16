-- 106_pain_groups.sql — Task #29
--
-- Founder-curated grouping of logged discovery pains for the Spin-Out
-- Demo Day deck's "PAIN FREQUENCY ACROSS INTERVIEWS" slide. Logged pains
-- stay plain strings in discovery_interviews.pains_json; these two tables
-- only hold the curation layer on top:
--
--   pain_groups          — a named theme (the slide row label) per project.
--   pain_group_aliases   — maps a normalized pain phrase to a group so
--                          paraphrases ("data is stale when we decide" vs
--                          "stale data at decision time") collapse into one
--                          ranked row. UNIQUE(project_id, phrase_norm) means
--                          a phrase belongs to exactly one group.
--
-- D1 has no `CREATE TABLE IF NOT EXISTS … ADD COLUMN`, but plain
-- `CREATE TABLE IF NOT EXISTS` is idempotent; the worker's
-- `ensurePainGroupsSchema()` in `services/painGroups.ts` self-heals on
-- first read so the deck/curation API works on environments where this
-- migration has not yet been applied. Apply with:
--
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/106_pain_groups.sql

CREATE TABLE IF NOT EXISTS pain_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pain_groups_project
    ON pain_groups (project_id);

CREATE TABLE IF NOT EXISTS pain_group_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES pain_groups(id) ON DELETE CASCADE,
    phrase_norm TEXT NOT NULL,
    display_phrase TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pain_group_aliases_project_phrase
    ON pain_group_aliases (project_id, phrase_norm);

CREATE INDEX IF NOT EXISTS idx_pain_group_aliases_group
    ON pain_group_aliases (group_id);
