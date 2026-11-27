### Agent engine E4: the planner, role templates and the team wizard (D1530, #3848)

The same router (`routes/agent_engine.ts`) and flags as E1, backed by `services/agents/planner.ts` and `services/agents/templates.ts`. No migration. The client methods are on `agentEngineApi`: `planQuote`, `draftPlan`, `acceptPlan`, `suggestedTeam`, `templates` and `capabilities`. The planner is the rail option `propose:goal-plan` in Studio, run by the scope's CEO / Chief of staff agent through `agentRun`, else by the manager's own Eadwyn. Custom roles wait for migration 728 (#3847).

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/goals/:uid/plan/quote` | manage | `{ quote: { available, value_microusd }, by: 'agent' \| 'eadwyn', agent: { uid, persona: { key, name } } \| null }` (#4394, D4394: the planning agent by persona, never a job title): what a plan would hold, an upper bound; `available: false` when it cannot be read, never 0. The agent run's refusals. |
| `POST /api/teams/goals/:uid/plan` | manage | 201 `{ proposal: { uid, by, agent, plan: { items: [{ title, module, suggested_assignee, depends_on, due_in_days }], dropped }, cost: { held, charged } } }`, at most 20 items; each cost `{ available: false }` when unrecorded, never 0 (D4394). 422 `plan_invalid` (a loop, or no readable plan: the proposal is discarded); every run refusal in its own words. |
| `POST /api/teams/goals/:uid/plan/accept` | manage | Takes `{ proposal, remove?: [index], titles?: { index: title } }`; 201 `{ tasks }`, written in one batch with `source_kind 'plan'`. 400 `invalid_plan`; 404; 409 `plan_decided`; 503 `plan_not_saved` (no task written, the plan can be accepted again). |
| `POST /api/teams/goals/:uid/plan/discard` | manage | Takes `{ proposal }`; `{ ok: true }`. Claimed as accept claims it (`status = 'proposed'`, once): 409 `plan_decided` when already accepted or discarded; 400 `invalid_plan`; 404 (#4394, D4394). |
| `GET /api/teams/:scope/:id/suggested-team?goal=` | manage | `{ stage, suggestions: [{ role_key, why, already_on_team, template, est_month_microusd }] }`. Rule-based: no model, nothing written. The estimate is `{ available: false }` when unknown, never 0. |
| `GET /api/teams/templates` | signed in | `{ templates: [{ key, role_key, name, model_tier, suggested_cap_microusd, duties: [key] }] }`. |
| `GET /api/teams/capabilities` | signed in | `{ modules: [{ key, label, cycle }], reads, options: { module: [option] }, floor }`. |

