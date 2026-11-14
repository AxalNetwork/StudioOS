-- Task #1 (AE-1) — Settings expansion · schema source-of-truth.
--
-- Idempotent where SQLite/D1 allows it (CREATE TABLE / CREATE INDEX use
-- IF NOT EXISTS); the two new ALTER ADD COLUMN statements at the bottom
-- are not idempotent because D1's SQLite build doesn't support
-- "ADD COLUMN IF NOT EXISTS". The runtime helpers
-- `ensureProfileExpansionSchema()` and `ensureUserSettings()` re-apply
-- the same DDL on isolate boot, so a partial migration here is recovered
-- automatically — this file is purely the deployment-time artifact.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote --env="" \
--     --file=cloudflare-worker/sql/migrations/024_settings_expansion.sql
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1) corporate_profiles  (idempotent re-state of 015's table for the AE-1
--    contract — safe to re-run; CREATE IF NOT EXISTS short-circuits)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_profiles (
  user_id                       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  entity_name                   TEXT,
  entity_type                   TEXT,
  registration_number           TEXT,
  tax_id_number_enc             TEXT,
  tax_id_last4                  TEXT,
  registered_country            TEXT,
  registered_address_line1      TEXT,
  registered_address_line2      TEXT,
  registered_city               TEXT,
  registered_state              TEXT,
  registered_postal             TEXT,
  signing_authority_name        TEXT,
  signing_authority_title       TEXT,
  signing_authority_email       TEXT,
  ubos_json                     TEXT,
  directors_json                TEXT,
  insurance_carriers_json       TEXT,
  ubo_disclosed                 INTEGER NOT NULL DEFAULT 0,
  aml_high_risk_jurisdiction    INTEGER NOT NULL DEFAULT 0,
  sanctions_last_checked_at     TEXT,
  updated_at                    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corporate_profiles_country
  ON corporate_profiles(registered_country);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) user_settings.dismissed_explainers — idempotent index for AE-1
--    (the column itself ships in 014; the index is restated here for
--    completeness so a fresh-DB single-file replay still works.)
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_settings_slug
  ON user_settings(profile_slug) WHERE profile_slug IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Phase B additions on `users` — the two columns that are NEW in AE-1.
--    Re-running this file after these have been applied will fail with
--    "duplicate column name" on the first ALTER, which is expected.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN headline TEXT;
