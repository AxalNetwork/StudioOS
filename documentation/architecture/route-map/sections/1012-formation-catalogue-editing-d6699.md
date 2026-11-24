### Formation catalogue editing (#6699, H3 of #6680)

No page or canvas is implemented here; the HQ screens are #6702.
All routes are mounted under `/api/admin/formation/catalogue` by
`routes/admin_formation_catalogue.ts` (the router #6693 created for pausing a form).
Editing is `requireHqAuthoring`; restricted-place writes are the Super Admin's,
past the write bar. Client: `frontend/src/lib/api/adminFormationCatalogue.js`.

| Route | Purpose |
| --- | --- |
| `GET /versions` | Every catalogue version, newest first |
| `GET /versions/:version` | Its content, each row's revision, `content_sha256`, `rules_sha256`, each form's templates SHA-256 |
| `GET /versions/:version/diff` | Rows added, removed and changed against the current published version (`?against=N` for another) |
| `GET /versions/:version/attention` | Its stale and disputed facts |
| `POST /drafts` | A draft copied from the current version (one open at a time) |
| `PUT /drafts/:version/:entity` | Create (revision null) or edit one row of a draft, revision-checked |
| `DELETE /drafts/:version/:entity` | Remove one row of a draft, revision-checked |
| `GET /sources` | Sources with their latest check |
| `POST /sources` | Record a source |
| `POST /sources/:id/checks` | Record a check: the day, the checker (the caller), the result |
| `GET /restricted` | The restricted places |
| `POST /restricted` | Super Admin: add one, with a source and the day it was checked |
| `PATCH /restricted/:id` | Super Admin: edit one |
| `DELETE /restricted/:id` | Super Admin: remove one |

`:entity` is one of `countries`, `forms`, `facts`, `fees`, `pack`, `questions`,
`scenarios`, `rules`. Every write takes a reason and is recorded in
`admin_audit_log` in the same batch. Only a draft is edited. See D6699.
