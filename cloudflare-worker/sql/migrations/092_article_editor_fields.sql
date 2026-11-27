-- Task #4 — Pro Article Editor Upgrades
-- Excerpt, SEO title, and canonical URL for richer article metadata.
-- SQLite does not support "ADD COLUMN IF NOT EXISTS"; prod may have this
-- applied via `ensureNewsSchema` PRAGMA backfill before this file runs.
ALTER TABLE articles ADD COLUMN excerpt TEXT;
ALTER TABLE articles ADD COLUMN seo_title TEXT;
ALTER TABLE articles ADD COLUMN canonical_url TEXT;
