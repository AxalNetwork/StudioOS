-- 603 — My events part 3, item 2: "Subscribe to my events" (D1033, #2874).
-- Reserved for this item by S21 on #2874.
--
-- A calendar client (Google, Outlook, Apple) fetches a subscribed URL with no
-- session, so the my-events `.ics` feed needs a credential of its own. It is a
-- per-member secret in the URL, and because the feed carries join links for the
-- seats the member holds, it has to be revocable: a leaked URL must stop
-- working when the member replaces or removes it.
--
-- ONLY THE TOKEN'S SHA-256 IS STORED. The token is shown once, when it is made,
-- and a database read can never turn back into a working URL.
--
-- ONE TOKEN PER MEMBER PER SCOPE. Making a new one replaces the old one in the
-- same row (UNIQUE (user_id, scope)), so the old URL stops at once. `scope` has
-- one word today, `my_events`; a later feed adds its word to the CHECK.
--
-- Grep first (D689 D-t): no `calendar_feed_tokens` table, and no feed, ics or
-- subscribe token column, exists in an earlier migration or in
-- schema_baseline.sql.

CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        TEXT    NOT NULL DEFAULT 'my_events' CHECK (scope IN ('my_events')),
  token_sha256 TEXT    NOT NULL UNIQUE
                 CHECK (length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  UNIQUE (user_id, scope)
);
