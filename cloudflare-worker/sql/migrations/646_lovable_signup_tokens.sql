-- D1312 (#3432, Lovable part 4 of #2398): sign-ups from a Lovable-built page
-- into Demand and urgency signals.
--
-- lovable_signup_tokens: one sign-up address per landing-page experiment. Only
-- the SHA-256 of the token is stored; the token itself is re-derived for the
-- venture's writers from `uid` and the Worker's index secret
-- (services/lovable/signups.ts). A revoked row answers 404 for ever.
--
-- lovable_signup_seen: one row per accepted sign-up, holding a keyed hash of
-- (address, email) so a repeat is a no-op. It is the count; no name or email
-- is stored anywhere. The sign-up itself lands in waitlist_signups with
-- source 'lovable', an empty email and no landing_page_id.
CREATE TABLE IF NOT EXISTS lovable_signup_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  experiment_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_lovable_signup_tokens_experiment ON lovable_signup_tokens(project_id, experiment_id);

CREATE TABLE IF NOT EXISTS lovable_signup_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL REFERENCES lovable_signup_tokens(id) ON DELETE CASCADE,
  email_hmac TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(token_id, email_hmac)
);
