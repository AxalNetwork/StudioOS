-- D8525 (#8525): the step after a venture's move (`afterMove`: in-flight
-- agent runs end `scope_moved`, the boards and teams are told) is owed, not
-- lost. The move's batch writes one pending row here; the move route marks it
-- done once the step succeeds, and the Worker tick retries the pending ones.
-- A minimal record of its own until #8516's per-effect record lands; the two
-- can merge then.
CREATE TABLE IF NOT EXISTS project_move_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  from_company_id INTEGER,
  to_company_id INTEGER,
  actor_user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  done_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_move_followups_pending
  ON project_move_followups (status, id);
