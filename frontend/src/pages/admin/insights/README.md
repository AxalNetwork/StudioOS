# Insights

D893 (#2366): Admin › Insights at `/admin/insights`, built to the "Admin
Insights" canvas (INS1–INS11, `design/canvases/integrated/Admin Insights Page.dc.html`).
`/admin/held/insights` redirects here through `HeldInsightsRedirect.jsx`, which
keeps the query and hash and adds `?moved=held-insights` for the one-line notice.

- `AdminInsights.jsx` — the page: header, filter bar (a sheet on a phone), KPI
  tiles, blocks, the "How is this counted?" and Export dialogs, and the group
  lightbox. It mounts its own `WorkerRail` in a `RailFrame`.
- `insightsModel.js` — pure. Turns the reads into tiles and blocks, each
  `ready`, `loading`, `unreadable` or `unrecorded`; definitions; the CSV.
- `InsightsCharts.jsx` — the SVG charts (bars, columns, weekly line, 100% bar),
  their legend and "View as table".

## Rules

- Every figure comes from a mounted Worker read. The Super Admin's HQ analytics
  read is made only for a Super Admin; a plain Admin would get a 403.
- A read that failed or has not answered is never drawn as zero. A figure no
  read counts yet says "Not recorded" with its reason (`WAITS_FOR_READ`).
- Counts only: nothing on this page or in its export carries a name, an email
  or an account id.
- #2660 replaces the four reads with `GET /api/admin/insights` and enables the
  filters; #2661 makes the export a logged Worker export; #2662 adds the
  Super Admin's subsidiary scope.
