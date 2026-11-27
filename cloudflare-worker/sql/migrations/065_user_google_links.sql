-- Migration 061 (ALTER TABLE users ADD COLUMN google_sub) failed against
-- production D1 with "too many columns on sqlite_altertab_users" — the
-- users table has reached the column limit SQLite/D1 enforces during the
-- internal table-rewrite that ALTER TABLE performs. Stand up a side
-- table instead. One row per linked Google identity; user_id is PK so
-- at most one Google account per Axal account, and google_sub is UNIQUE
-- so at most one Axal account per Google identity. Matches the
-- semantics the original partial-unique index gave us on users.google_sub.
CREATE TABLE IF NOT EXISTS user_google_links (
  user_id    INTEGER PRIMARY KEY,
  google_sub TEXT    NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_links_sub
  ON user_google_links(google_sub);
