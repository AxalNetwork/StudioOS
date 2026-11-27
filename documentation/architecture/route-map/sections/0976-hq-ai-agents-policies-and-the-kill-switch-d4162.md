### HQ › AI agents: Policies and the kill switch (D4162, #4162)

- **Worker:** `routes/admin_ai_agents_policy.ts`, mounted at `/api/admin/ai-agents/policy` by the route registry, Super Admin only. Served by `services/agents/aiPolicy.ts`.
  - `GET /` (SA6): models per area, models locked off, caps, the per-run ceiling, read tools, guardrails (each count `null`: "Not recorded"), the kill switch.
  - `PUT /models` `{ areas: { <area>: { suggested: [≤3], default } }, reason }`; `POST /locks` `{ model, reason }`; `DELETE /locks/:model` `{ reason }`.
  - `PUT /caps` `{ platform_budget_microusd?, default_team_cap_microusd?, max_team_cap_microusd?, per_run_ceiling_microusd?, reason }`.
  - `PUT /tools` `{ tools, reason }`: read tools only; a write tool is 422 `write_tool`.
  - `POST /pause` `{ reason, confirm: 'PAUSE' }` and `POST /resume` `{ reason }` (SA6b, SA9d).
- **The team banner:** `routes/team_platform_status.ts`, `GET /api/teams/platform-status` for any signed-in member → `{ paused, since, by_name }`. Drawn by `pages/team/PlatformPausedBanner.jsx` at the top of the Team page.
- **At run time:** while paused, `engineRefusal` (every admission on both runtimes: a person's start, the sweep, `after`, a duty) and `agentRun` refuse 403 `platform_paused`; open proposals stay decidable. A locked model fails over to its area's default or is refused 403 `model_locked`; a quote above the per-run ceiling is 402 `run_ceiling` before any hold; a team agent's cap above the maximum is 422 `cap_over_platform_max`.
- **Store:** `ai_agent_policy` row 1 (migrations `202611022046` and `202611022114`) and `ai_model_locks`. Every write writes H5's `ai_admin_audit` row in the same batch.
- **Refusals:** 401; 403 for anyone but a Super Admin; 400 `reason_required`, `confirm_required`, `invalid_models`, `invalid_area`, `invalid_default`, `invalid_cap`, `default_over_max`, `invalid_tools`, `unknown_model`; 409 `already_paused`, `not_paused`, `already_locked`; 404 `not_locked`; 503 `policy_unreadable`.
- **Client:** `lib/api/adminAiAgents.js` (policy methods) and `lib/api/platformStatus.js`.
