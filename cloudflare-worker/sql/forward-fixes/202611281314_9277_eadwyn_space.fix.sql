-- Forward fix for 202611281314_9277_eadwyn_space.sql (D9277, #9277).
--
-- That migration adds `scope_kind` and `project_id` to eadwyn_conversations and eadwyn_pending_actions, backfills a
-- row with a company to company scope, and guards the company-XOR-project shape with four triggers. A Worker one
-- version back needs nothing: it never names the new columns, and its inserts (company_id, no scope_kind) pass the
-- triggers. While it serves, the rows it writes keep scope_kind NULL, which the D9277 Worker reads as company scope.
-- What a manual recovery can lose is the backfill and the guards. This fix puts them back as the migration wrote them:
-- the two backfills again (so a row the previous Worker wrote is stored as company scope), the index and the four
-- triggers. It never deletes or moves a row, and never weakens a trigger.
--
-- Idempotent: each UPDATE touches only rows with scope_kind NULL and a company; every CREATE is IF NOT EXISTS. The
-- release-window rehearsal runs it on the migrated database and on a clean build (D8532, step 5).

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
