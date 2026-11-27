# frontend/src/pages/research/imports — the Research source import console

<!-- index: none -->

The private Super Admin console at `/research/source-imports` (D7738's canvas, boards FND-I00 onward; the routes are
`frontend/src/routes/researchSourceImports.jsx`, the client is `frontend/src/lib/api/researchSourceImports.js`, the
Worker is `/api/research-source-imports`, D7745). A source record is not a fund: this folder stages a private file
exactly as captured, reads it back, and later decides and promotes its records.

## The rules for a file here

- **No record value is drawn, stored or reported.** A page shows counts, record ids, digests, states and reason
  codes. The chosen file and its records stay in memory while the page is open: never in `localStorage`,
  `sessionStorage`, IndexedDB, the Cache API or an address. Nothing from the file goes in a path or a query.
- **Every error is a fixed sentence** before it is thrown, shown or reported (at most a source, a record index and a
  column name), because `frontend/src/lib/log.js` keeps and beacons what it is given. A Worker refusal is read by its
  code only.
- **The run logic has no React.** It is a pure module driven in tests by a stub transport; a page draws what it
  returns. Words for a run's result are D7170's (`frontend/src/pages/research/sheetsSyncModel.js`), not edited here.
- Each file opens with a header comment naming its decision and boards. This README takes no per-file rows, so a
  later part adds its pages without editing it (#7754 records and decisions, #7755 columns, promotion and the report).
