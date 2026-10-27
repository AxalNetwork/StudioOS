# services/fills

"AI fills the blanks", and since #2431 "Fill with Eadwyn": which fields may be
filled, what each fill must promise, where a value came from, and the writes
that keep it. Read [D777](../../../../documentation/architecture/decisions/D777.md),
[D1323](../../../../documentation/architecture/decisions/D1323.md),
[D1325](../../../../documentation/architecture/decisions/D1325.md) and
[D1326](../../../../documentation/architecture/decisions/D1326.md) first.

**Eadwyn proposes and a person accepts.** Nothing in this folder writes a
value into a record the member did not keep, and every path that records a
fill ends in `provenance.ts`' `recordFill`, which refuses a never-fill field
whatever its caller passed.

| File | What it owns |
| --- | --- |
| `types.ts` | The three fill classes (`restatement`, `sourced`, `composition`), `Citation`, `FillTarget` and the fill-kind shape. |
| `registry.ts` | `FILL_KINDS`: Validate's fills, each kind's surface, parse and `apply` (the form's own writer). |
| `citations.ts` | Citations for a `sourced` fill, from the Library first and research second. |
| `neverFill.ts` | The fields Eadwyn never fills (D777), mirrored by `frontend/src/lib/neverFill.js`. |
| `fields.ts` | D1325: FILL_FIELDS, which form fields Fill with Eadwyn may fill, how and from where; mirrored by `frontend/src/lib/fillFields.js`. |
| `sources.ts` | D1325: FILL_SOURCES, the read-only adapters the sheet gathers (Eadwyn's waiting proposals, a connector's state, a module's choices). |
| `provenance.ts` | `fill_provenance`: `recordFill`, `recordCompositionFills`, migration 643's source columns and `marksForRows`. |
| `formRun.ts` | D1326: the `form` handler's gather, prompt and parse for `POST /api/ai/rail/run`. It writes nothing. |
| `scopes.ts` | D1329: RECORD_SCOPES, the records filled that are not a venture's (an advisor's service, a partner's status report, an event and its agenda, a publication, an IC memo), each with one literal read and its own route's write check; a reader gets marks and no trigger, an admin gets none on another member's decision record, an Explorer holds nothing to fill. |
| `keep.ts` | D1326: after the member decides. `recordKept` (after a form's Save), `acceptRows` (Accept all, at most 50, through `ROW_WRITERS`) and `undoFill` (through `UNDO_WRITES`, only while the field holds the fill). |

**Rule for adding here.** A new form joins FILL_FIELDS (both copies) and, if
it writes rows, `ROW_WRITERS`; a new undoable column joins `UNDO_WRITES` as one
literal statement. No table or column name is ever spliced into SQL.
