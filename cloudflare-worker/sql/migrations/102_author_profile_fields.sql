-- Task #31 — Author profile: bio, socials, photo.
--
-- Extends the author_websites side table with four new nullable profile
-- fields. All existing rows are unaffected (columns default to NULL).
--
-- D1/SQLite has no ALTER TABLE … ADD COLUMN IF NOT EXISTS. The
-- ensureAuthorWebsites lazy bootstrap (services/authorWebsites.ts) handles
-- idempotency on the hot path via individually try/catched execs; applying
-- this migration on prod avoids that cold-start overhead.
--
-- Apply: wrangler d1 execute studioos-db --remote --env production \
--          --file=cloudflare-worker/sql/migrations/102_author_profile_fields.sql

ALTER TABLE author_websites ADD COLUMN bio TEXT;
ALTER TABLE author_websites ADD COLUMN twitter_url TEXT;
ALTER TABLE author_websites ADD COLUMN linkedin_url TEXT;
ALTER TABLE author_websites ADD COLUMN photo_url TEXT;
