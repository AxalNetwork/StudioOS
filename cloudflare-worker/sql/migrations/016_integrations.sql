-- Task #1 (Integrations Foundation) — provider registry tables.
--
-- Replaces the legacy `integrations` table the FastAPI backend used (Fernet-
-- encrypted columns). New schema is namespaced for the Cloudflare Worker
-- surface: credentials live in a single AES-GCM ciphertext blob keyed by
-- (table, column, rowId) via services/columnCipher.ts.
--
-- Apply via:
--   wrangler d1 execute studioos-db \
--     --file=cloudflare-worker/sql/migrations/016_integrations.sql \
--     --remote --env=""
--
-- All statements use IF NOT EXISTS so re-runs are no-ops.

CREATE TABLE IF NOT EXISTS integrations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  user_id               INTEGER NOT NULL,
  provider_key          TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'active',     -- active|paused|error|disconnected
  auth_type             TEXT NOT NULL,                      -- api_key|oauth2|webhook
  credentials_enc       TEXT,                               -- v1.<b64> (services/columnCipher.ts)
  webhook_secret_enc    TEXT,
  config_json           TEXT,                               -- non-secret per-conn config
  capabilities_json     TEXT,                               -- ["push_deals","pull_contacts"]
  scopes_json           TEXT,                               -- granted oauth scopes
  external_account_id   TEXT,
  external_account_name TEXT,
  last_synced_at        TIMESTAMP,
  last_error            TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_integrations_user      ON integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider  ON integrations(provider_key);
CREATE INDEX IF NOT EXISTS idx_integrations_status    ON integrations(status);

CREATE TABLE IF NOT EXISTS integration_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id    INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  provider_key      TEXT NOT NULL,
  direction         TEXT NOT NULL,                          -- inbound|outbound|internal
  event_type        TEXT NOT NULL,                          -- connect|sync|push|webhook|disconnect|error|oauth_callback
  status            TEXT NOT NULL,                          -- ok|error
  http_status       INTEGER,
  request_summary   TEXT,
  response_summary  TEXT,
  external_id       TEXT,
  payload_json      TEXT,                                   -- redacted; never raw secrets
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_integration_logs_int   ON integration_logs(integration_id, datetime(created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_user  ON integration_logs(user_id, datetime(created_at) DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_event ON integration_logs(event_type);

CREATE TABLE IF NOT EXISTS integration_waitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  provider_key  TEXT NOT NULL,
  notes         TEXT,
  notified_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider_key)
);
CREATE INDEX IF NOT EXISTS idx_integration_waitlist_provider ON integration_waitlist(provider_key);
