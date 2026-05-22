-- Task #2 — News with author proposals + admin review queue.
--
-- Public /news section on axal.vc with trust-gated authoring
-- (users.trust_score >= 70). Drafts flow through an admin review queue
-- with comments, request-changes / approve / reject paths, and an
-- iteration loop for rejected drafts.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/068_news_articles.sql
--
-- The worker also carries a lazy `ensureNewsSchema()` helper that runs
-- the same CREATE TABLE IF NOT EXISTS on first hit — mirrors the
-- ensureTelegramSchema/ensureTeamMembersSchema pattern documented in
-- replit.md, so the routes keep working if this migration lands
-- unapplied on prod.

CREATE TABLE IF NOT EXISTS articles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  subtitle          TEXT,
  body_markdown     TEXT NOT NULL DEFAULT '',
  body_html         TEXT,
  cover_r2_key      TEXT,
  cover_mime        TEXT,
  tags              TEXT,                                     -- JSON array
  sector            TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',            -- draft|submitted|in_review|changes_requested|approved|published|rejected
  author_user_id    INTEGER NOT NULL REFERENCES users(id),
  reviewer_user_id  INTEGER REFERENCES users(id),
  submitted_at      TEXT,
  reviewed_at       TEXT,
  approved_at       TEXT,
  published_at      TEXT,
  rejected_at       TEXT,
  rejection_reason  TEXT,
  word_count        INTEGER NOT NULL DEFAULT 0,
  read_minutes      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_status_pub
  ON articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author
  ON articles (author_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_queue
  ON articles (status, submitted_at);

CREATE TABLE IF NOT EXISTS article_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  rev             INTEGER NOT NULL,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  body_markdown   TEXT NOT NULL,
  status_at_save  TEXT NOT NULL,
  saved_by        INTEGER NOT NULL REFERENCES users(id),
  reason          TEXT,                                     -- 'submit'|'request_changes'|'reject'|'publish'|'manual'
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_revisions_article
  ON article_revisions (article_id, rev DESC);

CREATE TABLE IF NOT EXISTS article_review_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  anchor       TEXT,                                        -- optional line/section anchor
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article
  ON article_review_comments (article_id, created_at);

-- Rate-limit ledger for the 3-submissions / 7-day / author cap.
-- One row written every time an article transitions to 'submitted'.
CREATE TABLE IF NOT EXISTS article_submission_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id    INTEGER NOT NULL REFERENCES users(id),
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_article_submission_log_author
  ON article_submission_log (author_id, submitted_at DESC);
