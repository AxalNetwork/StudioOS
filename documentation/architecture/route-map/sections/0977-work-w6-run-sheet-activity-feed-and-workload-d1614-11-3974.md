## Work W6 — the run sheet, the activity feed and Workload (D1614 §12, #3974)

WK5 to WK7 on the routes W3 and W4 added. A Calendar agent session (CAL10) opens the run sheet from its last runs (D1614 §12.1). Agents' sessions join Workload once W4 fills `WORKLOAD_DEPS.agentSessions` (#3972).

| Address | Board | Backend |
| --- | --- | --- |
| `/projects/:id/work` (a card's item sheet › a run) | WK5 the run sheet, Retry | `GET /api/teams/runs/:uid`, `POST /api/teams/runs/:uid/retry` |
| `/calendar/item/agent_session/:id` (Last runs › Open run) | CAL10 › WK5 the run sheet, Retry | `GET /api/teams/sessions/:uid` (`last_runs[].uid`), `GET /api/teams/runs/:uid` |
| `/projects/:id/settings/team?tab=activity` | WK6 the project activity feed | `GET /api/teams/project/:id/activity?who=&person=&agent=&before=` |
| `/projects/:id/work?view=workload` | WK7 Workload, drag to reassign, Schedule work | `GET /api/teams/project/:id/work/workload`, `PATCH /api/teams/tasks/:uid` (assignee; time block) |
