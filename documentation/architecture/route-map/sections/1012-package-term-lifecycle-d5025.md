### Package term lifecycle (#5025, D5025)

No page or canvas is implemented here; the operator screens are #5026. Both
routes are mounted under `/api/admin/licences` by
`routes/admin_package_lifecycle.ts`, are Super Admin only, answer `no-store`
and write nothing. The client module is
`frontend/src/lib/api/packageLifecycle.js`.

| Route | Purpose |
| --- | --- |
| `GET /:uid/package-terms` | Each accepted package term of the licence with its state today: scheduled, active, renewal_pending, superseded or ended |
| `GET /:uid/package-offers/:offer/change-review` | A draft or offered offer read against the current term: renewal, upgrade, downgrade or change; programs held, added, ending and standalone becoming bundled; old against new price; country index movement; with `effective_on`, an actual-day proration quote |
