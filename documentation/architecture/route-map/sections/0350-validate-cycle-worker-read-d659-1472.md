### Validate cycle Worker read (D659, #1472)

`cycle_validate.ts`, mounted at `/api/cycles/validate`, is the Worker half of
the Validate cycle in `Cycle Overview.dc.html` (cycle Validate; O1, O1n, O5)
and `Cycle Modules · Boards.dc.html` (MV1–MV6). `GET /overview?project=`
returns #1469's four figures (interviews this month, pain themes, hypotheses
supported, waitlist sign-ups) and six cards. `GET /modules/:slug?project=`
returns one card and its records table. The slugs are `problem-discovery`,
`customer-research`, `ideal-customer-profile`, `market-intelligence`,
`demand-signals` and `experiments`. The SPA pages that draw them are #1474's
(S07), so these are routes for those screens, not screens of their own.
The Spin-Out Lab market page already reads `GET /market-readiness` and
writes `PUT /market-marks/:item` and `POST|DELETE /market-sources`. The other
writes (`/segments`, `/interviews/:id/segment|stage`, `/demand-signals`,
`/waitlist-target`, `/interviews-target` (D685 §5.12), `/competitor-mentions`, `/hypotheses/:id/plan`,
`/evidence-links/:id/strength`) call the same writers as #1471's interview
accept path. See `decisions/D659.md`.
D690 (#1692, migration 460) adds the form writes for the six records, each a
writer in `services/validateWriters.ts` that logs its record and refuses a
path id of another venture with a 404: `POST /themes`, `PATCH|DELETE
/themes/:id`, `PATCH /segments/:id`, `POST /competitors` (a name, one of the
caller's analysed companies or a directory company; 201 when added),
`PATCH /competitors/:id` (watch and positioning), `PATCH
/demand-signals/:id` (a `signal-` record only), `POST /hypotheses` and
`PATCH /hypotheses/:id`. The row actions' writers (merge, split, attach a
quote, Stop, evidence, experiments, a signal's file) are each record's
actions, below.
`founder_validate_sessions.ts` adds `GET /sessions/:id/audio`, one
short-lived signed download per recorded chunk, and `DELETE
/discovery/interview/:id` now calls `services/interviewWriters.ts`'s
`deleteInterview`.
The `experiments` records carry Eadwyn's mark (D424) on each hypothesis as
`provenance`, read by the board's `claimFills`. A failed read sets
`fills_recorded: false` and marks every row `unreadable` (#1523, `D661.md`).
Each module read also carries its list's title (`module.records_title`), the
canvas's columns, and `records.filters` and `records.sorts`, default sort
first (D690 decision 10). Filters are `filter=key:value` pairs:
problem discovery adds `icp:yes`, `need:yes` and `sort=recent`; customer
research filters `icp`, `consent` and `channel` (and still `stage:pipeline`
with `sort=booked` for the recruiting picker); the profile adds `fit:strong|none`
and sorts by evidence; experiments adds `status:retired` (retired claims, only
then), `sprint`, `moved:recent`, `history:last_week` and `history:this_month`,
each applied before paging. Interview rows carry `role`, `pains`,
`duration_min`, `state` (D690 decision 9) and, for a writer, `session_id`.
Beside `records`, `parts` holds what the bottom sections draw, each count over
the whole venture (decision 16): `can_write` on every module; `stats` on
customer research, problem discovery and experiments; problem discovery's
`themes` (writers only) and `unthemed` with `unthemed_total`; experiments'
`fit_gap` and `stats.history_since`. A part follows its store's gate, and a
phrase said without consent reaches a non-writer as
"Quote withheld (no consent to quote)". See `decisions/D690.md`.

