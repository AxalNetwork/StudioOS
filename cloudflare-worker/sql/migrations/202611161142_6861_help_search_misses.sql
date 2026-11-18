-- D6861 (#6861): Help Center v2, the store of searches that found nothing.
-- Additive only.
--
-- help_search_misses counts, per UTC day, how many members searched the Help
-- Center for a query that found no guide. It has NO reader identity: a query,
-- a day and a number. The query is stored normalised (lower case, single
-- spaces, 2 to 80 characters); the Worker withholds a query that looks like
-- an email address or carries a run of six or more digits, so an account
-- number or an address typed into the box is never kept
-- (routes/help_center.ts). Rows older than 90 days are deleted on every write.
--
-- help_search_miss_marks is how a query is counted once per member per day,
-- and how a member is held to 20 counted queries a day. It holds the member's
-- id, so it is kept short: every write deletes marks older than two days.
CREATE TABLE IF NOT EXISTS help_search_misses (
  query     TEXT NOT NULL CHECK (length(query) BETWEEN 2 AND 80 AND query = lower(query)),
  day       TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  searches  INTEGER NOT NULL DEFAULT 0 CHECK (searches >= 0),
  PRIMARY KEY (query, day)
);
CREATE INDEX IF NOT EXISTS idx_help_search_misses_day ON help_search_misses (day);

CREATE TABLE IF NOT EXISTS help_search_miss_marks (
  user_id  INTEGER NOT NULL,
  query    TEXT NOT NULL,
  day      TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  PRIMARY KEY (user_id, query, day)
);
CREATE INDEX IF NOT EXISTS idx_help_search_miss_marks_day ON help_search_miss_marks (day);
