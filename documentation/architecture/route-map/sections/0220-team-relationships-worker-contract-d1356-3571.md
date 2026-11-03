### Team relationships Worker contract (D1356, #3571)

Worker routes in `routes/relationships.ts`, mounted at `/api/relationships`, backed by `services/relationships.ts` and migration 653 (`team_memberships` and `shared_relationships` views; `relationship_shares`, `relationship_interactions`). The client is `lib/api/relationships.js`. There is no page yet. Every route needs sign-in, and a support session is refused 403 `support_session_refused`. Relationships are private by default: the access rule (my team, the teammate's membership of it, their share effective now) is inside each statement. A shared reply carries a name, company and title, never an email, phone, notes or URL. Every share, withdrawal, read and request is audited in `integration_audit_log`.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/relationships/sharing` | signed in | `{ opted_in, teams: [{ key, kind, label, shared }] }`. Teams are derived: a venture's founder and accepted co-founders, an investor firm and its accepted seats, HQ admins. |
| `PUT /api/relationships/sharing` | signed in | Takes `{ share }`: the one opt-in, for every team I belong to. Withdrawal takes effect on the next read. |
| `PUT /api/relationships/sharing/teams/:key` | a member of that team | Takes `{ share }`: on or off for one team. Another team is 404. |
| `GET /api/relationships/who-knows?person=…\|company=…\|fund=…` | signed in | `{ query, people: [{ ref, teammate, team, person: { name, company, title }, how: { source, source_label, connected_since } }] }`, at most 50. A person is an exact profile URL or email; a name alone is 400 `person_unmatchable`. Only eligible sources (`Connections.csv`, a spreadsheet, typed) are shared. |
| `POST /api/relationships/intro-request` | signed in | Takes `{ teammate, ref, note?, context_note? }` (the context note, D4329: at most 1,000 characters, read by the two people on the request). A row I cannot see is 404 "Not found.". Answers 201 `{ request }`, notifies the teammate and sends nothing to the contact; 20 a day (429 `intro_rate_limited`). |
| `GET /api/relationships/intro-requests[?team=&status=]` | signed in | `{ sent, received, follow_ups_due }`, my own only (D4329). `team` is one of my teams (another is 404); `status` is `pending`, `accepted`, `declined`, `made` or `withdrawn` (else 400 `status_invalid`). Each request carries `context_note`, `decision_note`, `outcome` (`{ value, label }`, "Not recorded" until one is) and my own `follow_up` (`{ due_on, snoozed_until, done_at, state }`). `follow_ups_due` counts my own follow-ups due today. |
| `POST /api/relationships/intro-requests/:uid/decide` | the teammate asked | Takes `{ decision: accepted \| declined, note? }`, once (409 `decided`); the note is the one the asker reads. `made` is 400 `decision_invalid`: an introduction is made when it is sent (below). Notifies the requester. |
| `POST /api/relationships/intro-requests/:uid/withdraw` | the asker | A pending request only (409 `not_pending`). Notifies the teammate. |
| `POST /api/relationships/intro-requests/:uid/outcome` | either side | Takes `{ outcome: meeting_held \| replied \| no_reply \| not_a_fit, note? }`, once the request is made (409 `intro_not_made`). The latest is the one the log reads. |
| `PUT /api/relationships/intro-requests/:uid/follow-up` | either side, for themselves | Takes `{ due_on: YYYY-MM-DD }` on an accepted or made request (409 `follow_up_unavailable`). Setting a new date reopens a done one. |
| `POST /api/relationships/intro-requests/:uid/follow-up/done` | either side, for themselves | Marks my follow-up done (404 `follow_up_not_found` when none is set). |
| `POST /api/relationships/intro-requests/:uid/follow-up/snooze` | either side, for themselves | Takes `{ until: YYYY-MM-DD }`, after today (400 `until_not_future`). |
| `POST /api/mail/send` with `intro_uid` | the teammate asked | D4329: the intro, sent from the introducer's own mailbox through the Email composer. Checked before anything goes out: 404 for anyone else's request, 409 `intro_not_accepted` or `intro_already_made`. After the send, the request is `made` (`mail_sent_uid` names the send, shown to the introducer only) and the requester is told. |

Every route above refuses a caller who is not on the request with 404 "Not found.", in the words of a request that does not exist, and no route contacts the person.

