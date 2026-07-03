-- Task #66 — Rich profiles + follow system.
--
-- 1) Structured background fields on users (JSON arrays + website). These
--    surface on the public person profile (founder/investor) alongside the
--    existing bio/socials/headline. Stored as JSON text; the app parses them.
-- 2) `follows` — a lightweight follow graph for people (entity_type='user')
--    and startups (entity_type='project'). Distinct from `watchlist_items`
--    (an investor-only DD instrument); follows is open to any signed-in user.

ALTER TABLE users ADD COLUMN experience TEXT;      -- JSON array of {title, company|org, start, end, description|summary}
ALTER TABLE users ADD COLUMN education TEXT;       -- JSON array of {school, degree, field, start, end}
ALTER TABLE users ADD COLUMN certifications TEXT;  -- JSON array of {name, issuer, year, url}
ALTER TABLE users ADD COLUMN website TEXT;         -- personal / professional website URL

-- 3) Startup website URL. The public startup profile's Site/Website button
--    prefers this explicit URL; when absent it falls back to a published
--    Brand & Landing page (landing_pages.slug → axal.vc/landing/:slug).
ALTER TABLE projects ADD COLUMN website TEXT;      -- startup website / homepage URL

CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_user_id INTEGER NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'project')),
    entity_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (follower_user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_user_id);
CREATE INDEX IF NOT EXISTS idx_follows_entity ON follows(entity_type, entity_id);
