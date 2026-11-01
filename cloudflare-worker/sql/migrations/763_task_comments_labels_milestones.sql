-- D1614 W7 (#3993): a project task's comments, labels and milestones, on W1's
-- scope_tasks (762). Project-scoped throughout; a company scope has none.
--
-- task_comments: a person's or an agent's Markdown comment on one task. The
--   body is stored cleaned (no raw HTML, no unsafe link target; the Worker
--   never renders HTML). An agent's comment names the run that wrote it
--   (`run_id`, the run's proposal uid as the run path records it today).
--   Edits and deletes are timestamps; a deleted comment keeps no body.
-- task_labels / task_label_links: a project's labels and which task carries
--   which. W1's labels_json stays as the names' mirror the board reads; the
--   back-fill below turns every name already in labels_json into a label and a
--   link, so nothing a task carried is lost.
-- task_milestones: a project's milestones (title, due, open/closed).
-- scope_tasks gains milestone_id, drafted_by_agent_id (a task created by
--   accepting an agent's draft) and review_state (the last review: approved or
--   changes requested).
-- scope_task_events widens its kind vocabulary ('labelled', 'milestone',
--   'reviewed') by the same id-keeping rebuild 762 used.
-- Participants are derived from comments and events, never stored. Additive
-- otherwise; no transaction statements (D1 rejects them).
CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  author_user_id INTEGER REFERENCES users(id),
  author_agent_id INTEGER REFERENCES team_agents(id),
  run_id TEXT CHECK (run_id IS NULL OR length(run_id) <= 80),
  body TEXT CHECK (body IS NULL OR length(body) <= 20000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  CHECK ((author_user_id IS NOT NULL AND author_agent_id IS NULL AND run_id IS NULL)
      OR (author_agent_id IS NOT NULL AND author_user_id IS NULL)),
  CHECK ((deleted_at IS NULL AND body IS NOT NULL AND length(body) >= 1) OR (deleted_at IS NOT NULL AND body IS NULL))
);
CREATE INDEX idx_task_comments_task ON task_comments(task_id, id);

CREATE TABLE task_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  color TEXT NOT NULL DEFAULT 'gray' CHECK (color IN ('gray','red','orange','yellow','green','teal','blue','purple','pink')),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_task_labels_name ON task_labels(project_id, name COLLATE NOCASE);

CREATE TABLE task_label_links (
  task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
  label_id INTEGER NOT NULL REFERENCES task_labels(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX idx_task_label_links_label ON task_label_links(label_id, task_id);

CREATE TABLE task_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  CHECK ((state = 'open' AND closed_at IS NULL) OR (state = 'closed' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_task_milestones_title ON task_milestones(project_id, title COLLATE NOCASE);

ALTER TABLE scope_tasks ADD COLUMN milestone_id INTEGER REFERENCES task_milestones(id);
ALTER TABLE scope_tasks ADD COLUMN drafted_by_agent_id INTEGER REFERENCES team_agents(id);
ALTER TABLE scope_tasks ADD COLUMN review_state TEXT CHECK (review_state IS NULL OR review_state IN ('approved','changes_requested'));
CREATE INDEX idx_scope_tasks_milestone ON scope_tasks(milestone_id) WHERE milestone_id IS NOT NULL;

-- labels_json → task_labels + task_label_links (additive; labels_json is kept as the mirror).
INSERT OR IGNORE INTO task_labels (uid, project_id, name)
  SELECT lower(hex(randomblob(16))), t.project_id, trim(j.value)
  FROM scope_tasks t, json_each(t.labels_json) j
  WHERE t.scope_kind = 'project' AND j.type = 'text' AND length(trim(j.value)) BETWEEN 1 AND 80
  GROUP BY t.project_id, lower(trim(j.value));
INSERT OR IGNORE INTO task_label_links (task_id, label_id)
  SELECT t.id, l.id FROM scope_tasks t, json_each(t.labels_json) j
  JOIN task_labels l ON l.project_id = t.project_id AND l.name = trim(j.value) COLLATE NOCASE
  WHERE t.scope_kind = 'project' AND j.type = 'text';

-- Keep events' ids and history while widening the closed kind vocabulary (as 762 did).
CREATE TABLE scope_task_events_w7 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_id INTEGER NOT NULL REFERENCES scope_tasks(id),
 actor_user_id INTEGER REFERENCES users(id), actor_agent_id INTEGER REFERENCES team_agents(id),
 kind TEXT NOT NULL CHECK (kind IN ('created','updated','assigned','status','deps_set','moved','unblocked','dependency_incomplete','labelled','milestone','reviewed')),
 detail_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO scope_task_events_w7 SELECT * FROM scope_task_events;
UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'scope_task_events')) WHERE name = 'scope_task_events_w7';
DROP TABLE scope_task_events;
ALTER TABLE scope_task_events_w7 RENAME TO scope_task_events;
CREATE INDEX idx_scope_task_events_task ON scope_task_events(task_id, id DESC);
