-- Task #10 (LD) — Public /team page + Admin > Team.
--
-- Admin-managed roster of leadership + venture partners surfaced on
-- https://axal.vc/team (Jekyll marketing site) via GET /api/public/team
-- and managed at /admin/team in StudioOS.
--
-- Single-source-of-truth table. NDA/KYC/onboarding state is intentionally
-- NOT modelled here — this is a marketing surface, not an HR system.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/066_team_members.sql
--
-- Worker also carries a lazy `ensureTeamMembersSchema()` helper that
-- runs the same CREATE TABLE IF NOT EXISTS on first hit, matching the
-- `ensurePartnerDirectoryColumns()` / `ensureMarketIntelSchema()`
-- recovery pattern documented in replit.md (per the gotcha that recent
-- migrations 056/060/062-064 landed unapplied on prod).

CREATE TABLE IF NOT EXISTS team_members (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  title             TEXT NOT NULL,
  location          TEXT,
  short_bio         TEXT,
  long_bio          TEXT,
  photo_r2_key      TEXT,
  focus_areas_json  TEXT NOT NULL DEFAULT '[]',
  social_linkedin   TEXT,
  social_x          TEXT,
  social_website    TEXT,
  social_email      TEXT,
  display_order     INTEGER NOT NULL DEFAULT 0,
  published         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_team_members_published_order
  ON team_members (published, display_order);

-- Seed: Guillaume Lauzier (CEO & Founder · Venture Partner).
-- INSERT OR IGNORE so re-applying the migration is a no-op rather than
-- a UNIQUE-constraint failure.
INSERT OR IGNORE INTO team_members
  (slug, name, title, location, short_bio,
   focus_areas_json, social_linkedin, social_x, social_website,
   display_order, published)
VALUES (
  'guillaume-lauzier',
  'Guillaume Lauzier',
  'CEO & Founder · Venture Partner',
  'Montréal · Global',
  'Founder of Axal — an API-first venture studio building category-defining startups with disciplined deal flow and shared platform underneath.',
  '["Venture Building","AI","Fundraising","Operations"]',
  'https://www.linkedin.com/in/guillaumelauzier/',
  'https://x.com/guillaumelauz',
  'https://axal.vc',
  0,
  1
);
