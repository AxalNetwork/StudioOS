-- 202611092215 — D4642 (#4642): a support entry's revision, the actor who last
-- amended it, and its append-only amendment history. Named by its UTC minute
-- (D4106).
--
-- A SUPPORT ENTRY IS STILL ONE `portfolio_support_entries` ROW (migration 237).
-- This adds what its editing lifecycle needs beside that row, following the
-- same shape D4636 used for a company update, so the two read alike:
--
--   portfolio_support_entries.revision
--       bumped by every amendment. A client that read revision N sends
--       `expected_revision: N`; the UPDATE is conditional on the revision still
--       being N, so two editors who both opened revision N cannot both write
--       it — the one whose statement lands wins and the other is refused with
--       `changed_since_open` and handed the row as it now stands. Rows written
--       before this migration default to 1, which is the revision their first
--       read reports, so an older client that sends nothing keeps working.
--
--   portfolio_support_entries.updated_by
--       who made the latest amendment. `recorded_by` already says who created
--       the entry; without this, an amendment by a second member was
--       unattributable. NULL means no amendment has been recorded since this
--       migration.
--
--   portfolio_support_entry_events
--       one row per accepted amendment, written in the same batch as the
--       UPDATE and never changed afterwards: no route issues an UPDATE or a
--       DELETE against this table. It carries the revision it produced, the
--       actor, the state transition when there was one, and the fields that
--       changed. (entry_id, revision) is unique, so the history cannot record
--       two different amendments as the same revision.
--
-- The state machine itself does not change: promised → delivered | withdrawn,
-- both terminal, enforced by migration 237's CHECK and by the route. What is
-- new is that an amendment to a terminal row (hours, outcome, what happened) is
-- recorded and attributed rather than applied silently.
--
-- No trigger: `routes/portfolio_support.ts` holds the rules.
--
-- Grep first (D689 D-t): no `portfolio_support_entry_events` table, and no
-- `revision` or `updated_by` column on `portfolio_support_entries`, exists in
-- an earlier migration or in schema_baseline.sql. Migration 237 creates the
-- table and is above BASELINE_CUTOFF (219), so it replays on a fresh database
-- before this file runs.
--
-- Additive: CREATE … IF NOT EXISTS and ADD COLUMN. No row is changed.

ALTER TABLE portfolio_support_entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portfolio_support_entries ADD COLUMN updated_by INTEGER REFERENCES users(id);

CREATE TABLE IF NOT EXISTS portfolio_support_entry_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT    NOT NULL UNIQUE,
  entry_id    INTEGER NOT NULL REFERENCES portfolio_support_entries(id) ON DELETE CASCADE,
  -- The revision this amendment produced: the row's `revision` after it landed.
  revision    INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 2),
  action      TEXT    NOT NULL CHECK (action IN ('amended', 'delivered', 'withdrawn')),
  -- NULL on an amendment that did not move the state.
  from_state  TEXT    CHECK (from_state IS NULL OR from_state IN ('promised', 'delivered', 'withdrawn')),
  to_state    TEXT    CHECK (to_state IS NULL OR to_state IN ('promised', 'delivered', 'withdrawn')),
  -- Which fields the amendment changed, as a JSON array of names. No value is
  -- copied here: the entry's own row and this table's revision say what it
  -- became, and a free-text summary is the member's, not telemetry.
  changed_json TEXT   NOT NULL DEFAULT '[]',
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_support_entry_events_entry
  ON portfolio_support_entry_events (entry_id, revision);
