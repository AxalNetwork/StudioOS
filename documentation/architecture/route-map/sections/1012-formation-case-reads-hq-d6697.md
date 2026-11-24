### Formation cases, HQ's reads (#6697, H1 of #6680)

No page or canvas is implemented here. Mounted by `cloudflare-worker/src/routes/admin_formation_cases.ts`; every route is `requireHqAdmin` (a branch gets `hq_only`). Read only; the writes are #6698's. Client: `frontend/src/lib/api/adminFormationCases.js`.

| Route | Purpose |
| --- | --- |
| `GET /api/admin/formation/cases` | The queue: `view` (all, unassigned, waiting_on_hq, screening_review, partner_late, with_registry, registry_question, waiting_on_founder, closing), `country`, `partner`, `route`, `track`; legacy and v2 cases together, legacy rows marked; ages, party clocks and bands; no people, no documents |
| `GET /api/admin/formation/cases/:uid` | One case: stages, filings, requests, fee lines, timeline, choice record; people, documents and answers for its HQ owner and Super Admins only (counts for any other admin), each such read written to `formation_case_access_log` |
| `GET /api/admin/formation/filings` | Every filing by state, with days since it was submitted |

`GET /api/admin/incorporations` is unchanged. See D6697.
