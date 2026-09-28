-- 341_approval_assignments.sql — who is looking at a board item (D470).
--
-- The approvals board reads eleven queues and does not decide them. Assignment
-- is a side record, not a status on those queues and not a thread: one current
-- reviewer per item, and an append-only event each time this route changes it.
-- What a queue's own console did stays on that console.
--
-- STANDS ALONE and idempotent. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS approval_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  assignee_user_id INTEGER NOT NULL,
  assigned_by_user_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lane, item_id)
);

CREATE TABLE IF NOT EXISTS approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'assigned'),
  actor_user_id INTEGER NOT NULL,
  assignee_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_events_item
  ON approval_events (lane, item_id, id);
