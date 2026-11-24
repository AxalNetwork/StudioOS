### Package term lifecycle (#5025, D5025, D5025-p2)

No page or canvas is implemented here; the operator screens are #5026. The
routes are mounted under `/api/admin/licences` by
`routes/admin_package_lifecycle.ts` and are Super Admin only. Reads answer
`no-store`; the two writes use the Super Admin write bar and are audited. The
client module is `frontend/src/lib/api/packageLifecycle.js`.

| Route | Purpose |
| --- | --- |
| `GET /:uid/package-terms` | Each accepted package term of the licence with its state today: scheduled, active, renewal_pending, superseded or ended |
| `GET /:uid/package-offers/:offer/change-review` | A draft or offered offer read against the current term: renewal, upgrade, downgrade or change; programs held, added, ending and standalone becoming bundled; old against new price; country index movement; `financial_rule` `next_term_no_proration`; with `effective_on`, an actual-day proration quote that does not apply |
| `POST /:uid/package-offers/:offer/schedule-change` | HQ schedules an offered offer as the next term; refused unless it starts the day after the current term ends (D5025-p2) |
| `GET /:uid/package-changes` | The licence's schedules: scheduled, due, applied, lapsed or cancelled |
| `POST /:uid/package-changes/:change/cancel` | Cancel a schedule that has not been applied, with a reason |
