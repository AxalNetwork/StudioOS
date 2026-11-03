## Settings, simplified — one entry, one page (D4152, #4152)

From `design/incoming/Settings Page.dc.html` (ST1–ST6). The sidebar's
"Settings" entry opens the scope's page; no route was added or removed.

| Address | Board | Backend today |
| --- | --- | --- |
| `/account/portfolio/:uid/settings` | ST2 General | `GET /api/company/:uid`, `PATCH /api/company/:uid` (only what changed). Logo waits for G1 (#4201). |
| `/account/portfolio/:uid/settings/legal` | ST4 Legal | `GET /api/company/:uid/legal` and the existing sheet (D1415, D1593). |
| `/account/portfolio/:uid/settings/projects[/:id]` | ST5 Projects | The settings scope's projects (D1415). |
| `/account/companies/:uid/settings/team` | Team tab | D1497's Team page. |
| `/projects/:id/settings` | ST3 Project | D1497's Project settings (Team · General, no Legal). |
