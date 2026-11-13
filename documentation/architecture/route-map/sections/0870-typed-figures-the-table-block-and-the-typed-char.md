### Typed figures, the table block and the typed charts (D1538, #3787)

`routes/deck_typed_values.ts`, mounted at `/api/decks` beside `deck_grid.ts`; store `deck_typed_values` (migration 734). Client: `lib/api/deckTypedValues.js` (`deckTypedValuesApi`), read through `deckV2Adapter.typedTables` (a `SWAPPED` row of the seam).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/decks/:id/typed-values` | whoever may read the deck (`projectOwned`) | `{ deck_id, values: [{ key, label, value, unit, grade: 'Stated', typed_by: { id, name } \| null, typed_at }] }`, the venture's figures, the same for every version. A key nobody typed is absent, never 0. 403 / 404. |
| `PUT /api/decks/:id/typed-values/:key` | write access to the venture; never a support session (403 `support_session_refused`) | `{ label, value, unit }` (`count`, `usd`, `percent`, `months` or `text`) → `{ value }`. 400 `invalid_key`, `label_required`, `invalid_unit`, `invalid_value`, `value_required`; 409 `too_many_values` past 200. |
| `DELETE /api/decks/:id/typed-values/:key` | as `PUT` | `{ deleted: true }`; 404 `not_found` when nothing is typed under the key. |

D1523 (#3775), figure badges: `routes/deck_figures.ts`, mounted at `/api/decks` after `deck_typed_values.ts`; classifier `services/decks/figures.ts` (pure, reads the version's saved slides). Client: `lib/api/deckFigures.js` (`deckFiguresApi`), read through `deckV2Adapter.figures` (a `SWAPPED` row of the seam) by the editor's Check claims sheet only. Contract `contracts/deckFigures.schema.json`.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/decks/:id/figures` | whoever may read the deck (`projectOwned`) | `{ deck_id, figures: [{ card, block_id, kind, label, at, state, value, source, figures? }], counts: { linked, stated, uncited, not_recorded } }`. `state` is `linked` (bound to a record; `source` names the slot, record, as of and grade), `stated` (typed), `uncited` (a number in free text) or `not_recorded` (never 0). Editor-only: Present, share links and exports never call it. 403 / 404. Reads only. |

The slide model gains a `table` block (≤ 8 columns × 12 rows; each cell `{ text }`, `{ binding }` or `{ check }`) and the `market_circles` and `projection` chart types. `GET /api/decks/model` keeps `chart_types` at the library's 12 tiles and adds `typed_chart_types`. Every Worker export (HTML, PPTX, .odp) writes a table's rows; the editor, Present and print draw it and the two charts through `BlockGrid.jsx`. The evidence check reads each table row and each typed figure as a stated claim (`raiseClaims.cardText`, `typed:<key>`).
