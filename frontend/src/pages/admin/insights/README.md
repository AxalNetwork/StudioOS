# Insights

D893 (#2366): Admin › Insights at `/admin/insights`, built to the "Admin
Insights" canvas (INS1–INS11, `design/canvases/integrated/Admin Insights Page.dc.html`).
`/admin/held/insights` redirects here through `HeldInsightsRedirect.jsx`, which
keeps the query and hash and adds `?moved=held-insights` for the one-line notice.

- `AdminInsights.jsx` — the page: header, filter bar (a sheet on a phone), KPI
  tiles, blocks, the "How is this counted?" and Export dialogs, and the group
  lightbox. It mounts its own `WorkerRail` in a `RailFrame`.
- `insightsModel.js` — pure. Turns the read into tiles and blocks, each
  `ready`, `loading`, `unreadable` or `unrecorded`; the filters from and to
  the URL; definitions; the CSV.
- `InsightsCharts.jsx` — the SVG charts (bars, columns, stacked columns, the
  weekly line with its dotted period before, the 100% bar and the Plan donut),
  their legend and "View as table".

## Rules

- The page makes one read, `GET /api/admin/insights` (#2660, any admin), with
  the URL's range, profile, country and compare; the group lightbox makes the
  same read with `group=<role>`. A Super Admin's page also reads the Scope
  select's list, once. A plain Admin asking for another scope sees INS10 and
  no read is made.
- A read that failed or has not answered is never drawn as zero. A block whose
  store failed shows the Worker's sentence; one nothing records says "Not
  recorded" with its reason.
- Counts only: nothing on this page or in its export carries a name, an email
  or an account id.
- #2661 makes the export a logged Worker export.
- #2662 (D893 S08): the Super Admin's Scope select lists HQ-held and each
  deployed subsidiary (`GET /api/admin/insights/scopes`); a pick sets
  `?scope=<code>` and the read is made from that subsidiary's own database.
