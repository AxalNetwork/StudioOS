### WorkGraph drafting registry, part 4 (#5582, D5582-p4)

No page or canvas is implemented here, and no client method. Super Admin only, and **off by default**: outside an HQ
preview deployment with `WORK_GRAPH_DRAFTING=preview`, every route answers 404 `drafting_unavailable`. Mounted at
`/api/admin/workgraph/drafting-assets` by `cloudflare-worker/src/routes/admin_workgraph_drafting_assets.ts`, beside
part 3's `/api/admin/workgraph/drafting` (`admin_workgraph_drafting.ts`).

| Route | Purpose |
| --- | --- |
| `GET /` | The verified company's drafting assets: ids, heads, digests and sources only |
| `POST /` | Register a deck, template or offer asset under `human_publication` and adopt the domain's current row (write bar) |
| `POST /:assetUid/adopt` | Adopt the domain's current row after a save outside WorkGraph, from the head the caller saw (write bar) |
| `POST /:assetUid/freeze` | Cut a D5585 manifest pinning the exact approved head, only while the domain row still reads as that head, and (part 5, D5582-p5) the exact D5583 media revisions a deck embeds at their digests (write bar) |

Templates also need counsel. Writes record an admin audit row beside WorkGraph's own events. Nothing here writes a
domain table, publishes a release or signs anything.
