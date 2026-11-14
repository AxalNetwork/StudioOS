-- 399 — the Brand page's voice tags, dark logo and Archived status on
-- landing_pages (D583, #1210; S1's decisions 1A, 2A and 3A for the owner).
--
--   voice_json         a JSON array of up to three free-text voice tags, trimmed
--                      and deduplicated by the route (1A). NULL: none recorded.
--   logo_dark_url,     the dark-background logo, uploaded through
--   logo_dark_svg,     /api/brand/logo/upload's type, size and storage checks and
--   logo_dark_asset_id stored through the same URL and SVG sanitizers as the
--                      light logo (3A). A dark template renders it when present.
--   archived_at        when the page was archived (2A). Archiving unpublishes the
--                      page and hides it from the page list; the row is kept, and
--                      restoring clears this. An archived page is never served
--                      publicly and cannot be published until restored.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration ledger
-- stops the replay. services/landingPageSchema.ts carries the same columns as
-- its D235 safety net.
ALTER TABLE landing_pages ADD COLUMN voice_json TEXT;
ALTER TABLE landing_pages ADD COLUMN logo_dark_url TEXT;
ALTER TABLE landing_pages ADD COLUMN logo_dark_svg TEXT;
ALTER TABLE landing_pages ADD COLUMN logo_dark_asset_id TEXT;
ALTER TABLE landing_pages ADD COLUMN archived_at TEXT;
