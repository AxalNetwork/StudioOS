-- 757 — D1612 (#3951, part A of #3945): the agent skill library.
--
-- A skill is a named, versioned recipe for one or more agent roles: what it
-- does, its steps, the taxonomy skills it covers (the /studio taxonomy of
-- migrations 089/090, so agents and people read on the same 8-axis radar),
-- the read-only tools it may use, and what it proposes. Axal HQ curates
-- `scope = 'hq'` skills; a company's editors write `scope = 'company'` skills
-- for that company's agents only. Whatever a skill produces is a proposal a
-- named person accepts, as every agent run is (D1496).
--
--   agent_skills          one row per skill: its working draft and status.
--   agent_skill_versions  every published version, as a SKILL.md and its
--                         parsed parts. Never updated (the trigger below):
--                         an agent pins a version, so editing a skill never
--                         changes a running agent.
--   agent_skill_tags      the draft's taxonomy tags: a `skills.slug` and a
--                         seniority level.
--   agent_skill_roles     the draft's roles (`services/agents/catalogue.ts`).
--                         An agent is only given skills of its own role.
--   agent_skill_links     which agent uses which skill, at which version.
--
-- Additive only: five new tables, their indexes and one trigger.

CREATE TABLE IF NOT EXISTS agent_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('hq', 'company')),
  company_id INTEGER REFERENCES company_profiles(id),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 300),
  -- ["Read the last three months' metrics", ...], 1 to 20 steps.
  steps_json TEXT NOT NULL DEFAULT '[]',
  -- ["hubspot.read_contacts", ...]: read-only tool names, checked against an
  -- agent's `tool_grants_json` when the skill is attached.
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  output_kind TEXT NOT NULL CHECK (output_kind IN ('draft', 'record_change', 'brief')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  -- 0 until the first publish; then the newest `agent_skill_versions.version`.
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'hq' AND company_id IS NULL) OR (scope = 'company' AND company_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skills_slug ON agent_skills (scope, IFNULL(company_id, 0), slug);
CREATE INDEX IF NOT EXISTS idx_agent_skills_company ON agent_skills (company_id, status);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  -- The version as SKILL.md: YAML frontmatter (name, description, roles,
  -- tools, output, taxonomy, version) and the steps. What export and copy give.
  skill_md TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL,
  output_kind TEXT NOT NULL,
  -- [{ "slug": "investor_reporting", "level": "proficient" }, ...]
  taxonomy_json TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  published_by INTEGER NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (skill_id, version)
);

-- A published version is what a pinned agent runs: it is never edited.
CREATE TRIGGER IF NOT EXISTS trg_agent_skill_versions_immutable
BEFORE UPDATE ON agent_skill_versions
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_versions rows are immutable');
END;

CREATE TABLE IF NOT EXISTS agent_skill_tags (
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  taxonomy_skill_slug TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('aware', 'working', 'proficient', 'advanced', 'expert')),
  PRIMARY KEY (skill_id, taxonomy_skill_slug)
);

CREATE TABLE IF NOT EXISTS agent_skill_roles (
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  PRIMARY KEY (skill_id, role_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_roles_role ON agent_skill_roles (role_key);

CREATE TABLE IF NOT EXISTS agent_skill_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id),
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_links_skill ON agent_skill_links (skill_id);
