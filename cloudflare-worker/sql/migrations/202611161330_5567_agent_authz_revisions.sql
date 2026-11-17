-- D5567 part 3 (#5567): a per-member authorization revision for the workspace broker.
--
-- `authorizeCompute` answered `revision: 1` for everyone, so the workspace grant service's revision fence never
-- tripped: a sponsor revoked and re-granted within one grant's life (60 s at most) kept that grant. Each member now has
-- a revision. It starts at 1 (no row) and rises by one every time any of that member's access is taken away or
-- changed, so a grant or registered run that recorded an older revision is refused at its next use, even if the same
-- access has since been granted back. A grant of new access does not bump it: that cannot make an old grant wider.
--
-- What counts, each a trigger below:
--   · a company link deleted, or moved to another user or company;
--   · a project membership deleted, or its status, role, user or project changed;
--   · an account licence revoked (revoked_at set or changed) or deleted;
--   · the user deactivated or reactivated, or their role or founder link changed;
--   · an agent's sponsor or status changed, or the agent deleted (both the old and the new sponsor are bumped).
-- Over-counting only refuses grants early, which the broker reports and the runtime retries with a fresh registration.
CREATE TABLE IF NOT EXISTS agent_authz_revisions (
  member_id  INTEGER PRIMARY KEY,
  revision   INTEGER NOT NULL DEFAULT 2 CHECK (revision >= 2),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_company_link_delete
AFTER DELETE ON user_company_links
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_company_link_update
AFTER UPDATE OF user_id, company_id ON user_company_links
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_project_member_delete
AFTER DELETE ON project_members
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_project_member_update
AFTER UPDATE OF status, role, user_id, project_id ON project_members
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_licence_revoke
AFTER UPDATE OF revoked_at ON account_licences
WHEN NEW.revoked_at IS NOT OLD.revoked_at
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_licence_delete
AFTER DELETE ON account_licences
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_user_update
AFTER UPDATE OF is_active, role, founder_id ON users
WHEN NEW.is_active IS NOT OLD.is_active OR NEW.role IS NOT OLD.role OR NEW.founder_id IS NOT OLD.founder_id
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_agent_update
AFTER UPDATE OF status, sponsor_user_id ON team_agents
WHEN NEW.status IS NOT OLD.status OR NEW.sponsor_user_id IS NOT OLD.sponsor_user_id
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.sponsor_user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
  INSERT INTO agent_authz_revisions (member_id) SELECT NEW.sponsor_user_id WHERE NEW.sponsor_user_id IS NOT OLD.sponsor_user_id
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_agent_delete
AFTER DELETE ON team_agents
BEGIN
  INSERT INTO agent_authz_revisions (member_id) VALUES (OLD.sponsor_user_id)
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;
