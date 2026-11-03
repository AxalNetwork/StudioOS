### The editable PowerPoint (D1574, #3821)

- **Worker:** `routes/deck_exports.ts`, mounted at `/api/decks` before `decks.ts`:
  - `POST /:id/export` `{ format: 'pptx', notes?, sources? }` → the editable `.pptx` (`X-Deck-Export-Mode: editable`). Any other format passes on to `decks.ts` (the PDF).
  - `POST /:id/export/google-slides` uploads the same writer's file.
- **Who:** D895's deck check (`projectOwned(..., { write: true })`). The brand is the venture owner's (`deckOwnerBrand`). One `deck_exported` audit row is written, and the ledger middleware writes the `deck_exports` row with the file's SHA-256 before the file is handed out.
- **Writer:** `services/decks/pptxEditable.ts` places every area on The Grid's `boxOf`. Charts are native, from `services/decks/pptxChart.ts`. Bound series are read once through `boundSeries` (at most 24 keys). No slide is photographed; the headless browser is used only to picture a chart type with no native chart.
- **Client:** unchanged. `ExportDialog`'s PowerPoint card already calls `api.deckExport`.
