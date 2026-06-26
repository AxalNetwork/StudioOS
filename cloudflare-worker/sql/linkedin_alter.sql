-- LinkedIn identity columns on users (audit L4).
-- These columns now ship in sql/schema.sql for fresh databases. For EXISTING
-- D1 databases, apply this file MANUALLY (`wrangler d1 execute`) — the worker
-- no longer performs a lazy request-path ALTER (that swallowed DDL errors and
-- masked schema drift). Run each statement separately; if a column already
-- exists the corresponding ALTER errors and should be skipped.
ALTER TABLE users ADD COLUMN linkedin_sub TEXT;
ALTER TABLE users ADD COLUMN linkedin_email TEXT;
ALTER TABLE users ADD COLUMN linkedin_name TEXT;
ALTER TABLE users ADD COLUMN linkedin_connected_at TEXT;
