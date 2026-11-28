### Private deal preparation drafts, ADP-02 (#5456, D5456, D5456-p2)

No new page or canvas. The Studio lens's Draft Deal dialog (`/deals`, admins) saves through `POST /` and `PATCH /:uid` (D5456-p2). Platform admins only (`requireAdmin`, then D5454's `preparationCapabilities`
on this deployment). Mounted at `/api/admin/deals` by `cloudflare-worker/src/routes/admin_deal_preparations.ts`; the
client is `frontend/src/lib/api/adminDealPreparations.js`.

| Route | Purpose |
| --- | --- |
| `GET /` | This deployment's preparation queue: metadata only, keyset-paged, filtered by preparation state |
| `GET /:uid` | One draft's authoring view: working revision, revision token, readiness warnings, issuer company and project |
| `GET /:uid/revisions` | Revision metadata, newest first, no content |
| `POST /` | Create a private draft for a company-backed project (operation key) |
| `PATCH /:uid` | Save a new working revision from `expected_revision` (operation key); a stale revision is 409 `revision_conflict` |

A draft owns no `deals` row and cannot go live until ADP-04's release (#5458). Nothing here publishes, invites or changes a legacy deal route.
