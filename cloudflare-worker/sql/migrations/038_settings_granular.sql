-- Task #6 (AL) — Settings: granular sub-section persistence.
--
-- Deployment-time DDL artifact for the eight Settings sub-routes:
--   GET/PUT /api/settings/profile/identity
--   GET/PUT /api/settings/profile/details
--   GET/PUT /api/settings/profile/legal-entity
--   GET/PUT /api/settings/notifications
--   GET/PUT /api/settings/privacy
--   GET/PUT /api/settings/appearance
--   GET/PUT /api/settings/developer
--   GET     /api/settings/integrations
--
-- All required columns and tables already ship in earlier migrations:
--
--   migration 002  user_settings (theme, density, sidebar_default, visibility,
--                  show_in_directory, discoverable, digest_frequency,
--                  notif_categories_email/inapp, quiet_hours_*, timezone,
--                  locale, pronouns, profile_slug UNIQUE, feature_flags)
--   migration 014  user_settings.dismissed_explainers (additive)
--   migration 015  users.* personal identity (display_name added in 024) +
--                  corporate_profiles table for the Legal entity tab
--   migration 024  users.display_name, users.headline
--
-- This file is the *idempotent restate* of the schema the AL routes depend
-- on so a fresh-DB single-file replay still works. It uses CREATE … IF NOT
-- EXISTS exclusively — no ALTER TABLE — so re-running on prod is safe.
--
-- The runtime helpers `ensureUserSettings()` and `ensureProfileExpansionSchema()`
-- continue to apply the additive `users.*` columns lazily on first request.
-- We DELIBERATELY do not duplicate those `ALTER TABLE users ADD COLUMN`
-- statements here — D1 has no `ADD COLUMN IF NOT EXISTS`, and a duplicate
-- column would abort the whole file. The runtime helpers' per-statement
-- try/catch is the canonical place for additive column work.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote --env="" \
--     --file=cloudflare-worker/sql/migrations/038_settings_granular.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1) user_settings — owns Notifications/Privacy/Appearance/Developer fields
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  timezone TEXT DEFAULT 'UTC',
  locale TEXT DEFAULT 'en',
  pronouns TEXT,
  profile_slug TEXT UNIQUE,
  visibility TEXT DEFAULT 'network'
    CHECK (visibility IN ('public','network','private')),
  show_in_directory INTEGER DEFAULT 1,
  discoverable INTEGER DEFAULT 1,
  digest_frequency TEXT DEFAULT 'weekly'
    CHECK (digest_frequency IN ('off','daily','weekly')),
  notif_categories_email TEXT DEFAULT '{}',
  notif_categories_inapp TEXT DEFAULT '{}',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  quiet_hours_tz TEXT DEFAULT 'UTC',
  theme TEXT DEFAULT 'system'
    CHECK (theme IN ('light','dark','system')),
  density TEXT DEFAULT 'comfy'
    CHECK (density IN ('comfy','compact')),
  sidebar_default TEXT DEFAULT 'expanded'
    CHECK (sidebar_default IN ('expanded','collapsed')),
  feature_flags TEXT DEFAULT '{}',
  dismissed_explainers TEXT NOT NULL DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_settings_slug
  ON user_settings(profile_slug)
  WHERE profile_slug IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) corporate_profiles — Legal entity tab (one row per user)
--    PII columns (tax_id_number) are stored encrypted via cryptoBox; the
--    *_last4 plaintext columns let the UI render `••••1234` without
--    decrypting on every render.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  entity_name TEXT,
  entity_type TEXT,
  registration_number TEXT,
  tax_id_number_enc TEXT,
  tax_id_last4 TEXT,
  registered_country TEXT,
  registered_address_line1 TEXT,
  registered_address_line2 TEXT,
  registered_city TEXT,
  registered_state TEXT,
  registered_postal TEXT,
  signing_authority_name TEXT,
  signing_authority_title TEXT,
  signing_authority_email TEXT,
  ubos_json TEXT NOT NULL DEFAULT '[]',
  directors_json TEXT NOT NULL DEFAULT '[]',
  insurance_carriers_json TEXT NOT NULL DEFAULT '[]',
  ubo_disclosed INTEGER NOT NULL DEFAULT 0,
  aml_high_risk_jurisdiction INTEGER NOT NULL DEFAULT 0,
  sanctions_last_checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_corp_profiles_high_risk
  ON corporate_profiles(aml_high_risk_jurisdiction)
  WHERE aml_high_risk_jurisdiction = 1;

CREATE INDEX IF NOT EXISTS idx_corp_profiles_country
  ON corporate_profiles(registered_country);
