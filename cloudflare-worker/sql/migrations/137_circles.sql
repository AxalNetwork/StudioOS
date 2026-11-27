-- Communities & Circles — admin-managed public network layer (D1 / SQLite).
-- Migration 137. Applied automatically by scripts/migrate-d1.mjs (numeric order,
-- ledgered in schema_migrations). Additive + idempotent; seeds NO rows.
--
-- Replaces the former HARDCODED CIRCLES array in frontend/src/data/network.js.
-- The public /circles page now starts EMPTY and only shows circles an admin has
-- published from /admin/circles. Public feed predicate: published = 1.
--
-- Shape mirrored (idempotently) at runtime by services/circlesSchema.ts so the
-- dev/preview D1 (which never runs `wrangler d1 execute`) still serves the
-- circles routes.

CREATE TABLE IF NOT EXISTS circles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'founder',   -- founder|investor|partner|advisor|city|topic
    access          TEXT NOT NULL DEFAULT 'public',    -- public|private
    tagline         TEXT,
    region          TEXT,
    theme           TEXT,
    members         INTEGER NOT NULL DEFAULT 0,
    activity        TEXT NOT NULL DEFAULT 'new',        -- active|growing|quiet|new
    upcoming_events INTEGER NOT NULL DEFAULT 0,
    discussions     INTEGER NOT NULL DEFAULT 0,
    tags            TEXT NOT NULL DEFAULT '[]',         -- JSON array of strings
    hosted_by       TEXT,
    featured        INTEGER NOT NULL DEFAULT 0,
    published       INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_circles_public_feed ON circles (published, featured, sort_order);
CREATE INDEX IF NOT EXISTS idx_circles_type ON circles (type);
CREATE INDEX IF NOT EXISTS idx_circles_access ON circles (access);
