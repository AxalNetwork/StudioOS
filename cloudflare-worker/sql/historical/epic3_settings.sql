-- Epic 3 — Settings page schema (Cloudflare D1 / SQLite).
--
-- ONE-TIME APPLY ONLY. D1/SQLite does not support `ALTER TABLE ... ADD
-- COLUMN IF NOT EXISTS`, so the ALTER statements below WILL FAIL on
-- re-run with "duplicate column name". The CREATE TABLE / CREATE INDEX
-- statements use IF NOT EXISTS and are independently safe.
--
-- For day-to-day operation the worker runs an idempotent in-process
-- ensureSchema() (cloudflare-worker/src/routes/settings.ts) at first
-- request that catches the duplicate-column error per-statement. THIS
-- file is the durable source of truth for the schema; apply it once via:
--
--   npx wrangler d1 execute studioos-db --file=sql/epic3_settings.sql
--   npx wrangler d1 execute studioos-db --remote --file=sql/epic3_settings.sql
--
-- After the first apply, schema changes should be made by adding NEW
-- migration files (e.g. epic3_settings_002.sql) rather than re-running
-- this one.

-- ---------------------------------------------------------------------------
-- 1. users — additive columns (one-time only — see note above)
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN headshot_r2_key TEXT;
ALTER TABLE users ADD COLUMN jurisdictions TEXT;            -- JSON: ["US","GB",...]
ALTER TABLE users ADD COLUMN socials TEXT;                  -- JSON object
ALTER TABLE users ADD COLUMN notification_prefs TEXT;       -- JSON {event:{email,inapp,sms}}
ALTER TABLE users ADD COLUMN privacy_prefs TEXT;            -- JSON {public_profile:{...}}
ALTER TABLE users ADD COLUMN role_prefs TEXT;               -- JSON role-conditional
ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER DEFAULT 0; -- bumped by sign-out-everywhere
ALTER TABLE users ADD COLUMN deletion_requested_at TIMESTAMP;
ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT;      -- JSON array of SHA-256 hex hashes

-- ---------------------------------------------------------------------------
-- 2. email_change_requests — 24h confirm + 48h revocation window
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    old_email TEXT NOT NULL,
    new_email TEXT NOT NULL,
    confirm_token_hash TEXT NOT NULL UNIQUE,
    revoke_token_hash TEXT NOT NULL UNIQUE,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirm_expires_at TIMESTAMP NOT NULL,
    revoke_expires_at TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_change_requests(user_id);

-- ---------------------------------------------------------------------------
-- 3. user_sessions — one row per JWT mint, lets users see + revoke per-device
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    jti TEXT NOT NULL UNIQUE,         -- claim embedded in the JWT
    user_agent TEXT,
    ip TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_us_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_us_jti  ON user_sessions(jti);

-- ---------------------------------------------------------------------------
-- 4. founder_invites — co-founder invites (cap 10 per project, 14d expiry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS founder_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,                    -- nullable: founder may not have a project yet
    inviter_user_id INTEGER NOT NULL,
    invitee_email TEXT NOT NULL,
    invitee_name TEXT,
    role TEXT NOT NULL DEFAULT 'co-founder',
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fi_inviter ON founder_invites(inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_fi_project ON founder_invites(project_id);
