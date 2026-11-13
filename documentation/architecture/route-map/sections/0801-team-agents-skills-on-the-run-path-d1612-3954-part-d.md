## Team agents — skills on the run path and the evaluation board (D1612 part D, #3954)

No new page. The run and the board are read by pages already mapped (Team › Agents, the agent engine's evaluation board, HQ › AI agents › Skills).

| Address | What | Backend |
| --- | --- | --- |
| Team › Agents, Run | A run that names one of the agent's skills runs at the pinned version; refusals `skill_not_attached`, `skill_suspended`, `tool_not_approved`, `tool_not_in_skill` | `POST /api/teams/agents/:uid/run { …, skill }` |
| The evaluation board (TM14) | `skills`: each Axal skill the scope's agents use, pass / total on its current version, regressions | `GET /api/teams/:scope/:id/evaluation` |
| HQ › AI agents › Skills | Run the published versions' golden cases; a regression is told to HQ once | `POST /api/admin/ai-agents/skills/evals/published { models?, uid? }` |
