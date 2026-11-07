### Distribution Results (D4491, #4491; part of #3722)

`/grow/distribution/results` uses #4484's Distribution shell; `CycleRoute`
renders `ResultsTab` for `tab="results"`. The venture read is
`GET /api/grow/results?project=&from=&to=`, mounted by `grow_results.ts`
behind the same reader gate as `/api/cycles/grow/campaigns`. Campaign
figures reuse the shared read `campaigns(env, pid, { from, to })` in
`services/growCampaigns.ts`; per-source counts map `utm_source` to the
venture's channels; per-channel spend comes from Mercury, else typed spend.
Without `from`/`to` the figures are lifetime/campaign-window and labelled so.
A bad window is a 400 with our own sentence. The read writes nothing:
revenue, MRR and `project_metrics` stay on `/grow/revenue-and-traction`,
which the tab links to.
