-- Task #7 (2026-05-10) — Admin-managed OAuth client credentials per
-- provider. Lets a non-engineer admin paste a client_id/secret pair
-- via the Admin UI without redeploying or running `wrangler secret put`.
--
-- Lookup precedence (see services/providerOauthKeys.ts:loadOauthCreds):
--   1. Worker env var (e.g. SLACK_CLIENT_ID/SLACK_CLIENT_SECRET)
--   2. Row in this table (`source: 'db'`)
--   3. Throw `<provider>_oauth_unconfigured` (route maps to 503)
--
-- Singleton-per-provider — `provider_key` is the primary key. Secret
-- is encrypted at rest via cryptoBox.encryptString (AES-GCM keyed off
-- AXAL_ENCRYPTION_SECRET || JWT_SECRET). client_id is stored in plain
-- text — it is not a secret (appears in OAuth authorize URLs).
CREATE TABLE IF NOT EXISTS provider_oauth_keys (
  provider_key       TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL,
  client_secret_enc  TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id INTEGER,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
