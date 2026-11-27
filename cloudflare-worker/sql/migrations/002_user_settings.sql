-- Task #20 — Phase B · Prompt 6 — Settings expansion (tabbed).
-- One row per user; created lazily on first read or write of any
-- /api/settings/{appearance,profile,privacy,notifications,…} sub-route.
--
-- Apply once per environment:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/002_user_settings.sql --remote --env=""
--
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  timezone TEXT DEFAULT 'UTC',
  locale TEXT DEFAULT 'en',
  pronouns TEXT,
  profile_slug TEXT UNIQUE,
  visibility TEXT DEFAULT 'network' CHECK (visibility IN ('public','network','private')),
  show_in_directory INTEGER DEFAULT 1,
  discoverable INTEGER DEFAULT 1,
  digest_frequency TEXT DEFAULT 'weekly',
  notif_categories_email TEXT DEFAULT '{}',
  notif_categories_inapp TEXT DEFAULT '{}',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  quiet_hours_tz TEXT DEFAULT 'UTC',
  theme TEXT DEFAULT 'system',
  density TEXT DEFAULT 'comfy',
  sidebar_default TEXT DEFAULT 'expanded',
  feature_flags TEXT DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_settings_slug
  ON user_settings(profile_slug)
  WHERE profile_slug IS NOT NULL;
