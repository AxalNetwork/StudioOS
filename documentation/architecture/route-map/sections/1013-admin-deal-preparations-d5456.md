### Private deal preparation drafts, ADP-02 part 1 (#5456, D5456)

No page or canvas is implemented here. Platform admins only (`requireAdmin`, then D5454's `preparationCapabilities`
on this deployment). Mounted at `/api/admin/deals` by `cloudflare-worker/src/routes/admin_deal_preparations.ts`; the
client is `frontend/src/lib/api/adminDealPreparations.js`.

| Route | Purpose |
| --- | --- |
| `GET /` | This deployment's preparation queue: metadata only, keyset-paged, filtered by preparation state |
| `GET /:uid` | One draft's authoring view: working revision, revision token, readiness warnings, issuer company and project |
| `GET /:uid/revisions` | Revision metadata, newest first, no content |
| `POST /` | Create a private draft for a company-backed project (operation key); **disabled**, 403 `preparation_mutations_disabled` |
| `PATCH /:uid` | Save a new working revision from `expected_revision` (operation key); **disabled**, as above |

A draft owns no `deals` row. Nothing here publishes, invites or changes a legacy deal route.
