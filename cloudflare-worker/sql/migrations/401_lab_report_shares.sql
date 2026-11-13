-- 401_lab_report_shares.sql — D588 (#1215): a founder's scoring-report share.
--
-- One row is one link. The raw token is never stored: `token_hash` is its
-- SHA-256. The founder names one existing account (`grantee_user_id`); only
-- that account, signed in, can open it. `audience` is what that account is
-- allowed to see. `opens` counts successful opens and stops at `open_limit`.
-- `revoked_at` kills the link before expiry. `snapshot_json` is the official
-- run frozen at mint, so a later rescore does not change what the link shows.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS. No trigger.

CREATE TABLE IF NOT EXISTS lab_report_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  report_kind TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  audience TEXT NOT NULL,
  grantee_user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  open_limit INTEGER NOT NULL,
  opens INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  consented_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lab_report_shares_owner
  ON lab_report_shares(owner_user_id, project_id, id);
