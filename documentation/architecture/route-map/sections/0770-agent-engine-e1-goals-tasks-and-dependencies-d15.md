### Agent engine E1: goals, tasks and dependencies (D1529, #3845)

Worker routes in `routes/agent_engine.ts`, mounted at `/api/teams` before `team_agents.ts`, backed by `services/agents/goals.ts`, `services/agents/tasks.ts` and migration 727 (`scope_goals`, `scope_tasks`, `scope_task_deps`, `scope_task_events`; `task_id` and `run_key` on `ai_rail_proposals`). The client is `lib/api/agentEngine.js` (`agentEngineApi`). No page yet: S1's canvas integrates it (TM6b, TM6c, later TM10–TM11). Every route is 404 `agent_engine_off` unless `AGENT_ENGINE` is set and not `"off"` (it is `"off"` in both `wrangler.toml` blocks) and `TEAM_AGENTS_ENABLED` is `"true"`. The gates are D1496's read and manage. `cost` is `{ available: false }` until E3 records task runs, never 0 (E3's runtime routes follow).

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/:scope/:id/goals` | read | `{ goals: [{ uid, title, why, metric, target_date, stage, parent: { uid, title } \| null, okr_id, status, priority, progress: { done, total }, cost }] }`. `parent` is null while the project is outside the parent's company. 403, 404. |
| `POST /api/teams/:scope/:id/goals` | manage | Takes `{ title, why?, metric?, target_date?, stage?, parent_goal_uid?, okr_id?, priority? }`; 201 `{ goal }`. 400 `invalid_goal`; 422 `parent_not_in_company` / `okr_not_in_project`. |
| `PATCH /api/teams/goals/:uid` | manage | The same fields and `status` (`open`, `achieved`, `dropped`); `{ goal }`. |
| `GET /api/teams/:scope/:id/tasks?goal=&assignee=person\|agent\|none&status=&module=` | read | `{ tasks: [{ uid, title, detail, module, option, kind, goal, assignee: { kind, person?, agent? }, context_project, status, blocked_reason, ready, depends_on: [uid], priority, due_at, attempts, cost }] }`. `ready` is derived. 400 `invalid_filter`. |
| `POST /api/teams/:scope/:id/tasks` | manage | Takes `{ title, detail?, goal_uid?, module?, option?, kind?, context_project_id?, assignee?: { kind, uid? }, priority?, due_at?, source_kind?, source_ref? }`; 201 `{ task }`. 409 `agent_not_live`; 422 `module_not_allowed` / `option_not_allowed` / `assignee_not_member` / `project_not_in_company` / `goal_not_in_scope`. |
| `PATCH /api/teams/tasks/:uid` | manage; a person assignee may send `status` and `blocked_reason` only | `{ task }`, with the same refusals. 403 `not_manager`. |
| `PUT /api/teams/tasks/:uid/deps` | manage | Takes `{ depends_on: [uid] }` (at most 50); `{ task }`. 422 `dependency_cycle` / `cross_scope` / `too_many_dependencies`. |

