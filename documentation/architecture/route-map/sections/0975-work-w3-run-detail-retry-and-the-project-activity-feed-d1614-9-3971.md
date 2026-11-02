### Work W3: a run in full, its retry, and a project's activity feed (D1614 §9, #3971)

Worker routes in `routes/agent_engine.ts` (mounted at `/api/teams`), behind E3's `AGENT_ENGINE` flag and D1496's gates. The reads are `services/agents/runActivity.ts`. There is no migration. The client is `agentEngineApi.run`, `retryRun` and `projectActivity` (`frontend/src/lib/api/agentEngine.js`).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/runs/:uid` | the scope's read gate | E3's `{ run, steps, cost }` plus `detail`: `agent { uid, name, role_key, model }`, `skill: null`, `work { task, instruction, module, option }`, `sources`, `tools`, `proposals [{ uid, status, decided_at, decided_by }]`, `outcome`, `started_at`, `finished_at`, `duration_ms`, `cost { held, charged, model, tokens }`. Unread cost is `{ available: false }`, never 0. |
| `POST /api/teams/runs/:uid/retry` | the scope's editors or the agent's sponsor | 202 `{ run }`, admitted as a start is; 409 `not_retryable`; 403 `not_manager`; 404; and every start refusal. |
| `GET /api/teams/project/:id/activity?who=people\|agents\|both&person=&agent=&task=&before=` | the project's read gate | `{ items: [{ id, type: task_event \| agent_run \| proposal_decision, at, by, task, … }], next_cursor, lists? }`, newest first, 50 a page. 400 `invalid_who`, `invalid_cursor`; 403 `not_member`; 404. Projects only: a company path has no route. |

`outcome` is `in_progress`, `completed { awaiting_decision }`, `skipped { reason: paused | out_of_tokens | tool_disconnected, reason_text }`, `cancelled { reason_text }` or `failed { reason_code, reason_text, retryable }`.
