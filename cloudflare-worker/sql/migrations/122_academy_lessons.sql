-- Task — Fix Cloudflare cron D1 errors.
-- The hourly axal-search re-embed sweep SELECTs from `academy_lessons`, but
-- that table was only ever created lazily on a live /search or /search/backfill
-- request (ensureAcademySchema in routes/search.ts). In production the cron
-- can run before any search request has bootstrapped it, so the SELECT throws
-- `D1_ERROR: no such table: academy_lessons`. This migration guarantees the
-- table exists in production D1.
--
-- Shape MUST stay in sync with ensureAcademySchema() in
-- cloudflare-worker/src/routes/search.ts (CREATE TABLE IF NOT EXISTS there).
-- Additive-only; CREATE TABLE IF NOT EXISTS is replay-safe.

CREATE TABLE IF NOT EXISTS academy_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
