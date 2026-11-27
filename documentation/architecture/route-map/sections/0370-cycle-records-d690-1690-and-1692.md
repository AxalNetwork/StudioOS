### Cycle records (D690, #1690 and #1692)

`cycle_records.ts`, mounted at `/api/cycles`, serves one record of any cycle
that registers a service in `services/records/index.ts`; Validate, Build,
Raise and Grow do:

- `GET /:cycle/modules/:slug/records/:id?project=`: the record, its sections,
  actions and `next`, and its first activity page;
- `GET …/records/:id/activity?project=&page=`: 20 rows a page, newest first;
- `POST …/records/:id/actions/:key?project=`: a declared action only, JSON or,
  for a file field, `multipart/form-data`; `PATCH` and `DELETE` on the record
  run its `edit` and `delete`;
- `GET /:cycle/modules/:slug/form-options?project=`: the Add forms' choices,
  every other query parameter passed through.

The refusals run in order:

1. no session: 401;
2. a missing or malformed `project`: 400;
3. an unknown cycle, a cycle with no service, or an unknown module: 404;
4. a malformed id: 404, before any read;
5. a missing venture: 404;
6. the module's read gate, or the write gate for actions and form-options: 403;
7. an id not in the module's own store for this venture: 404, as is any id an
   action's body names.

A partner reads a record without its writer-only sections and gets
`actions: []`. Validate's six (`services/records/validate.ts`, #1692) are a
pain group, an interview, a segment, a competitor candidate, a demand record
(`signal-`, `revenue-` or `waitlist-`) and a hypothesis. See
`decisions/D690.md`.

Build's six (`services/records/build.ts`, D690 S18-B, #1694 and #1695) are
gated `read` and `write`, as their module read is (`canReadBoard`, `canWrite`):

| Module | Id | Actions (`POST …/actions/:key`) |
| --- | --- | --- |
| `solution-design` | the feature's id | `add-risk`, `edit-description`, `scope-out` or `scope-in`, `add-to-roadmap`, `mark-must-have`, `edit` |
| `prototype-mvp` | the must-have's feature id | `add-session`, `add-finding`, `link`, `add-check`, `check`, `mark-blocked`, `mark-done`, `edit` |
| `product-roadmap` | the item's id | `add-dependency`, `move`, `edit` |
| `founding-team` | `h-<holder id>` | `edit-split` (a link), `log-contribution`, `edit` |
| `company-creation` | `step-<n>`, `obligation-<n>` or `lab-<order>-<n>` | `step-`: `mark-filed`, `step-check`, `edit`; `step-` and `obligation-`: `upload-proof` (multipart), `open-proof`; `lab-`: none |
| `operating-systems` | the kind (`crm`) | `reconnect` (a link), `edit` (Choose connector), `disconnect` |

Each edit-style action runs the same function as its route in `cycle_build.ts`
(`POST /features`, `POST /must-haves`, `PATCH /features/:id`, `POST /risks`,
`POST /roadmap`, `PATCH /roadmap/:id`, `POST /founders`, `PATCH /founders/:id`,
`POST` and `PATCH /formation-steps`, `PUT /systems/:kind`), and every write logs
one `build.<module>` row. Build's form-options serve each module's choices, and
Operating systems' per kind add the catalogue providers and `sync_editable`.

Raise's seven (`services/records/raise.ts`, D691 #1699 and #1700) are gated
`write` throughout, so only the venture's owner, an admitted Lab member on
their own venture or an admin reaches them (403 for anyone else, partners
included). Their ids and actions:

| Module | Id | Actions (`POST …/actions/:key`) |
| --- | --- | --- |
| `fundraising-readiness` | the item key (`data_room`) | `rescore`, or `score` (a form) for `team` |
| `investor-narrative` | the version (`3`) | `duplicate`, `edit` (`PATCH` the record) |
| `pitch-deck` | the share token's id | `revoke` |
| `data-room` | the file's id (its `uid` rides on the record) | `manage-access` (a link), `replace` (multipart), `remove` |
| `cap-table` | `h-<n>`, `e-<n>` or `pool` | `model-a-round` (a link), `edit` for a founder or a SAFE/note |
| `use-of-funds` | the section key (`go-to-market`) | `add-hire`, `edit-split` |
| `capital-relationships` | the prospect's id | `log`, `add-feedback`, `mark-passed`, `edit` |

Each action calls the writer its `cycle_raise.ts` or `data_room.ts` route
calls, and logs one `raise.<module>` row. Raise's form-options serve each
module's Add form; Capital relationships takes `q` for the fund search, read
only from the funds the directory serves. See `decisions/D691.md`.

Grow's seven (`services/records/grow.ts`, D691 #1698) are a feedback (its
uid), a channel (uid), a KPI (`mrr`, `paying_accounts`, … or `custom-<uid>`),
a role (the posting's id), a partner (uid), a market (uid) and an obligation
(its id). Their read and write gates are `canAccessProject`, as
`cycle_grow.ts`'s are: an advisor member reads, without a third party's name,
and gets `actions: []`; applicant names and Close role are the posting's
host's or an admin's. Each module answers `form-options` with its chips.
`POST …/durable-company-building/records/:id/actions/mark-held` takes
`multipart/form-data` for its minutes. See `decisions/D691.md`.

