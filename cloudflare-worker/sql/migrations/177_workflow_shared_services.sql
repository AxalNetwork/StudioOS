-- 177 — Three tables the worker has always queried and nothing ever created.
--
-- `workflows`, `workflow_tasks` and `shared_services_log` are read and written
-- by four route files. No CREATE TABLE for any of them exists anywhere in this
-- repository — not in sql/, not in a route's ensureSchema, not in the FastAPI
-- dev models. They were referenced from the day they were written.
--
-- What that cost, per call site:
--
--   networkfx  POST /marketplace/intro   500. The SELECT on `workflows` is
--                                        unguarded and the workflow task IS
--                                        the intro request — there is no other
--                                        record of it. The only path by which
--                                        a founder asks for an introduction to
--                                        an operator or advisor.
--   networkfx  POST /marketplace/match   500 before doing any work: its first
--   pipeline   (AI review paths)         statement is an AI quota check that
--                                        counts rows in shared_services_log.
--   legalcap   (AI paths)                No rate limit at all. Its quota check
--                                        catches the error and returns "under
--                                        the limit", so every AI call on that
--                                        router has been unmetered.
--   legalcap   POST spin-out             The five-item founder checklist —
--                                        sign SAFE, sign IP licence, confirm
--                                        Atlas, file 83(b) within 30 days,
--                                        track LP responses on the capital
--                                        call — is created inside a try/catch
--                                        and has never once been written.
--   dashboard  GET /api/dashboard        "My tasks" reads workflow_tasks
--                                        through safeQuery, so it has always
--                                        returned an empty list.
--
-- Every write above sits in a swallowing catch, which is why a whole feature
-- could be missing for this long without a single error surfacing. The reads
-- that were NOT wrapped are the ones that 500.
--
-- Column set is taken from the union of what the four routes actually select,
-- insert and join on — nothing speculative is added.

CREATE TABLE IF NOT EXISTS workflows (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'strategic' is the only value any current caller writes; left free-form
  -- because the dashboard selects it back out as a display label.
  type          TEXT    NOT NULL DEFAULT 'strategic',
  title         TEXT    NOT NULL,
  description   TEXT,
  status        TEXT    NOT NULL DEFAULT 'active',
  -- NULL for workflows that are not scoped to one project: networkfx looks up
  -- its marketplace-intro workflow with `project_id IS NULL`.
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  -- Callers find-or-create by this key, so it has to be unique per project.
  -- The partial index below is what makes that find-or-create race-safe.
  template_key  TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Two partial uniques rather than one: SQLite treats NULLs as distinct, so a
-- single UNIQUE(template_key, project_id) would let the project-less
-- marketplace-intro workflow be created twice under a race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_template_project
  ON workflows(template_key, project_id) WHERE template_key IS NOT NULL AND project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_template_global
  ON workflows(template_key) WHERE template_key IS NOT NULL AND project_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_workflows_owner   ON workflows(owner_user_id, status);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id      INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  description      TEXT,
  status           TEXT    NOT NULL DEFAULT 'todo',
  priority         TEXT    NOT NULL DEFAULT 'normal',
  -- 1 when the task's body came out of a model. The dashboard does not show
  -- this yet; it is recorded because a human signing off on an AI
  -- recommendation needs to know it was one.
  ai_assisted      INTEGER NOT NULL DEFAULT 0,
  metadata         TEXT,
  assignee_user_id INTEGER REFERENCES users(id),
  due_date         TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The dashboard's "my tasks" query orders by (due_date IS NULL), due_date and
-- filters on assignee + status; this index is that query.
CREATE INDEX IF NOT EXISTS idx_wtasks_assignee ON workflow_tasks(assignee_user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_wtasks_workflow ON workflow_tasks(workflow_id, status);

CREATE TABLE IF NOT EXISTS shared_services_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id  INTEGER REFERENCES workflows(id) ON DELETE SET NULL,
  action_type  TEXT    NOT NULL,
  details      TEXT,
  performed_by INTEGER REFERENCES users(id),
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- This index is the rate limiter. Every quota check is
--   COUNT(*) WHERE performed_by = ? AND action_type = 'ai_call'
--            AND created_at > datetime('now', '-1 hour')
-- and runs before the model call it is protecting, so it must not scan.
CREATE INDEX IF NOT EXISTS idx_ssl_actor_action_ts
  ON shared_services_log(performed_by, action_type, created_at);
