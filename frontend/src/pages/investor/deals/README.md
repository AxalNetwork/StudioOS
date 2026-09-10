# `pages/investor/deals` — the Deals bucket, one file per artboard

`design/canvases/integrated/Pages · Investor Deals.dc.html` draws four
artboards — **ID1 Pipeline**, **ID2 Screening**, **ID3 Commit**, **ID4
Closing** — and each is a full composition rather than a card: a four-up strip,
a chip row, an ops row, an instrument with its own columns and note, and the AI
band underneath.

| File | Artboard | Route | Architecture |
| --- | --- | --- | --- |
| `PipelineZone.jsx` | ID1 · Deals · Pipeline | `/deals/pipeline` | WORK BOARD |

## The rule for adding to this folder

One file per artboard, named `<Zone>Zone.jsx`, and register it in `ZONES` in
`frontend/src/workspaces/investor/InvestorDealsRoutes.jsx`. A slug that is not
in that registry falls through to `pages/investor/InvestorDealsWorkspace.jsx`,
which is what shipped before the artboards and still serves the bucket root at
`/deals` where all four sections stack.

**The chip and ops rows are declared, not written here.**
`workspaces/investorZoneFilters.js` and `workspaces/investorZoneActions.js`
carry them, and a label with no store behind it is marked `unbuilt` with its
reason — the builder drops the control rather than drawing one that does
nothing. Add the label there, not to the page.

**Absent is stated, never defaulted.** A figure the record does not carry
renders `Not recorded` in the cell that would have held it, and a tile the
PRODUCT has no store for is not drawn at all — its absence goes in the
`StatedLimit` block at the foot of the zone (D56/D68).
