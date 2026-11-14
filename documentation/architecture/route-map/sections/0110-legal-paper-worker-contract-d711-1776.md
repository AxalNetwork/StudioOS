### Legal paper Worker contract (D711, #1776)

Every legal document draws one HTML paper (`services/legalPaper.ts`), printed to PDF by Browser Run through `BROWSER.quickAction('pdf', …)`, with pdf-lib (`services/pdf.ts`) as the fallback. Every kept or handed-out file gets an append-only `legal_document_files` row (migration 475). See `decisions/D711.md`. Since #1865 the paper's tokens are R2's, and a stub's paper (`preview.pdf`, `render`, `render.pdf` and the thumbnail) reads "No body in the store yet." and, for a counsel slug, "Stub — counsel to draft."

New routes:
- `POST /api/admin/contracts/templates/render` · admin: `{ title, body, slug, category, version, page_size, cover, resolve, fonts }` → `{ html, body_sha256, page_size, paper_sha256, state }`, `no-store`. A body over 256 KB is 413 `body_too_large`.
- `GET /api/admin/contracts/templates/paper-fonts` · admin: `{ css, paper_sha256 }`, `private, max-age=86400`.
- `GET /api/admin/contracts/templates/store/:slug/export.docx?resolve=&page=` · admin: a Word file, after its `docx_export` row is written; 503 `export_unrecorded` and no file when the row cannot be written. Binary, outside the typed drift surface.
- `GET /api/admin/contracts/:uid/files` · the envelope's creator or a Super Admin: per file, its kind, renderer, page size, hash, size, `created_at`, whether a stored copy exists, and `signer`. Never a storage key, name or email.
- `GET /api/legal/esign/sign/:token/paper` · the signing token: `{ html, body_sha256, page_size }`, `no-store`; the token, expiry and void checks of `GET /sign/:token`, with no audit event.

Changed routes:
- `POST /api/legal/esign/sign/:token` writes `esign/signed/<uuid>/<file uid>.pdf` and its `signed_copy` row in the batch that signs.
- `GET /api/legal/esign/sign/:token/document` serves the recipient's own newest copy (else `signed_r2_key`).
- `POST /api/admin/contracts/envelopes/preview` and `/send`, and `POST /api/legal/esign/send`, take `page_size` (`letter`|`a4`) and `cover` (`dark`|`light`), else 400 `page_size_invalid` / `cover_invalid`. The preview answers `renderer` and `page_size`.
- `GET /api/admin/contracts/templates/store/:slug/preview.pdf` takes `?page=` and `?cover=` and sends `X-Axal-Renderer`.
- The DocuSign send writes a `docusign_source` row, and each reconcile a `docusign_signed` row (one per file).

