### WorkGraph release review, part 10 (#5585, D5585-p10)

No page or canvas is implemented here. Signed in, for people linked to the company, and **off by default**: until
`WORK_GRAPH_RELEASE_ADMIN` is `on` (the same switch as the Super-Admin release routes), every route answers 404
`release_review_off` before any D1 read. Mounted at `/api/work-graph/releases` by
`cloudflare-worker/src/routes/release_reviews.ts`.

| Route | Purpose |
| --- | --- |
| `GET /pending?tenant_id&company_id` | The manifests awaiting the caller's decision: only profiles a release authority they hold can decide, ids and digests only |
| `POST /manifests/:manifest/decisions` | Record the caller's own approve, reject, request for changes or withdrawal, at the digest they reviewed (step-up) |
| `POST /attestations` | Attest a component revision at its digest, under a release authority the requirement names (step-up) |

Authority comes only from the per-company store for the caller; being a Super Admin adds nothing. Every write is an
audit row.
