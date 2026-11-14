-- 338_partner_interactions_reminders.sql — the investor Network book's
-- interaction log and reminders (D465, wave 8, Session 17, item 6).
--
-- Canvas IN1's book is built on the cold flag — "a warm relationship untouched
-- for 96 days is not currently warm" — and `partner_relationships` records no
-- interaction date: the only history kept was that the row was created and
-- edited, so `Going cold` and `Coldest` had nothing to read and `Set
-- reminders` had nothing to write.
--
--   partner_interactions — one row per recorded touch: the relationship, the
--     kind, a note, when it happened, who recorded it. The relationship's
--     last touch is the log's MAX, never a field someone edits.
--
--   partner_reminders — one row per reminder: the relationship, when to
--     re-surface it, a note, done or not. No notification fan-out: the
--     reminder surfaces on the desk when it is due.
--
-- STANDS ALONE and idempotent. Apply through the ledger-driven runner:
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS partner_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  relationship_id INTEGER NOT NULL REFERENCES partner_relationships(id),
  kind TEXT NOT NULL DEFAULT 'note',
  note TEXT,
  interacted_at TEXT NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pint_rel ON partner_interactions(relationship_id, interacted_at);

CREATE TABLE IF NOT EXISTS partner_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  relationship_id INTEGER NOT NULL REFERENCES partner_relationships(id),
  remind_at TEXT NOT NULL,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prem_rel ON partner_reminders(relationship_id, done, remind_at);
CREATE INDEX IF NOT EXISTS idx_prem_due ON partner_reminders(created_by, done, remind_at);
