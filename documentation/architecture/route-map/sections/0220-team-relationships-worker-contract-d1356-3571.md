### Team relationships Worker contract (D1356, #3571)

Worker routes in `routes/relationships.ts`, mounted at `/api/relationships`, backed by `services/relationships.ts` and migration 653 (`team_memberships` and `shared_relationships` views; `relationship_shares`, `relationship_interactions`). The client is `lib/api/relationships.js`. There is no page yet. Every route needs sign-in, and a support session is refused 403 `support_session_refused`. Relationships are private by default: the access rule (my team, the teammate's membership of it, their share effective now) is inside each statement. A shared reply carries a name, company and title, never an email, phone, notes or URL. Every share, withdrawal, read and request is audited in `integration_audit_log`.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/relationships/sharing` | signed in | `{ opted_in, teams: [{ key, kind, label, shared }] }`. Teams are derived: a venture's founder and accepted co-founders, an investor firm and its accepted seats, HQ admins. |
| `PUT /api/relationships/sharing` | signed in | Takes `{ share }`: the one opt-in, for every team I belong to. Withdrawal takes effect on the next read. |
| `PUT /api/relationships/sharing/teams/:key` | a member of that team | Takes `{ share }`: on or off for one team. Another team is 404. |
| `GET /api/relationships/who-knows?person=…\|company=…\|fund=…` | signed in | `{ query, people: [{ ref, teammate, team, person: { name, company, title }, how: { source, source_label, connected_since } }] }`, at most 50. A person is an exact profile URL or email; a name alone is 400 `person_unmatchable`. Only eligible sources (`Connections.csv`, a spreadsheet, typed) are shared. |
| `POST /api/relationships/intro-request` | signed in | Takes `{ teammate, ref, note? }`. A row I cannot see is 404 "Not found.". Answers 201 `{ request }`, notifies the teammate and sends nothing to the contact; 20 a day (429 `intro_rate_limited`). |
| `GET /api/relationships/intro-requests` | signed in | `{ sent, received }`, my own only. |
| `POST /api/relationships/intro-requests/:uid/decide` | the teammate asked | Takes `{ decision: made \| declined }`, once (409 `decided`), and notifies the requester. |

