-- Task #4 — Admin X (Twitter) posts + aggregator.
--
-- Mirrors the Telegram broadcaster (migration 067) but for X (twitter.com).
-- Additive, IF NOT EXISTS so the worker's `ensureXSchema()` lazy bootstrap
-- self-heals if this lands unapplied on prod (see replit.md pending-
-- migrations gotcha).
--
-- Tokens at rest:
--   `access_token_ct` / `refresh_token_ct` are AES-GCM ciphertext from
--   services/cryptoBox.ts (100k PBKDF2). Never store plaintext.

CREATE TABLE IF NOT EXISTS x_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  handle              TEXT NOT NULL UNIQUE,            -- e.g. 'axalvc' (no @)
  display_name        TEXT,
  x_user_id           TEXT,                            -- numeric string from X
  scopes              TEXT,                            -- space-joined scope list
  access_token_ct     TEXT,                            -- AES-GCM ciphertext
  refresh_token_ct    TEXT,
  expires_at          TEXT,
  enabled             INTEGER NOT NULL DEFAULT 1,
  last_test_at        TEXT,
  last_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_x_accounts_enabled ON x_accounts(enabled);

CREATE TABLE IF NOT EXISTS x_posts (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id               INTEGER NOT NULL REFERENCES x_accounts(id),
  status                   TEXT NOT NULL DEFAULT 'draft',
                           -- draft|approved|scheduled|sending|sent|failed|retracted
  body                     TEXT NOT NULL,              -- already includes hashtags
  hashtags                 TEXT,                       -- canonical csv for audit
  media_r2_keys            TEXT,                       -- json array of R2 keys (up to 4)
  alt_texts                TEXT,                       -- json array, parallel to media_r2_keys
  scheduled_for            TEXT,
  sent_at                  TEXT,
  tweet_id                 TEXT,                       -- X-assigned tweet id
  tweet_link               TEXT,
  in_reply_to_tweet_id     TEXT,                       -- populated for thread tail tweets
  thread_continuation_of   INTEGER REFERENCES x_posts(id),  -- parent post.id in our DB
  thread_position          INTEGER,                    -- 0-based position in a thread
  source                   TEXT NOT NULL DEFAULT 'manual',  -- manual|aggregator
  source_kind              TEXT,                       -- e.g. 'weekly_pulse'
  body_hash                TEXT,                       -- sha256 of body at send time
  send_error               TEXT,
  override_reason          TEXT,
  override_findings        TEXT,                       -- json of linter findings
  approved_by              INTEGER REFERENCES users(id),
  approved_at              TEXT,
  retracted_at             TEXT,
  retracted_by             INTEGER REFERENCES users(id),
  retraction_reason        TEXT,
  created_by               INTEGER NOT NULL REFERENCES users(id),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_x_posts_status   ON x_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_posts_account  ON x_posts(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_x_posts_thread   ON x_posts(thread_continuation_of, thread_position);
