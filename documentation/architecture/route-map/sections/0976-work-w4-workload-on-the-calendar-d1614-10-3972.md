### Work W4: workload on the Calendar (D1614 §10, #3972, part)

Worker routes in `routes/agent_engine.ts` (mounted at `/api/teams`), behind E3's `AGENT_ENGINE` flag. The service is `services/agents/workWorkload.ts`, the calendar reader `services/calendar/workItems.ts`, and the migration `202611022205_work_workload.sql`. The client is `workApi.workload` and `workApi.setCapacity` (`frontend/src/lib/api/work.js`).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/project/:id/work/workload?weeks=1..12` | the project's read gate | `{ weeks, people: [{ person, capacity, weeks: [{ week_start, items, estimate_points, unestimated, over_capacity }], unscheduled }], agents: [...] }`. 400 `invalid_weeks`; 403 `not_member`. Projects only. |
| `PUT /api/teams/project/:id/work/capacity/:personUid` | the person, or a project editor | `{ weekly_capacity_points: 0–1000 \| null }` → `{ person, capacity }`. 400 `invalid_capacity`; 403 `not_manager`; 404 when the person is not on the project. |
| `PATCH /api/teams/tasks/:uid` | W1's gates; the assignee for their own block | Also `{ scheduled_start, scheduled_end }`: both or neither, the end after the start, within 7 days (400 `invalid_task`). Its `assignee` keeps E1's agent checks. |
| `GET /api/calendar/events?kinds=work_item` | signed in | The `work_item` source: the open tasks of the projects the member reads, in their block or all day on their due date. Page only. |

A capacity that is not set is `{ available: false, reason: 'Not recorded' }`, never 0, and never over. Agents' active scheduled sessions (#3957) sit in their weeks as items with `session`, counted as not estimated, for a viewer who reads the agent's team (D1614 §10.1).
