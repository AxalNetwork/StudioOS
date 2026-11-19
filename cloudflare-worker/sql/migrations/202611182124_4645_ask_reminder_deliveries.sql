-- 202611182124_4645 — D4645-p2 (#4645): an "Ask again" reminder and its
-- per-recipient deliveries, recorded so an interrupted reminder can be
-- reconciled instead of re-sent. Named by its UTC minute and issue (D4106, D5398).
--
--   update_ask_reminders   one row per reminder round of one ask: the round
--       the cooldown claim on `update_asks.asked_again_at` opened. It names
--       the update version whose recipients it reaches (`version_id`; NULL for
--       an update sent before D4636 versions), who asked, the claim's time,
--       and the caller's `request_key` when it sent one. (ask_id, claimed_at)
--       is unique, so one claim is one round; (ask_id, request_key) is
--       unique, so a request whose response was lost and is repeated with
--       the same key finds its original round rather than starting another.
--
--   update_ask_reminder_deliveries   one logical delivery per recipient per
--       round, and so per recipient per update version: UNIQUE (reminder_id,
--       user_id), reserved with INSERT … ON CONFLICT DO NOTHING in the same
--       batch as the claim. The states are D4636's delivery vocabulary
--       (`services/updateLifecycle.ts`) plus `skipped`:
--         reserved    reserved, not attempted
--         attempting  an attempt holds the claim (`attempt_claim`); one older
--                     than STALE_ATTEMPT_MS is read as ambiguous
--         delivered   the inbox row that carried it is `provider_ref`
--         declined    the notification path wrote no inbox row
--         failed      stopped before the notification path was called
--         ambiguous   the path was called and no outcome was recorded; it
--                     is looked for by `delivery_uid` (carried in the
--                     notification payload), never re-sent blind
--         skipped     checked just before sending and no longer due:
--                     `skip_reason` is replied | not_current_recipient |
--                     version_changed
--       `delivery_uid` is the delivery's own id. `attempts`, `last_attempt_at`
--       and `settled_at` are the recorded progress.
--
-- Grep first (D689 D-t): neither table, nor either index, exists in an earlier
-- migration, in schema_baseline.sql or in runtime DDL.
--
-- Additive: CREATE … IF NOT EXISTS only. No row is changed.

CREATE TABLE IF NOT EXISTS update_ask_reminders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  ask_id                INTEGER NOT NULL REFERENCES update_asks(id) ON DELETE CASCADE,
  update_id             INTEGER NOT NULL REFERENCES portfolio_updates(id) ON DELETE CASCADE,
  version_id            INTEGER REFERENCES portfolio_update_versions(id),
  request_key           TEXT CHECK (request_key IS NULL OR (length(request_key) BETWEEN 8 AND 80)),
  requested_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  claimed_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ask_id, claimed_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_update_ask_reminders_request ON update_ask_reminders (ask_id, request_key);
CREATE INDEX IF NOT EXISTS idx_update_ask_reminders_ask ON update_ask_reminders (ask_id, id);

CREATE TABLE IF NOT EXISTS update_ask_reminder_deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id      INTEGER NOT NULL REFERENCES update_ask_reminders(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  delivery_uid     TEXT NOT NULL UNIQUE,
  delivery_state   TEXT NOT NULL DEFAULT 'reserved'
                   CHECK (delivery_state IN ('reserved', 'attempting', 'delivered', 'declined', 'failed', 'ambiguous', 'skipped')),
  skip_reason      TEXT CHECK (skip_reason IS NULL OR skip_reason IN ('replied', 'not_current_recipient', 'version_changed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  attempt_claim    TEXT,
  last_attempt_at  TEXT,
  settled_at       TEXT,
  provider_ref     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (reminder_id, user_id)
);
