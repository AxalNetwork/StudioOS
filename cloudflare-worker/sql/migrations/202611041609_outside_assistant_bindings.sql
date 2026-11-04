-- D4424 (#4424): outside assistant identity. Additive; the ledger applies
-- ALTER once. No existing agent changes source; no live connection is created.
ALTER TABLE team_agents ADD COLUMN source TEXT NOT NULL DEFAULT 'platform'
  CHECK (source IN ('platform', 'mcp_client'));

CREATE TABLE IF NOT EXISTS team_agent_mcp_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL UNIQUE REFERENCES team_agents(id),
  sponsor_user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  -- Provider grant id, not its bearer or secret; NULL until consent finishes.
  grant_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  CHECK ((state = 'active' AND grant_id IS NOT NULL) OR state <> 'active')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_agent_mcp_grant
  ON team_agent_mcp_bindings(sponsor_user_id, grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_agent_mcp_client
  ON team_agent_mcp_bindings(sponsor_user_id, client_id, state);
