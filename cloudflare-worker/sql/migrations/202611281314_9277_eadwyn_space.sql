-- D9277 (#9277): every Eadwyn conversation, and every action it proposes, belongs to exactly one company or one
-- project, the same shape as team_agents (712): `scope_kind` is 'company' with `company_id` set and `project_id` NULL,
-- or 'project' with `project_id` set and `company_id` NULL.
--
-- eadwyn_conversations.scope_kind / project_id    the conversation's space (routes/eadwyn.ts, services/eadwynSpace.ts)
-- eadwyn_pending_actions.scope_kind / project_id  the space the proposal was made in; confirm re-checks it
--
-- Backfill: a row with a company becomes company scope. A row with neither keeps scope_kind NULL; D9277 lists them,
-- and the route keeps them readable by their owner only (no run, no Send).
--
-- The shape is enforced by triggers, not a CHECK, as D4962 does for company_profiles: a trigger fires only on a new
-- write. A row the Worker one version back writes (company_id set, scope_kind NULL) still passes, so a rollback keeps
-- working; the route reads that row as company scope.
--
-- project_id references projects(id) ON DELETE CASCADE: a hard-deleted venture takes its conversations with it, and
-- their messages and actions go with them (444's cascade).
--
-- Additive: ADD COLUMN with no NOT NULL, CREATE INDEX / TRIGGER IF NOT EXISTS. No BEGIN/COMMIT.
ALTER TABLE eadwyn_conversations ADD COLUMN scope_kind TEXT;
ALTER TABLE eadwyn_conversations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE eadwyn_pending_actions ADD COLUMN scope_kind TEXT;
ALTER TABLE eadwyn_pending_actions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

UPDATE eadwyn_conversations SET scope_kind = 'company' WHERE scope_kind IS NULL AND company_id IS NOT NULL;
UPDATE eadwyn_pending_actions SET scope_kind = 'company' WHERE scope_kind IS NULL AND company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eadwyn_conversations_space
  ON eadwyn_conversations(user_id, scope_kind, company_id, project_id, updated_at);

-- Valid: no space and no project (a legacy row, or one the previous Worker writes), company XOR project otherwise.
CREATE TRIGGER IF NOT EXISTS eadwyn_conversations_space_insert
BEFORE INSERT ON eadwyn_conversations
WHEN NOT ((NEW.scope_kind IS NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'company' AND NEW.company_id IS NOT NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'project' AND NEW.project_id IS NOT NULL AND NEW.company_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'eadwyn_conversations.scope_kind: one company or one project');
END;

CREATE TRIGGER IF NOT EXISTS eadwyn_conversations_space_update
BEFORE UPDATE OF scope_kind, company_id, project_id ON eadwyn_conversations
WHEN NOT ((NEW.scope_kind IS NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'company' AND NEW.company_id IS NOT NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'project' AND NEW.project_id IS NOT NULL AND NEW.company_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'eadwyn_conversations.scope_kind: one company or one project');
END;

CREATE TRIGGER IF NOT EXISTS eadwyn_pending_actions_space_insert
BEFORE INSERT ON eadwyn_pending_actions
WHEN NOT ((NEW.scope_kind IS NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'company' AND NEW.company_id IS NOT NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'project' AND NEW.project_id IS NOT NULL AND NEW.company_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'eadwyn_pending_actions.scope_kind: one company or one project');
END;

CREATE TRIGGER IF NOT EXISTS eadwyn_pending_actions_space_update
BEFORE UPDATE OF scope_kind, company_id, project_id ON eadwyn_pending_actions
WHEN NOT ((NEW.scope_kind IS NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'company' AND NEW.company_id IS NOT NULL AND NEW.project_id IS NULL)
       OR (IFNULL(NEW.scope_kind, '') = 'project' AND NEW.project_id IS NOT NULL AND NEW.company_id IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'eadwyn_pending_actions.scope_kind: one company or one project');
END;
