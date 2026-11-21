-- D6156 (#6156): Deals v2 owner, due date and history (canvas DE07, DE08b).
--
-- DE08b draws the closing checklist as Item, Status, Owner, Due, Note, with an
-- Audit tab; DE07 draws an Owner column on the IC conditions. Migration 335
-- gave checklist items no owner and no due date, and its PATCH overwrote
-- state, done_by and done_at with no record, so undoing an item erased who
-- had done it. Migration 334 gave a condition only `created_by`.
--
-- ADDITIVE AND NULLABLE, WITH NO DEFAULTS. Every row written before this
-- migration reads owner and due as NULL, which the screen shows as Not
-- recorded. A default would invent an owner or a date nobody set.
--
--   owner_user_id  a platform user who owns the item or condition.
--   owner_label    a named party that is not a platform user ("Founder",
--                  "Company counsel"). Either, both or neither may be set.
--   due_date       a calendar date, YYYY-MM-DD; the route validates it.
--
-- `deal_closing_checklist_events` is append-only: one row per write to an
-- item (its creation included), with who wrote it, the state before and
-- after, the note given with the write, and the item's owner and due date as
-- they stand after it (nullable, no default). Reverting an item appends a new
-- row and keeps the earlier ones; the two triggers refuse UPDATE and DELETE.
-- Items written before this migration have no events: their history before
-- it was never recorded.
--
-- The ALTERs are not idempotent (D1's ALTER TABLE has no IF NOT EXISTS) and
-- run exactly once through the ledger-driven runner: npm run d1:migrate:remote

ALTER TABLE deal_closing_checklist_items ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE deal_closing_checklist_items ADD COLUMN owner_label TEXT;
ALTER TABLE deal_closing_checklist_items ADD COLUMN due_date TEXT;

ALTER TABLE ic_conditions ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE ic_conditions ADD COLUMN owner_label TEXT;

CREATE TABLE IF NOT EXISTS deal_closing_checklist_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES deal_closing_checklist_items(id),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('pending', 'done', 'blocked', 'skipped')),
  to_state TEXT NOT NULL CHECK (to_state IN ('pending', 'done', 'blocked', 'skipped')),
  note TEXT,
  at TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users(id),
  owner_label TEXT,
  due_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_deal_closing_events_item ON deal_closing_checklist_events(item_id, id);

CREATE TRIGGER IF NOT EXISTS trg_deal_closing_events_no_update BEFORE UPDATE ON deal_closing_checklist_events
BEGIN SELECT RAISE(ABORT, 'deal_closing_checklist_events_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_deal_closing_events_no_delete BEFORE DELETE ON deal_closing_checklist_events
BEGIN SELECT RAISE(ABORT, 'deal_closing_checklist_events_append_only'); END;
