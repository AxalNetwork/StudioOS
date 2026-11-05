### Distribution Overview data (#4485, part of #3722)

| Route | Purpose |
| --- | --- |
| `GET /api/cycles/grow/distribution/overview?project=&week=` | Existing Grow venture read gate; six honest KPIs, active campaigns, ISO-week content, writer-scoped replies and personal connection status |

Current-month CPL uses current-month spend and leads (owner choice A).
Campaign-window spend remains separate for budget usage. Null and unreadable
blocks retain their reasons. The client is in the existing cycleWrites factory.
DS1 Overview is mounted above the retained module tools through #4484's shell.
