-- 523 — D841 (#2464): member API keys for https://axal.vc/mcp and the
-- supported /api routes. The number is the one #2464 gives.
--
-- A key is `axk_<key_id>_<secret>`. Only `key_id` (public, 12 characters) and
-- the SHA-256 of the secret (64 hex characters) are stored; the secret is
-- returned once, at creation, and never again. Provider OAuth tokens are a
-- different security object and never live here.
--
-- Additive: one new table and its indexes, nothing backfilled. Rolling back is
-- switching API_KEYS_ENABLED off; nothing reads the table then.
CREATE TABLE IF NOT EXISTS member_api_keys (
  uid TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  key_id TEXT NOT NULL UNIQUE CHECK (length(key_id) = 12),
  secret_sha256 TEXT NOT NULL CHECK (length(secret_sha256) = 64),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  -- JSON arrays: the scopes and the projects.id values the key may use.
  -- Both are subsets of what the creator could grant, re-checked on every call.
  scopes_json TEXT NOT NULL,
  companies_json TEXT NOT NULL,
  -- The member's own cap for this key's AI tokens in a calendar month (UTC),
  -- in micro-USD; NULL is no per-key cap (the account's limits still apply).
  monthly_limit_microusd INTEGER CHECK (monthly_limit_microusd IS NULL OR
    (typeof(monthly_limit_microusd) = 'integer' AND monthly_limit_microusd BETWEEN 1 AND 9007199254740991)),
  rate_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_per_minute BETWEEN 1 AND 600),
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT CHECK (revoked_reason IS NULL OR revoked_reason IN ('revoked', 'rotated')),
  replaced_by_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_member_api_keys_user ON member_api_keys(user_id, revoked_at);
