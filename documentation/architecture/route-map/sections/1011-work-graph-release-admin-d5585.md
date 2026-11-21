### WorkGraph release administration, part 7 (#5585, D5585-p7)

No page or canvas is implemented here. Super Admin only, and **off by default**: until `WORK_GRAPH_RELEASE_ADMIN`
is `on`, every route answers 404 `release_admin_off` before any D1 read. Mounted at
`/api/admin/work-graph/releases` by `cloudflare-worker/src/routes/admin_work_graph_releases.ts`.

| Route | Purpose |
| --- | --- |
| `GET /lines?tenant_id&company_id` | The scope's release lines and what each one's publication pointer names |
| `GET /lines/:line?tenant_id&company_id` | The published release, evaluated; what the line may serve; its manifests |
| `GET /manifests/:manifest?tenant_id&company_id` | One manifest's evaluation: pinned pieces, what each owes, what the release lacks |
| `GET /deliveries?tenant_id&company_id` | The release outbox: each effect's state and its delivery row |
| `POST /manifests/:manifest/publish` | Publish at the reviewed digest from the expected pointer (write bar) |
| `POST /manifests/:manifest/takedown` | Take a release or one pinned piece down (write bar; needs a release authority) |
| `POST /lines/:line/repin` | Re-pin an earlier published manifest from the head the caller saw (write bar) |
| `POST /drain` | One bounded drain of the release outbox, at most 25 effects (write bar; delivery must be `preview`) |

Reads use `requireSuperAdmin`; writes and the drain use `requireSuperAdminWriteBar` and an admin audit row.
