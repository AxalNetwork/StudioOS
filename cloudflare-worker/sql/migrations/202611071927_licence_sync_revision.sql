-- #4686 (D4686) — a licence's branch synchronisation and its termination
-- consequences are ordered and remembered by REVISION, not by a clock.
--
-- Before this, `branch_licence` ordered copies by `pushed_at`, which HQ writes
-- as an ISO timestamp and the branch compares through SQLite's `datetime()`:
-- that truncates to the second, so two pushes inside one second compared equal
-- and the OLDER one (applied last) overwrote the newer. `licence_push_pending`
-- was keyed by licence alone, so a success for an old push deleted the row that
-- stood for a newer failed one. And a termination committed its status first
-- and ran its consequences afterwards with nothing recording that they were
-- owed, so a failure between the two left a terminated licence whose
-- administrators were still bound and a repeat request was refused as already
-- terminated.
--
-- Three additions, all additive (nothing applied is edited):
--   1. licence_sync_state       HQ's monotonic revision per licence, and the
--                                last revision a branch acknowledged.
--   2. licence_push_pending     gains the revision a retry row stands for and a
--                                short failure code. `code` stays NOT NULL; an
--                                empty string means "the deployment could not
--                                be resolved when this was recorded".
--   3. licence_termination_ops  the durable intent of one termination: which of
--                                its five consequences are done, written in the
--                                SAME batch as the terminal status and event.
--   4. branch_licence           gains the HQ revision it holds and whether the
--                                copy's sections were all written.

CREATE TABLE IF NOT EXISTS licence_sync_state (
  licence_id       INTEGER PRIMARY KEY REFERENCES territory_licences(id) ON DELETE CASCADE,
  hq_revision      INTEGER NOT NULL DEFAULT 0,
  branch_revision  INTEGER,
  last_success_at  TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE licence_push_pending ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licence_push_pending ADD COLUMN failure_code TEXT;

CREATE TABLE IF NOT EXISTS licence_termination_ops (
  licence_id     INTEGER PRIMARY KEY REFERENCES territory_licences(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'complete')),
  actor_user_id  INTEGER,
  note           TEXT NOT NULL,
  released_json  TEXT,
  revision       INTEGER,
  notices_state  TEXT NOT NULL DEFAULT 'pending' CHECK (notices_state IN ('pending', 'done', 'failed')),
  notify_state   TEXT NOT NULL DEFAULT 'pending' CHECK (notify_state  IN ('pending', 'done', 'failed')),
  admins_state   TEXT NOT NULL DEFAULT 'pending' CHECK (admins_state  IN ('pending', 'done', 'failed')),
  push_state     TEXT NOT NULL DEFAULT 'pending' CHECK (push_state    IN ('pending', 'done', 'failed')),
  unbind_state   TEXT NOT NULL DEFAULT 'pending' CHECK (unbind_state  IN ('pending', 'done', 'failed')),
  failure_step   TEXT,
  failure_code   TEXT,
  attempts       INTEGER NOT NULL DEFAULT 1,
  lease_until    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);

ALTER TABLE branch_licence ADD COLUMN hq_revision INTEGER;
ALTER TABLE branch_licence ADD COLUMN copy_state TEXT;
ALTER TABLE branch_licence ADD COLUMN copy_failed_sections TEXT;
