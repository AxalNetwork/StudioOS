### Start from › Import a document (D1563, #3810)

- **Worker, `routes/deck_imports.ts`** (mounted before `decks.ts`):
  - `POST /api/decks/imports?project_id=` takes `{ text, audience? }` or a multipart `file` (.docx, .pdf, .pptx) with `audience`;
  - paste, DOCX and PDF → `{ kind: 'outline', source, proposal, proposal_hash, outline, counts }`, the venture's outline proposal (`decks/documentOutline.ts`, the text read by `deckExtract.extractDeck`);
  - a .pptx → `{ kind: 'cards', source: 'pptx', proposal, proposal_hash, counts }`, one editable card per slide (`decks/pptxCards.ts` over `decks/pptxTemplate.ts`), switched by `deck:pptx_import`.
- **Next:** an outline builds through `POST /api/decks/generate` with `proposal_id`; the cards are kept through `POST /api/decks/proposals/:id/keep-slides`.
- **Tables:** `pitch_deck_proposals` only (no migration).
- **Client:** `lib/api/deckImports.js` (`deckImportsApi.importDocument`), read through `deckV2Adapter.importDocument`.
