### Team › Skills: what skills cost per run (D4121, #4121)

- **Worker:** `routes/team_skills.ts` (mounted at `/api/teams`, behind `TEAM_AGENTS_ENABLED`); the estimate is `services/agents/runCost.ts`.
  - `GET /agents/:uid/cost-estimate?add=<uid,…>&remove=<uid,…>`: the agent with skills added or removed. Any member of its team may read it.
  - `GET /:scope/:id/cost-estimate?model=&role=&persona=&skills=<uid,…>&cap_microusd=`: an agent not yet added (AG3).
  - Both answer `{ available: true, skills, tokens_per_run, est_usd_per_run, monthly_at_cap, cap_usd, before, baseline, delta, hint, thresholds }`, or `{ available: false, reason }` when the price or the skills cannot be read; never a 0.
- **Store:** `agent_skill_version_costs` (migration `202611022326_agent_skill_context_tokens.sql`), each published version's `context_tokens`, written by `skillPublish.ts` in the version's batch.
- **Also:** skill cards (`GET /skills`, `/agents/:uid/skills/available`) carry `context_tokens`; HQ's library (`GET /api/admin/ai-agents/skills`) carries `tokens_per_run`.
- **Hint:** more than 6 skills, or above 2× the agent's no-skill baseline (`RUN_COST_CONFIG`), names the area with the most skills and an offered persona not on the team whose natural fit is that area.
- **Refusals:** 404 `not_found` (agent or team the caller cannot read), 403 `not_member`, 400 `skills_invalid`, `role_unknown`, `persona_unknown`, `cap_invalid`; 404 `skill_not_found`; 422 `model_not_offered`.
- **Client:** `teamAgentsApi.costEstimate`, `draftCostEstimate` through `agentsAdapter`; drawn on AG3, SK3, SK4 (the profile), SK5, SK6 and every skill row.
