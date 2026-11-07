## Work W6 — the run sheet, the activity feed and Workload (D1614 §12, #3974)

WK5 to WK7 on the routes W3 and W4 added. A Calendar agent session (CAL10) opens the run sheet from its last runs (D1614 §12.1). Agents' scheduled sessions are teal bars in Workload, from the same read (#3972, D1614 §10.1).

| Address | Board | Backend |
| --- | --- | --- |
| `/projects/:id/work` (a card's item sheet › a run) | WK5 the run sheet, Retry | `GET /api/teams/runs/:uid`, `POST /api/teams/runs/:uid/retry` |
| `/calendar/item/agent_session/:id` (Last runs › Open run) | CAL10 › WK5 the run sheet, Retry | `GET /api/teams/sessions/:uid` (`last_runs[].uid`), `GET /api/teams/runs/:uid` |
| `/projects/:id/settings/team?tab=activity` | WK6 the project activity feed | `GET /api/teams/project/:id/activity?who=&person=&agent=&before=` |
| `/projects/:id/work?view=workload` | WK7 Workload: a project editor drags a bar to reassign it and sets anyone's weekly capacity; a person sets their own; Schedule work. A reader sees neither a drag nor a capacity button (#4735) | `GET /api/teams/project/:id/work/workload`, `PATCH /api/teams/tasks/:uid` (assignee; time block), `PUT /api/teams/project/:id/work/capacity/:person` (`{ weekly_capacity_points }`, `null` clears it) |
