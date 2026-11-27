-- D1614 CO2-CO5 (#3976): company compliance tasks on D1384's store.
-- The owner's rule (2026-11-01): companies carry the legal and compliance
-- duties, projects carry the work. compliance_events held only project rows
-- (project_id NOT NULL), so a company-level task had nowhere to live. The owner
-- chose (2026-11-02, on this task) to rebuild the one store rather than add a
-- second: project_id becomes nullable and the table gains
--   company_id          the company the duty belongs to (back-filled from the
--                       project for every existing row; a row names a project,
--                       a company or both, never neither);
--   assignee_kind       'person' | 'agent' | NULL, with assignee_user_id or
--                       assignee_agent_id (a company seat or a company agent);
--   review_state        'ready_for_review' when an agent or a person has
--                       prepared it; only a company admin marks it done;
--   needs_reassignment  set when its assignee's company seat ends.
-- A proof document is deferred (the owner, 2026-11-02): it needs an upload and
-- its storage accounting (D1168, D1170) together, so no file column ships here.
-- Every existing column, id and the AUTOINCREMENT high-water mark are kept.
--
-- THE REBUILD (GOTCHAS: drop and recreate under the table's OWN name, never a
-- scratch table renamed into place). obligation_agenda_items and
-- obligation_occurrences (462) reference compliance_events ON DELETE CASCADE,
-- and DROP TABLE's implicit delete runs that cascade whether or not the
-- constraint checks are deferred, so both are copied aside first and copied
-- back after the parent rows, ids intact.
--
-- New, additive: compliance_task_events (each task's comments and timeline, by
-- people and agents, with an agent entry's cost) and scope_tasks.compliance_ref
-- (a project item doing the work for one obligation). No transaction
-- statements (D1 rejects them).
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE compliance_events_keep_co3 AS SELECT * FROM compliance_events;
CREATE TABLE obligation_agenda_items_keep_co3 AS SELECT * FROM obligation_agenda_items;
CREATE TABLE obligation_occurrences_keep_co3 AS SELECT * FROM obligation_occurrences;
CREATE TABLE compliance_seq_keep_co3 AS SELECT seq FROM sqlite_sequence WHERE name = 'compliance_events';

DROP TABLE compliance_events;

CREATE TABLE compliance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id),
    entity_id INTEGER REFERENCES entities(id),
    jurisdiction TEXT NOT NULL,
    event_type TEXT NOT NULL,            -- annual_report | franchise_tax | registered_agent | board_meeting | other
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT NOT NULL,              -- ISO 'YYYY-MM-DD'
    completion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (completion_status IN ('pending', 'completed', 'snoozed')),
    completed_at TEXT,
    completed_by_user_id INTEGER REFERENCES users(id),
    recurrence TEXT NOT NULL DEFAULT 'annual',  -- annual | quarterly | monthly | one_time
    source TEXT NOT NULL DEFAULT 'auto',         -- auto | manual
    reminders_sent_json TEXT NOT NULL DEFAULT '[]',
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT,
    owner_user_id INTEGER REFERENCES users(id),
    owner_name TEXT,
    created_by INTEGER REFERENCES users(id),
    remind_days_json TEXT,
    company_id INTEGER REFERENCES company_profiles(id),
    assignee_kind TEXT CHECK (assignee_kind IS NULL OR assignee_kind IN ('person', 'agent')),
    assignee_user_id INTEGER REFERENCES users(id),
    assignee_agent_id INTEGER REFERENCES team_agents(id),
    review_state TEXT CHECK (review_state IS NULL OR review_state = 'ready_for_review'),
    needs_reassignment INTEGER NOT NULL DEFAULT 0 CHECK (needs_reassignment IN (0, 1)),
    UNIQUE (project_id, event_type, due_date),
    CHECK (project_id IS NOT NULL OR company_id IS NOT NULL),
    CHECK ((assignee_kind IS NULL AND assignee_user_id IS NULL AND assignee_agent_id IS NULL)
        OR (assignee_kind = 'person' AND assignee_user_id IS NOT NULL AND assignee_agent_id IS NULL)
        OR (assignee_kind = 'agent' AND assignee_agent_id IS NOT NULL AND assignee_user_id IS NULL))
);

INSERT INTO compliance_events (
    id, uid, project_id, entity_id, jurisdiction, event_type, title, description, due_date,
    completion_status, completed_at, completed_by_user_id, recurrence, source, reminders_sent_json,
    created_by_user_id, created_at, updated_at, kind, owner_user_id, owner_name, created_by, remind_days_json,
    company_id)
SELECT k.id, k.uid, k.project_id, k.entity_id, k.jurisdiction, k.event_type, k.title, k.description, k.due_date,
    k.completion_status, k.completed_at, k.completed_by_user_id, k.recurrence, k.source, k.reminders_sent_json,
    k.created_by_user_id, k.created_at, k.updated_at, k.kind, k.owner_user_id, k.owner_name, k.created_by, k.remind_days_json,
    (SELECT p.company_id FROM projects p WHERE p.id = k.project_id)
  FROM compliance_events_keep_co3 k ORDER BY k.id;

-- Keep the AUTOINCREMENT high-water mark: sqlite_sequence has no key on name,
-- so the row the copy made is raised, and made only when the copy made none.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM compliance_seq_keep_co3), 0)) WHERE name = 'compliance_events';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'compliance_events', seq FROM compliance_seq_keep_co3
 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'compliance_events');

-- The children's rows went with the drop's cascade; they come back, ids intact.
INSERT OR IGNORE INTO obligation_agenda_items SELECT * FROM obligation_agenda_items_keep_co3;
INSERT OR IGNORE INTO obligation_occurrences SELECT * FROM obligation_occurrences_keep_co3;

DROP TABLE compliance_events_keep_co3;
DROP TABLE obligation_agenda_items_keep_co3;
DROP TABLE obligation_occurrences_keep_co3;
DROP TABLE compliance_seq_keep_co3;

CREATE INDEX idx_compliance_project ON compliance_events(project_id, due_date);
CREATE INDEX idx_compliance_status  ON compliance_events(completion_status, due_date);
CREATE INDEX idx_compliance_company ON compliance_events(company_id, due_date);
CREATE INDEX idx_compliance_assignee ON compliance_events(assignee_user_id, completion_status) WHERE assignee_kind = 'person';

-- A task's comments and its timeline, by people and agents. An agent entry
-- carries its cost (the run's charge, micro-USD), or NULL when not recorded.
CREATE TABLE IF NOT EXISTS compliance_task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES compliance_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'assigned', 'comment', 'ready_for_review', 'done', 'reopened', 'needs_reassignment', 'work_linked')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent', 'system')),
  actor_user_id INTEGER REFERENCES users(id),
  actor_agent_id INTEGER REFERENCES team_agents(id),
  body TEXT CHECK (body IS NULL OR (length(trim(body)) > 0 AND length(body) <= 10000)),
  detail_json TEXT CHECK (detail_json IS NULL OR json_valid(detail_json)),
  cost_microusd INTEGER CHECK (cost_microusd IS NULL OR cost_microusd >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((actor_kind = 'person' AND actor_user_id IS NOT NULL AND actor_agent_id IS NULL)
      OR (actor_kind = 'agent' AND actor_agent_id IS NOT NULL AND actor_user_id IS NULL)
      OR (actor_kind = 'system' AND actor_user_id IS NULL AND actor_agent_id IS NULL)),
  CHECK (kind <> 'comment' OR body IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_compliance_task_events_event ON compliance_task_events(event_id, id);

-- A project item doing the work for one company obligation. The obligation
-- stays with the company; the route allows the link only when the project's
-- company_id is the obligation's company.
ALTER TABLE scope_tasks ADD COLUMN compliance_ref INTEGER REFERENCES compliance_events(id) ON DELETE SET NULL;
CREATE INDEX idx_scope_tasks_compliance ON scope_tasks(compliance_ref) WHERE compliance_ref IS NOT NULL;
