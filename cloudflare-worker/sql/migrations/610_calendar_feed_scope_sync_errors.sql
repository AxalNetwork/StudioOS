-- 610 — Calendar part 4: the whole-calendar private feed and the sync error
-- state (D1209, #3175, part 4 of #2420). Reserved for this part by #3175.
--
-- 1. THE WHOLE-CALENDAR FEED'S TOKEN. Migration 603 made one subscription
--    token per member per scope and allowed one scope, `my_events` (tickets
--    and hosted events). The whole calendar (every kind the member's own
--    calendar reads, "Mine") is a second scope, `calendar`, with its own
--    token, so a member can hand one address out and keep the other.
--    SQLite cannot widen a CHECK in place, so the table is rebuilt as 562
--    rebuilt `program_grants`: every row is copied with its id, its scope and
--    its hash, so no subscribed URL stops working. No trigger, index or
--    foreign key names `calendar_feed_tokens`; its two UNIQUE constraints are
--    declared again on the new table.
--
-- 2. THE SYNC ERROR STATE. A failed Google or Outlook sync used to answer
--    the one request that ran it and leave nothing behind: after a reload the
--    page said "connected" and showed the last good sync time. Each provider's
--    token table gains `last_sync_error` (a fixed code, never the provider's
--    text: `services/calendar/syncErrors.ts` names the codes) and
--    `last_sync_error_at`. A sync that completes clears both. The columns are
--    nullable, and nothing is backfilled: no earlier failure was recorded.
--
-- 3. THE COPIES A DISCONNECT KEEPS. A disconnect used to delete the member's
--    `calendar_sync_records` for that provider, so reconnecting the same
--    account pushed every session a second time beside the first copies. From
--    D1209 a disconnect keeps them unless the member chose "Remove the copies
--    first". `calendar_sync_retained` remembers which account they belong to:
--    one row per member per provider, holding an HMAC of the provider's
--    account id (never the id itself), as the Gmail-removal state marker
--    does. On the next connect the copies stay when the account matches and
--    are dropped when it does not; either way the row goes.
--
-- Grep first (D689 D-t): no `last_sync_error` column, no `calendar` feed
-- scope and no `calendar_sync_retained` table exists in an earlier migration
-- or in schema_baseline.sql.
-- `calendar_sync_records.last_error` (one copy's error) is a different fact
-- and is untouched.

CREATE TABLE IF NOT EXISTS calendar_feed_tokens_610 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        TEXT    NOT NULL DEFAULT 'my_events' CHECK (scope IN ('my_events', 'calendar')),
  token_sha256 TEXT    NOT NULL UNIQUE
                 CHECK (length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  UNIQUE (user_id, scope)
);

INSERT OR IGNORE INTO calendar_feed_tokens_610 (id, user_id, scope, token_sha256, created_at, last_used_at)
SELECT id, user_id, scope, token_sha256, created_at, last_used_at FROM calendar_feed_tokens;

DROP TABLE calendar_feed_tokens;

ALTER TABLE calendar_feed_tokens_610 RENAME TO calendar_feed_tokens;

ALTER TABLE google_oauth_tokens ADD COLUMN last_sync_error TEXT;
ALTER TABLE google_oauth_tokens ADD COLUMN last_sync_error_at TEXT;
ALTER TABLE microsoft_oauth_tokens ADD COLUMN last_sync_error TEXT;
ALTER TABLE microsoft_oauth_tokens ADD COLUMN last_sync_error_at TEXT;

CREATE TABLE IF NOT EXISTS calendar_sync_retained (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT    NOT NULL CHECK (provider IN ('google', 'microsoft')),
  account_marker TEXT    NOT NULL CHECK (length(account_marker) BETWEEN 1 AND 128),
  retained_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, provider)
);
