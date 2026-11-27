### WorkGraph release administration, parts 7, 8 and 11 (#5585, D5585-p7, D5585-p8, D5585-p11)

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
| `GET /authorities?tenant_id&company_id` | Part 8 (D5585-p8): who holds which release authority in the company, and with `history=1` every grant and revocation |
| `POST /authorities/grant` | Grant a release authority to a person linked to the company, from the `seq` the caller saw (write bar) |
| `POST /authorities/revoke` | Revoke a release authority, from the `seq` the caller saw; takes effect at once (write bar) |
| `GET /authorities/candidates?tenant_id&company_id` | Part 11 (D5585-p11): the company's linked people a grant may name, by name, with what each holds and each key's `seq` |
| `GET /scopes` | Part 11: every tenant and company with release lines, with the company's name, for the scope bar |
| `GET /status` | Part 11: whether release delivery and public sites are on, as booleans only |

Reads use `requireSuperAdmin`; writes and the drain use `requireSuperAdminWriteBar` and an admin audit row. Since part
11, every read that returns user ids also returns `people` (names, never emails), a line answers `lineName: null`
(`not_recorded`), and a manifest's evaluation lists the decisions that do not count, each with its reason.
