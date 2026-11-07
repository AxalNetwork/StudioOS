## HQ Contracts › Corporate Governance (D4563, #4563)

The screen is `/admin/contracts/governance`, a Contracts desk tab after Templates (`ContractsDesk section="governance"`, `frontend/src/routes/adminGovernance.jsx`; client `lib/api/adminGovernance.js`). It is HQ only. The Worker side is `routes/admin_governance.ts` and `services/governance.ts`, on migration 202611062154. Every route is behind `requireHqAuthoring`. A confidential document is 404 to anyone but the Super Admin.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/governance` | HQ admin | `{ entities: [{ key, name, documents, withheld }], categories, statuses, super_admin }`: the three entity collections. `withheld` counts the confidential documents the reader cannot see. |
| `GET /api/admin/governance/linkable` | HQ admin | The active templates (slug, title, category) and the completed envelopes (id, title, completed_at), to link. |
| `POST /api/admin/governance/documents` | HQ admin; confidential needs the Super Admin (403) | Creates a draft. A link to a template or an envelope that does not exist is 422. |
| `GET /api/admin/governance/documents/:uid` | HQ admin | `{ document, versions }`. |
| `PATCH /api/admin/governance/documents/:uid` | HQ admin; `confidential` needs the Super Admin | Changes the title, effective date, links or status. A disallowed move is 409 `status_move_refused`. Executed without a signed copy or a completed envelope is 409 `not_signed`. Changing an executed document's envelope is 409 `executed_link_locked`. |
| `POST /api/admin/governance/documents/:uid/versions` | HQ admin | Multipart `file`, `signed`, `note`. Takes a PDF or .docx of at most 25 MB, sniffed from the bytes (413 or 415 otherwise). An executed or archived document is 409 `document_closed`. |
| `GET /api/admin/governance/documents/:uid/versions/:n/file[?download=1]` | HQ admin | The file: inline for a PDF preview, else an attachment, with `private, no-store`. Audited. |
| `GET /api/admin/governance/ownership`, `PUT /api/admin/governance/ownership/:entity` | Super Admin only (403) | Each entity's ownership rows (holder, interest, percent, note), as restricted metadata. |
