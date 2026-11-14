-- 450 — `channel_events` admits the 'delete' event the Telegram adapter writes
-- (D684).
--
-- THE DEFECT. Migration 449 shipped with `channel_events.kind` admitting eleven
-- values. The Telegram Business adapter (`services/channels/telegram.ts`) also
-- normalises `deleted_business_messages`, and `routes/channels.ts` claims each
-- one with kind 'delete' before acting on it. On the applied 449 that claim
-- fails the CHECK, so a member deleting a message in a business chat would leave
-- it in the pending thread. 449 has been applied, so it is not edited
-- (`scripts/migration-immutability-gate.mjs`); this widens it.
--
-- WHY A REBUILD. SQLite cannot ALTER a CHECK constraint; the documented way to
-- widen one is create, copy, drop, rename (migration 266 is the precedent).
-- Nothing references `channel_events` by foreign key, and its one index is
-- recreated below. The constraint stays: only the list grows.
--
-- WHAT THE COLUMNS HOLD is unchanged: `external_event_id` (like
-- `external_message_id` in `channel_outbound` and `channel_thread_messages`) is
-- a SHA-256 of provider:id, never the provider's id, because a WhatsApp wamid
-- carries the customer's number in base64. Those columns are only compared for
-- equality.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction. Each statement stands
-- alone, in the order SQLite documents.

CREATE TABLE IF NOT EXISTS channel_events_450 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'whatsapp', 'zoom', 'google_meet')),
  external_event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'voice', 'echo', 'edit', 'delete', 'command', 'link', 'connection', 'status', 'meeting', 'transcript', 'ignored')),
  user_id INTEGER,
  thread_id INTEGER,
  session_id INTEGER,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'stored', 'done', 'ignored', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_event_id)
);

-- Columns named rather than `SELECT *`, so a column added to one side and not
-- the other fails here instead of shifting values silently.
INSERT INTO channel_events_450 (id, uid, provider, external_event_id, kind, user_id, thread_id, session_id, status, error, created_at, updated_at)
  SELECT id, uid, provider, external_event_id, kind, user_id, thread_id, session_id, status, error, created_at, updated_at FROM channel_events;

DROP TABLE channel_events;

ALTER TABLE channel_events_450 RENAME TO channel_events;

-- 449's index, recreated by name on the rebuilt table.
CREATE INDEX IF NOT EXISTS idx_channel_events_user ON channel_events(user_id, created_at);
