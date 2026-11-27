### Grow campaign details (#4483, extending #4447)

All routes remain under `/api/cycles/grow` and use the existing venture gate.

| Route | Purpose |
| --- | --- |
| `GET /campaigns?project=&status=&q=` | Literal name/status filters; counts before filtering, monthly spend sources and leads/demos/customers |
| `GET /campaigns/:uid?project=` | Detail with creator name, creation date and same-venture linked items |
| `GET /campaigns/:uid/creatives?project=` | Plain creative text; venture readers |
| `PUT /campaigns/:uid/creatives/:placement/:field` | Upsert text and actor audit; venture writers; ended/archived refuse |

Existing campaign and channel writes additionally accept audience kind and
per-channel budget type/dates. Paused can end. See D4483 for monthly Mercury
precedence and null/Unreadable rules. No UI or external publishing is added.
