## Work W6 — the run sheet, the activity feed and Workload (D1614 §11, #3974)

WK5 to WK7 on the routes W3 and W4 added. Agent sessions on the Calendar (CAL10) wait for #3957.

| Address | Board | Backend |
| --- | --- | --- |
| `/projects/:id/work` (a card's item sheet › a run) | WK5 the run sheet, Retry | `GET /api/teams/runs/:uid`, `POST /api/teams/runs/:uid/retry` |
| `/projects/:id/settings/team?tab=activity` | WK6 the project activity feed | `GET /api/teams/project/:id/activity?who=&person=&agent=&before=` |
| `/projects/:id/work?view=workload` | WK7 Workload, drag to reassign, Schedule work | `GET /api/teams/project/:id/work/workload`, `PATCH /api/teams/tasks/:uid` (assignee; time block) |
