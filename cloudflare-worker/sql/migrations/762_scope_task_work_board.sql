-- D1614 W1 (#3969): Work's project board on E1's task store (727).
-- scope_tasks gains the common task columns S1 assigned to W1 (#3969,
-- comment 6562550224): a per-project task_number, a Markdown body, a type,
-- parent_task_id, the board column (kept consistent with status by a CHECK),
-- estimate_points, position within a column, bounded labels_json, and the
-- close reason (completed, not planned, duplicate + duplicate_of). The board
-- is project-only: a company row keeps every board field null. Milestones and
-- normalized labels are #3993's later migration.
-- scope_task_events widens its kind vocabulary ('moved', 'unblocked',
-- 'dependency_incomplete') by a table rebuild that keeps every id and the
-- AUTOINCREMENT high-water mark. Existing project rows get task numbers in id
-- order; nothing else is back-filled. Additive otherwise; no transaction
-- statements (D1 rejects them).
ALTER TABLE scope_tasks ADD COLUMN board_column TEXT CHECK (board_column IS NULL OR (scope_kind = 'project' AND ((board_column IN ('triage','backlog','ready') AND status IN ('open','blocked')) OR (board_column = 'in_progress' AND status = 'in_progress') OR (board_column = 'in_review' AND status = 'waiting_decision') OR (board_column = 'done' AND status IN ('done','cancelled')))));
ALTER TABLE scope_tasks ADD COLUMN estimate_points REAL CHECK (estimate_points IS NULL OR (estimate_points >= 0 AND estimate_points <= 1000000));
ALTER TABLE scope_tasks ADD COLUMN position REAL NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 1000000000000);
ALTER TABLE scope_tasks ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels_json) AND json_type(labels_json) = 'array');
ALTER TABLE scope_tasks ADD COLUMN close_reason TEXT CHECK (close_reason IS NULL OR (board_column IS NOT NULL AND board_column = 'done' AND ((close_reason = 'completed' AND status = 'done') OR (close_reason IN ('not_planned','duplicate') AND status = 'cancelled'))));
ALTER TABLE scope_tasks ADD COLUMN duplicate_of INTEGER REFERENCES scope_tasks(id) CHECK ((close_reason = 'duplicate' AND duplicate_of IS NOT NULL) OR (COALESCE(close_reason,'') <> 'duplicate' AND duplicate_of IS NULL));
ALTER TABLE scope_tasks ADD COLUMN task_number INTEGER CHECK (task_number IS NULL OR task_number > 0);
ALTER TABLE scope_tasks ADD COLUMN body TEXT CHECK (body IS NULL OR length(body) <= 50000);
ALTER TABLE scope_tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task','bug','feature','research','compliance','chore'));
ALTER TABLE scope_tasks ADD COLUMN parent_task_id INTEGER REFERENCES scope_tasks(id);
ALTER TABLE scope_tasks ADD COLUMN work_version INTEGER NOT NULL DEFAULT 0 CHECK (work_version >= 0);
ALTER TABLE scope_tasks ADD COLUMN work_change_uid TEXT;
CREATE UNIQUE INDEX idx_scope_tasks_number ON scope_tasks(project_id, task_number) WHERE scope_kind = 'project';
CREATE INDEX idx_scope_tasks_board ON scope_tasks(project_id, board_column, position, id) WHERE scope_kind = 'project';
-- New deterministic project-local identifiers; not historical activity facts.
UPDATE scope_tasks SET task_number = (SELECT COUNT(*) FROM scope_tasks previous WHERE previous.project_id = scope_tasks.project_id AND previous.id <= scope_tasks.id) WHERE scope_kind = 'project';
-- Keep events' existing ids and history while widening the closed kind vocabulary.
CREATE TABLE scope_task_events_w1 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
 actor_user_id INTEGER REFERENCES users(id), actor_agent_id INTEGER REFERENCES team_agents(id),
 kind TEXT NOT NULL CHECK (kind IN ('created','updated','assigned','status','deps_set','moved','unblocked','dependency_incomplete')),
 detail_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO scope_task_events_w1 SELECT * FROM scope_task_events;
UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'scope_task_events')) WHERE name = 'scope_task_events_w1';
DROP TABLE scope_task_events;
ALTER TABLE scope_task_events_w1 RENAME TO scope_task_events;
CREATE INDEX idx_scope_task_events_task ON scope_task_events(task_id, id DESC);
