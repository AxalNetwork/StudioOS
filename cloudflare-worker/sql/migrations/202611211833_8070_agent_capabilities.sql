-- D8070 (#8070): capability RBAC for agents. An agent may do only what its
-- capability set names, in `<domain>.<action>` form; the Worker refuses the
-- rest with a code before a run, a compute request, a publication or a skill
-- attachment goes ahead (`services/agentCapabilities.ts`).
--
--   capability_catalog      every name, its domain and action, whether it can be granted to an agent at all,
--                           and one sentence. Five names exist and are never grantable (a person does them):
--                           code.merge, deploy.production, cloud.write, finance.execute, email.send.
--   agent_capabilities      one row per grant. A revoke sets revoked_at; the row stays, so the matrix can say
--                           who granted and revoked what, and when. One live grant per agent and capability.
--                           A wildcard (`research.*`) is expanded by the route into one row per name, never
--                           stored and never read at check time.
--   ai_agent_policy         two columns on the policy row (id 1):
--     capability_ceiling_json  the grantable names the platform offers this month; NULL offers every grantable one
--     capabilities_enforced    0 (the start): only the five reserved names are refused, so the agents already
--                              working keep working while HQ grants their sets; 1: every check is enforced
--
-- Every grant or revoke bumps the agent's sponsor's `agent_authz_revisions` row (D5567's pattern, the two
-- triggers below), so a broker grant minted before the change is refused at its next use.
--
-- Additive only: two tables, two columns with defaults, two triggers, an index. NON-IDEMPOTENT (D1's ALTER TABLE
-- has no IF NOT EXISTS): applied once by the ledger-driven runner. Rollback: set capabilities_enforced = 0
-- (the switch route) and every check but the reserved names answers ok; the tables can stay.

CREATE TABLE IF NOT EXISTS capability_catalog (
  name      TEXT PRIMARY KEY CHECK (name = domain || '.' || action),
  domain    TEXT NOT NULL CHECK (domain IN ('research', 'company', 'fund', 'relationships', 'code', 'deploy', 'cloud', 'finance', 'legal', 'email', 'web')),
  action    TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  grantable INTEGER NOT NULL CHECK (grantable IN (0, 1)),
  sentence  TEXT NOT NULL CHECK (length(sentence) BETWEEN 1 AND 200)
);

INSERT OR IGNORE INTO capability_catalog (name, domain, action, grantable, sentence) VALUES
  ('research.read', 'research', 'read', 1, 'Read the research, notes and evidence of the team it works for.'),
  ('research.write', 'research', 'write', 1, 'Propose new research, notes and evidence for the team to accept.'),
  ('company.read', 'company', 'read', 1, 'Read the company profile, plans and documents of the team it works for.'),
  ('company.write', 'company', 'write', 1, 'Propose changes to the company''s plans and documents for the team to accept.'),
  ('fund.read', 'fund', 'read', 1, 'Read fund, round and investor records the team can see.'),
  ('relationships.read', 'relationships', 'read', 1, 'Read the team''s contacts, investors and partners.'),
  ('relationships.request-introduction', 'relationships', 'request-introduction', 1, 'Draft an introduction request for a person to send.'),
  ('code.read', 'code', 'read', 1, 'Read the venture''s connected repository.'),
  ('code.branch', 'code', 'branch', 1, 'Create a working branch in the venture''s repository.'),
  ('code.commit', 'code', 'commit', 1, 'Commit to a working branch it created.'),
  ('code.pr', 'code', 'pr', 1, 'Open a pull request for a person to review.'),
  ('deploy.preview', 'deploy', 'preview', 1, 'Start a preview deploy of a branch.'),
  ('deploy.staging', 'deploy', 'staging', 1, 'Deploy to the staging environment.'),
  ('cloud.read', 'cloud', 'read', 1, 'Run read-only compute jobs on approved inputs.'),
  ('finance.read', 'finance', 'read', 1, 'Read the company''s financial records and cap table.'),
  ('legal.read', 'legal', 'read', 1, 'Read the company''s legal documents.'),
  ('legal.draft', 'legal', 'draft', 1, 'Draft legal documents for a person to review.'),
  ('email.read', 'email', 'read', 1, 'Read the connected mailbox.'),
  ('email.draft', 'email', 'draft', 1, 'Draft an email for a person to send.'),
  ('web.search', 'web', 'search', 1, 'Search the public web.'),
  ('code.merge', 'code', 'merge', 0, 'Merge a pull request. A person does this; no agent can be granted it.'),
  ('deploy.production', 'deploy', 'production', 0, 'Deploy to production. A person does this; no agent can be granted it.'),
  ('cloud.write', 'cloud', 'write', 0, 'Change cloud resources. A person does this; no agent can be granted it.'),
  ('finance.execute', 'finance', 'execute', 0, 'Move money or sign a financial instruction. A person does this; no agent can be granted it.'),
  ('email.send', 'email', 'send', 0, 'Send an email. A person does this; no agent can be granted it.');

CREATE TABLE IF NOT EXISTS agent_capabilities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       INTEGER NOT NULL REFERENCES team_agents(id),
  capability     TEXT NOT NULL REFERENCES capability_catalog(name),
  granted_by     INTEGER NOT NULL REFERENCES users(id),
  granted_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  grant_reason   TEXT NOT NULL CHECK (length(trim(grant_reason)) BETWEEN 1 AND 200),
  revoked_by     INTEGER REFERENCES users(id),
  revoked_at     TEXT,
  revoke_reason  TEXT CHECK (revoke_reason IS NULL OR length(trim(revoke_reason)) BETWEEN 1 AND 200),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_capabilities_live
  ON agent_capabilities (agent_id, capability) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent ON agent_capabilities (agent_id, id);

ALTER TABLE ai_agent_policy ADD COLUMN capability_ceiling_json TEXT CHECK (capability_ceiling_json IS NULL OR (json_valid(capability_ceiling_json) AND json_type(capability_ceiling_json) = 'array'));
ALTER TABLE ai_agent_policy ADD COLUMN capabilities_enforced INTEGER NOT NULL DEFAULT 0 CHECK (capabilities_enforced IN (0, 1));

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_capability_grant
AFTER INSERT ON agent_capabilities
BEGIN
  INSERT INTO agent_authz_revisions (member_id) SELECT sponsor_user_id FROM team_agents WHERE id = NEW.agent_id
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS agent_authz_rev_capability_revoke
AFTER UPDATE OF revoked_at ON agent_capabilities
WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL
BEGIN
  INSERT INTO agent_authz_revisions (member_id) SELECT sponsor_user_id FROM team_agents WHERE id = NEW.agent_id
    ON CONFLICT(member_id) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP;
END;
