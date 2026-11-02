-- D4117 (#4117, Roster R1 of #4116): an agent's persona.
--
-- A team agent is one of the 16 personas of `services/agents/personas.ts`
-- (a code catalogue, no table). `persona_key` names it. NULL is an agent
-- added before personas: it reads as its role's default persona
-- (`DEFAULT_PERSONA_BY_ROLE`, eleven distinct personas, so a team that holds
-- one live agent per role never reads two agents as one persona).
--
-- One live agent per persona per scope, as 712 holds one per role. A removed
-- agent keeps its row and frees its persona. The route checks the role
-- defaults too (409 `persona_on_team`); this index is the database's floor
-- for the persona keys it stores.
--
-- Additive only: one nullable column and one partial index. Nothing is
-- backfilled.
--
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): apply through the
-- ledger-driven runner, which runs it once (`npm run d1:migrate:remote`).

ALTER TABLE team_agents ADD COLUMN persona_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_agents_live_persona
  ON team_agents (scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0), persona_key)
  WHERE status <> 'removed' AND persona_key IS NOT NULL;
