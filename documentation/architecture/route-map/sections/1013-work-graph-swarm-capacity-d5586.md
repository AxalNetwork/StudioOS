### WorkGraph swarm capacity read, part 4 (#5586, D5586-p4)

There is no page, canvas or client method here. The route is read-only and **off by default**: unless
`WORK_GRAPH_SWARM_READ=on`, every route answers 404 `swarm_read_off`. It is mounted at `/api/work-graph/swarm` by
`cloudflare-worker/src/routes/work_graph_swarm.ts`.

Who can read: a signed-in person linked to the company, with the Owner, Admin or Founder role, or the primary admin.
The company's records must not live under another tenant. Any other caller gets the same 404 `not_found`.

| Route | Purpose |
| --- | --- |
| `GET /capacity?tenant_id&company_id[&since]` | The venture's capacity read model from the admission coordinator, bottleneck signals, registered agents, image-model calls and retention counts. Unknown values are `not_recorded`; values that could not be read are `unavailable` |
| `GET /audit?tenant_id&company_id[&ticket_uid][&limit]` | The venture's admission audit: the copy in D1, plus the coordinator's entries not yet copied |

The capacity dashboard that would read these routes needs a canvas.
