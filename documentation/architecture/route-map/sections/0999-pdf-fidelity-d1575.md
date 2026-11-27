### The PDF that matches the screen (D1575, #3822)

- **Worker:** `routes/decks.ts`, `POST /api/decks/:id/export` `{ format: 'pdf' }` (unchanged path). A studio deck renders at its aspect (1920 × 1080 or 1440 × 1080, `services/decks/pdfExport.ts` `printPageOf` / `pdfRenderOptions`); a template deck at 1920 × 1080.
- **Check:** `checkDeckPdf` on the answered bytes: page size, fonts embedded, words as text, links live. A failure is `502 pdf_fidelity_failed` with `diagnostic.checks` codes only, and no `deck_exports` row or audit.
- **Client:** unchanged. `ExportDialog`'s PDF card calls `api.deckExport`.
