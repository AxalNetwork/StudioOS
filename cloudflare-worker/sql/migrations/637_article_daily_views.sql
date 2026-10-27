-- 637 — Content queue part 4: daily views with no personal data, and the
-- followers each publish notified (D1294, #3390, part of #2383). Assigned by
-- D1290 (#2383 owner question 5: "yes, one row per article per day, with no
-- personal data").
--
-- article_daily_views — one row per published article per UTC day, counted
--   on the public read (`GET /api/articles/:slug`, routes/articles.ts) and
--   nowhere else. Like `public_pageviews` (migration 054) it holds a day and
--   a count only: no IP, user agent, cookie, account or referrer. A read by an
--   admin, by the article's own author or in an impersonated session is not
--   counted. `articles.views` stays the one all-time count it always was.
-- article_follower_reach — one row per publish of an article: the followers
--   of its author the fan-out tried (`followers`, never the author) and how
--   many notices were written (`notified`). Written by
--   `notifyAuthorFollowers` (routes/admin_articles.ts). No follower id is
--   stored.
--
-- Grep first (D689 D-t): no `article_daily_views` or `article_follower_reach`
-- table, and no daily article count by any other name, exists in an earlier
-- migration, in schema_baseline.sql or in a runtime bootstrap
-- (`ensureNewsSchema`). Nothing is backfilled: `articles.views` is one total
-- with no days, so no day before this migration has a count, and no publish
-- before it recorded how many followers it reached. Reads say Not recorded
-- for that time, never 0.

CREATE TABLE IF NOT EXISTS article_daily_views (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (article_id, day)
);
CREATE INDEX IF NOT EXISTS idx_article_daily_views_day ON article_daily_views(day);

CREATE TABLE IF NOT EXISTS article_follower_reach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  published_at TEXT NOT NULL,
  followers INTEGER NOT NULL CHECK (followers >= 0),
  notified INTEGER NOT NULL CHECK (notified >= 0 AND notified <= followers),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_article_follower_reach_article ON article_follower_reach(article_id, id DESC);
