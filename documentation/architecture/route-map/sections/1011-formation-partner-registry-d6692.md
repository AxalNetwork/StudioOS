### Formation partner registry (#6692, P1 of #6680)

No page or canvas is implemented here; the HQ screen is #6702.
All routes are mounted under `/api/admin/formation/partners` by
`routes/admin_formation_partners.ts`, and every one is `requireHqAdmin`.

| Route | Purpose |
| --- | --- |
| `GET /` | Registered partners with status, coverage on, licensed countries and members |
| `GET /:uid` | One partner: data terms, licences, coverage with prices, members |
| `POST /` | Register an existing partner firm as a draft |
| `PATCH /:uid` | Its partner deal and next review date |
| `PATCH /:uid/data-terms` | The data agreement and its terms |
| `POST /:uid/credentials` | A licence in one country |
| `PATCH /:uid/credentials/:cuid` | Edit a licence |
| `POST /:uid/coverage` | A form, country and service, created off |
| `PATCH /:uid/coverage/:cuid` | Target hours, priority, on or off (on needs a current licence) |
| `POST /:uid/coverage/:cuid/prices` | A price; `cost_minor` is the Super Admin's |
| `PATCH /:uid/prices/:puid` | Edit a price |
| `POST /:uid/verify` | Super Admin, write bar; refused `dpa_missing` without a signed agreement |
| `POST /:uid/suspend` | Super Admin, write bar; coverage off in the same batch |
| `POST /:uid/end` | Super Admin, write bar; coverage off in the same batch |
| `POST /:uid/members` | A user who acts for the firm |
| `POST /:uid/members/:muid/revoke` | Revoke that membership |

Every write is recorded through `logAdminAction`. No case is assigned and
no partner is paid here. See D6692.
