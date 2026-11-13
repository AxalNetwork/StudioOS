-- Task #6 — SMS 2FA via Google Cloud Identity Platform.
--
-- Adds the auth_sms storage table (phone encrypted at rest via the column
-- cipher; only the last-4 + country are stored in the clear), the
-- users.tfa_methods JSON list ("totp" / "sms"), and a `factor` column on
-- user_sessions so high-risk routes can gate on the factor that minted
-- the current session (requireFactor('totp')).
--
-- Re-running this file on a DB that already has these columns will fail on
-- the ALTERs ("duplicate column"), which is expected — the worker also
-- creates these idempotently at boot via ensureSchema(), so manual re-runs
-- of this file are not required after first apply.

CREATE TABLE IF NOT EXISTS auth_sms (
  user_id            INTEGER PRIMARY KEY,
  phone_ct           TEXT    NOT NULL,                 -- column cipher v1
  phone_last4        TEXT    NOT NULL,
  phone_country      TEXT    NOT NULL,                 -- ISO-3166 alpha-2
  firebase_uid       TEXT,
  enrolled_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_verified_at   TEXT,
  last_used_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sms_firebase ON auth_sms(firebase_uid);

-- JSON array of strings — currently "totp" and/or "sms". Source of truth
-- for the SettingsPage Security tab and the login factor picker.
ALTER TABLE users ADD COLUMN tfa_methods TEXT NOT NULL DEFAULT '[]';

-- Factor that minted this session ("totp" / "sms" / "recovery"). NULL for
-- pre-existing sessions; requireFactor() treats NULL as "unknown" and
-- denies. The login route writes this on session insert.
ALTER TABLE user_sessions ADD COLUMN factor TEXT;
