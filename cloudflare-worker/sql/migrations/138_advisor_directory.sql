-- Advisory Suite — founder-scoped advisor directory + advisor↔startup assignments.
-- Migration 138. Applied automatically by scripts/migrate-d1.mjs (numeric order,
-- ledgered in schema_migrations). Additive + idempotent; seeds NO rows.
--
-- Advisor profiles are created by promoting a Contacts-hub waitlist contact
-- (audience='advisor', source pipeline='brand-landing') into the Advisory Suite,
-- or later by the referral / staff-rec pipelines (not built here). Email is only
-- surfaced by the API when `source` is a trusted pipeline — the column always
-- stores it, the read layer (services/advisorProfilesSchema.ts) redacts it.
--
-- Shape mirrored (idempotently) at runtime by services/advisorProfilesSchema.ts
-- so the dev/preview D1 (which never runs `wrangler d1 execute`) still serves the
-- directory routes, and by backend/app/models/migrations.py for the dev FastAPI.

CREATE TABLE IF NOT EXISTS advisor_profiles (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id        INTEGER NOT NULL,
    name              TEXT NOT NULL,
    email             TEXT,
    bio               TEXT,
    sectors_json      TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    expertise_json    TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    linkedin_url      TEXT,
    hourly_rate       REAL,
    source            TEXT,                          -- brand-landing|referral|staff-rec|null
    status            TEXT NOT NULL DEFAULT 'active', -- active|archived
    source_contact_id INTEGER,                       -- link back to contacts.id
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advisor_profiles_founder ON advisor_profiles (founder_id, status);
CREATE INDEX IF NOT EXISTS idx_advisor_profiles_source_contact ON advisor_profiles (source_contact_id);

CREATE TABLE IF NOT EXISTS advisor_startups (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    advisor_profile_id INTEGER NOT NULL,
    project_id         INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (advisor_profile_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_advisor_startups_profile ON advisor_startups (advisor_profile_id);
CREATE INDEX IF NOT EXISTS idx_advisor_startups_project ON advisor_startups (project_id);
