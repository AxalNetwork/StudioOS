# templates/legal — the legal document templates

Markdown templates rendered into the documents the platform issues: co-founder
agreements, SAFEs, side letters, advisor terms, NDAs, incorporation papers and
the rest. `cloudflare-worker/src/services/legalDocFormat.ts` renders them; `cloudflare-worker/src/routes/legal.ts` and
`cloudflare-worker/src/routes/esign.ts` serve and sign them.

Templates carry merge fields (`{{counterparty.founder_id}}` and similar) filled
from D1 at render time. `LEGAL_REVIEW.md` in this folder records review status.

## Rules

- **An issued document is immutable.** Once rendered and signed it is stored
  with an object-lock and its hash is written to D1. Editing a template never
  changes a document already issued — and must not appear to.
- **Editing a template changes future legal documents.** This is not a copy
  change. Version it (`_v1`, `_v2`) rather than editing in place, so an existing
  agreement can still be reproduced exactly as it was signed.
- A bundled file that `cloudflare-worker/src/services/legalTemplates.ts` imports is the fallback for its
  library row, never a second text (D758).
- Entity and address blocks are stamped from `documentation/architecture/LEGAL_ENTITIES.md`
  — do not hard-code them into a template.
- Some terms appear here as **prose a human fills in** and nowhere else in the
  schema. MFN is the clearest example: it exists in these templates as
  `MFN Provision: [Yes/No]` and as no column anywhere. That is why the cap-table
  surface says SAFE conversion detail is not shown rather than computing it.

## Subfolders

- `paper/` — the faces and the mark the legal paper prints in (D711): seven
  subset woff2 files, their licences, and a copy of the Axal mark.
  `cloudflare-worker/src/services/legalPaperCss.ts` inlines them as `data:` URIs, so no render
  fetches a font. `paper/README.md` gives each file's source and subset command.
