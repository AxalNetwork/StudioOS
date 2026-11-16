-- D6202 (#6202): the support ledger's lifecycle. A promise can carry a due date and move
-- promised -> in_progress -> delivered, or to cancelled; an introduction can record that its
-- meeting happened, and when.
--
-- Migration 237 put CHECK (state IN ('promised','delivered','withdrawn')) on the entries and
-- 202611092215 put the same vocabulary on the events table, so two new states need both tables
-- rebuilt; an ADD COLUMN cannot widen a CHECK. GOTCHAS: no transaction statements (D1 applies
-- the file as one batch), no foreign_keys toggle, and a rebuild recreates each table under its
-- OWN name before the rows are copied back. The events table references the entries with
-- ON DELETE CASCADE, so it is copied aside and dropped first: dropping the entries while it
-- still held rows would cascade-delete the history.
--
-- Existing rows read unchanged: every new column is NULL on them, and their states are all in
-- the wider vocabulary.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE portfolio_support_entries_copy_6202 AS SELECT * FROM portfolio_support_entries;
CREATE TABLE portfolio_support_entry_events_copy_6202 AS SELECT * FROM portfolio_support_entry_events;

DROP TABLE portfolio_support_entry_events;
DROP TABLE portfolio_support_entries;

CREATE TABLE portfolio_support_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  fund_id       INTEGER REFERENCES vc_funds(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  kind          TEXT    NOT NULL DEFAULT 'other'
                CHECK (kind IN ('intro', 'board_prep', 'hiring', 'customer',
                                'fundraising', 'other')),
  -- promised -> in_progress -> delivered; promised or in_progress -> cancelled or withdrawn.
  -- delivered, withdrawn and cancelled are terminal.
  state         TEXT    NOT NULL DEFAULT 'promised'
                CHECK (state IN ('promised', 'in_progress', 'delivered', 'withdrawn', 'cancelled')),
  hours         REAL,
  promised_at   TEXT,
  delivered_at  TEXT,
  withdrawn_at  TEXT,
  summary       TEXT    NOT NULL,
  outcome       TEXT,
  recorded_by   INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  revision      INTEGER NOT NULL DEFAULT 1,
  updated_by    INTEGER REFERENCES users(id),
  -- D6202: when the promise is due (YYYY-MM-DD). NULL = no due date, and an entry with none
  -- is never overdue.
  due_date      TEXT    CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  -- D6202: whether an introduction's meeting happened. NULL = not recorded; only an intro
  -- carries one (the route refuses it on any other kind).
  meeting_outcome TEXT  CHECK (meeting_outcome IS NULL OR meeting_outcome IN ('held', 'not_held')),
  meeting_at    TEXT    CHECK (meeting_at IS NULL OR meeting_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  cancelled_at  TEXT
);

INSERT INTO portfolio_support_entries
  (id, uid, fund_id, project_id, kind, state, hours, promised_at, delivered_at, withdrawn_at,
   summary, outcome, recorded_by, created_at, updated_at, revision, updated_by)
SELECT id, uid, fund_id, project_id, kind, state, hours, promised_at, delivered_at, withdrawn_at,
       summary, outcome, recorded_by, created_at, updated_at, revision, updated_by
  FROM portfolio_support_entries_copy_6202;

CREATE TABLE portfolio_support_entry_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT    NOT NULL UNIQUE,
  entry_id    INTEGER NOT NULL REFERENCES portfolio_support_entries(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 2),
  action      TEXT    NOT NULL CHECK (action IN ('amended', 'in_progress', 'delivered', 'withdrawn', 'cancelled')),
  from_state  TEXT    CHECK (from_state IS NULL OR from_state IN ('promised', 'in_progress', 'delivered', 'withdrawn', 'cancelled')),
  to_state    TEXT    CHECK (to_state IS NULL OR to_state IN ('promised', 'in_progress', 'delivered', 'withdrawn', 'cancelled')),
  changed_json TEXT   NOT NULL DEFAULT '[]',
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, revision)
);

INSERT INTO portfolio_support_entry_events
  (id, uid, entry_id, revision, action, from_state, to_state, changed_json, actor_user_id, created_at)
SELECT id, uid, entry_id, revision, action, from_state, to_state, changed_json, actor_user_id, created_at
  FROM portfolio_support_entry_events_copy_6202;

DROP TABLE portfolio_support_entry_events_copy_6202;
DROP TABLE portfolio_support_entries_copy_6202;

CREATE INDEX IF NOT EXISTS idx_support_project
  ON portfolio_support_entries(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_state
  ON portfolio_support_entries(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_fund
  ON portfolio_support_entries(fund_id);
-- D6202: the overdue sweep reads open entries by due date.
CREATE INDEX IF NOT EXISTS idx_support_due
  ON portfolio_support_entries(state, due_date);
CREATE INDEX IF NOT EXISTS idx_support_entry_events_entry
  ON portfolio_support_entry_events (entry_id, revision);
