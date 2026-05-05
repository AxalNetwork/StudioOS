-- LinkedIn identity columns on users.
-- Idempotent on D1 (SQLite) only when run as separate statements; if a column
-- already exists, the corresponding ALTER will error and should be skipped
-- manually. The worker also runs these defensively at first-request time
-- via routes/linkedin.ts::ensureColumns(), so this file is mostly here for
-- documentation + manual `wrangler d1 execute` use.
ALTER TABLE users ADD COLUMN linkedin_sub TEXT;
ALTER TABLE users ADD COLUMN linkedin_email TEXT;
ALTER TABLE users ADD COLUMN linkedin_name TEXT;
ALTER TABLE users ADD COLUMN linkedin_connected_at TEXT;
