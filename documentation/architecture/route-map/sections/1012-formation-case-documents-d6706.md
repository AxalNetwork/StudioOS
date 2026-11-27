### Formation case documents, the founder's side (#6706, E14 of #6680)

No page or canvas is implemented here. Mounted at `/api/formation/cases` by `cloudflare-worker/src/routes/formation_case_documents.ts`; every route is signed in and scoped to the caller's own v2 case.

| Route | Purpose |
| --- | --- |
| `GET /:uid/documents` | The case documents the founder may see, each with its SHA-256 and signing state, and the form's template set as a plan (nothing is written) |
| `GET /:uid/documents/:docUid` | One of them; a generated document carries its text, a stored file only its hash |
| `POST /:uid/documents/sign` | Send a generated document or a contract template of the form for signature, to the founder or a person of the case; `purpose: consent_to_act` for an appointee |

Generation, uploaded consents and pack approvals are called by HQ's and partners' routes through `services/formationDocuments.ts`. See D6706.
