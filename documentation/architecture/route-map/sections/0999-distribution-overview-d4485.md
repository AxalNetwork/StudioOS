### Distribution overview data (#4485, part of #3722)

| Route | Purpose |
| --- | --- |
| `GET /api/cycles/grow/distribution/overview?project=&week=` | Existing Grow venture read gate; six honest KPIs, active campaigns and an ISO-week content plan |

Current-month CPL uses current-month spend and leads (owner choice A).
Campaign-window spend remains separate for budget usage. Null and unreadable
blocks retain their reasons. The client is in the existing cycleWrites factory.

No DS1 canvas row is claimed here: this change implements the Worker and client;
Overview rendering and #4484's shared-shell integration remain open.
