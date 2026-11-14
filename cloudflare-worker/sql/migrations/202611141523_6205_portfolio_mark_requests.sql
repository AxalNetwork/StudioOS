-- D6205 (#6205): an investor asks HQ to record a mark, correct one, or record a
-- follow-on round, for a company they hold.
--
--   portfolio_mark_requests  one row per request. `kind` is what is asked for:
--                            a mark (none, or a stale one), a correction of a
--                            recorded mark, or a follow-on round the book is
--                            missing. `state` is open until HQ answers it:
--                            resolved (with the mark recorded, when one was) or
--                            declined (with the reason). An investor has at
--                            most one open request per company, held by the
--                            partial unique index below, not only by the route.
--
-- Grep first (D689 D-t): no `portfolio_mark_requests` table, and no request
-- store on `portfolio_marks` or `portfolio_positions`, exists in
-- schema_baseline.sql or any migration.
--
-- Additive and idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS portfolio_mark_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  requester_user_id  INTEGER NOT NULL REFERENCES users(id),
  kind               TEXT NOT NULL CHECK (kind IN ('mark', 'correction', 'follow_on')),
  reason             TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  state              TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'declined')),
  resolved_by        INTEGER REFERENCES users(id),
  resolved_at        TEXT,
  resolved_mark_uid  TEXT,
  resolution_note    TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- An open request carries no answer; an answered one says who and when.
  CHECK ((state = 'open') = (resolved_at IS NULL)),
  CHECK ((state = 'open') = (resolved_by IS NULL)),
  -- Only a resolved request links a mark.
  CHECK (resolved_mark_uid IS NULL OR state = 'resolved')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_mark_requests_one_open
  ON portfolio_mark_requests (project_id, requester_user_id) WHERE state = 'open';

CREATE INDEX IF NOT EXISTS ix_portfolio_mark_requests_state
  ON portfolio_mark_requests (state, created_at);
