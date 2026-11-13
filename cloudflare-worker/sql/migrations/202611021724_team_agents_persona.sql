-- D4117 (#4117, Roster R1 of #4116): the persona a team agent wears.
--
-- `persona_key` names one of the 16 personas in
-- `cloudflare-worker/src/services/agents/personas.ts` (code, like the role
-- catalogue, so no table holds them and no route edits them).
--
-- Additive: existing agents keep working. Each existing agent takes its
-- role's default persona (`ROLE_PERSONA` in personas.ts, the same map as
-- the CASE below). The eleven roles map to eleven different personas, and a
-- Team already had at most one live agent per role
-- (`idx_team_agents_live_role`), so the backfill never puts one persona
-- twice on a Team.
--
-- One live agent per persona per Team: the partial unique index, mirroring
-- `idx_team_agents_live_role`. A removed agent frees its persona.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE team_agents ADD COLUMN persona_key TEXT;

UPDATE team_agents SET persona_key = CASE role_key
  WHEN 'ceo' THEN 'solen'
  WHEN 'cto' THEN 'corvane'
  WHEN 'cpo' THEN 'juno'
  WHEN 'cfo' THEN 'orrin'
  WHEN 'cmo' THEN 'kade'
  WHEN 'sales' THEN 'seren'
  WHEN 'coo' THEN 'tessaly'
  WHEN 'general_counsel' THEN 'vesta'
  WHEN 'people' THEN 'elara'
  WHEN 'research_analyst' THEN 'ryssa'
  WHEN 'investor_relations' THEN 'aurel'
  ELSE NULL END
WHERE persona_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_agents_live_persona
  ON team_agents (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), persona_key)
  WHERE status <> 'removed' AND persona_key IS NOT NULL;
