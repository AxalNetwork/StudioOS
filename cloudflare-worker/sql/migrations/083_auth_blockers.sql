-- Task IB — Auth blockers: magic-link sign-in, passkeys (WebAuthn), step-up auth.
--
-- Additive-only. The CREATE TABLE / CREATE INDEX statements are IF NOT EXISTS
-- and safe to replay. The Worker also carries
-- services/authBlockersSchema.ts::ensureAuthBlockersSchema() as a lazy
-- bootstrap (mirrors ensureTelegramSchema / ensureCalendarOAuthSchema), so
-- prod works on first hit without a hot-path migration. Apply via:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/083_auth_blockers.sql
--
-- REPLAY CAVEAT (same trap as migration 060): SQLite has no
-- "ADD COLUMN IF NOT EXISTS". The three user_sessions ALTERs at the bottom are
-- NOT idempotent — if the lazy bootstrap already added the columns (any prod
-- request after deploy), re-running this file errors on the first duplicate
-- ALTER ("duplicate column name"). That error is expected and harmless (the
-- columns already exist). To land cleanly with no error, apply this file
-- BEFORE the new Worker takes its first request; otherwise just ignore the
-- duplicate-column failure.

-- ── BLOCK-AUTH-01 — passwordless email magic-link tokens ──────────────────
-- Keyed by email (NOT user_id): a magic link may sign up a brand-new account,
-- so the user row may not exist until /magic/verify runs. Single-use, ~15 min.
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,      -- SHA-256 hex of the raw token
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_magic_link_hash  ON magic_link_tokens(token_hash);

-- ── BLOCK-AUTH-02 — WebAuthn passkeys ────────────────────────────────────
-- Multi-row per user (a user may register several authenticators). The `users`
-- table is at D1's ALTER-column limit, but this is a new side table so that
-- limit does not apply. credential_id is globally UNIQUE per the WebAuthn spec.
CREATE TABLE IF NOT EXISTS passkeys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,    -- base64url
  public_key    TEXT NOT NULL,           -- base64url COSE public key bytes
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                    -- JSON array e.g. ["internal","hybrid"]
  device_type   TEXT,                    -- 'singleDevice' | 'multiDevice'
  backed_up     INTEGER NOT NULL DEFAULT 0,
  aaguid        TEXT,
  name          TEXT,                    -- user-facing label
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_cred ON passkeys(credential_id);

-- WebAuthn challenges — single-use, ~5 min. Stored in D1 (NOT KV) because the
-- ceremony is a strict request/response pair and KV is eventually consistent.
-- user_id is NULL for discoverable (usernameless) authentication ceremonies.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge   TEXT NOT NULL UNIQUE,      -- base64url
  user_id     INTEGER,
  kind        TEXT NOT NULL,             -- 'registration' | 'authentication'
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_webauthn_chal ON webauthn_challenges(challenge);

-- ── BLOCK-AUTH-03 — step-up auth columns on user_sessions ────────────────
-- user_sessions is NOT at the ALTER-rewrite limit (only `users` is), so these
-- ADD COLUMNs are safe. `last_step_up_at` records the most recent TOTP step-up;
-- `step_up_due_at` carries the per-session 7-day re-enrol deadline for
-- lower-assurance (magic-link) sessions. `assurance_level` finishes the
-- partial migration 060 ALTER (idempotent if already applied in dev).
ALTER TABLE user_sessions ADD COLUMN last_step_up_at TIMESTAMP;
ALTER TABLE user_sessions ADD COLUMN step_up_due_at  TIMESTAMP;
ALTER TABLE user_sessions ADD COLUMN assurance_level TEXT;
