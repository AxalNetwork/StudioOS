-- Task #66 — Rich profiles + follow system.
--
-- 1) Structured background fields live on a companion 1:1 table
--    `user_profile_ext` (keyed by user_id), NOT on `users`. `users` is at
--    Cloudflare D1's hard 100-column-per-table limit, so any
--    `ALTER TABLE users ADD COLUMN` aborts the deploy on prod with
--    "too many columns on sqlite_altertab_users". Same side-table pattern as
--    `author_websites` / `corporate_profiles`. Stored as JSON text; the app
--    parses them. They surface on the public person profile alongside
--    bio/socials/headline.
-- 2) `follows` — a lightweight follow graph for people (entity_type='user')
--    and startups (entity_type='project'). Distinct from `watchlist_items`
--    (an investor-only DD instrument); follows is open to any signed-in user.
--
-- (The startup website URL — projects.website — is ensured at runtime in
--  routes/projects.ts and is already present on prod, so it is intentionally
--  NOT re-added here to avoid a duplicate-column abort.)

CREATE TABLE IF NOT EXISTS user_profile_ext (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    experience     TEXT,  -- JSON array of {title, company|org, start, end, description|summary}
    education      TEXT,  -- JSON array of {school, degree, field, start, end}
    certifications TEXT,  -- JSON array of {name, issuer, year, url}
    website        TEXT,  -- personal / professional website URL
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

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
