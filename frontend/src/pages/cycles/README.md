# pages/cycles — the four cycle overviews and their module pages (D661)

One overview and one module page draw all four founder cycles (Validate,
Build, Raise, Grow) and their 26 modules from #1469's shared read (D656):
`GET /api/cycles/:cycle/overview` and `GET /api/cycles/:cycle/modules/:slug`.
The canvases are `design/incoming/Cycle Overview.dc.html` and its two boards.

| File | What it holds |
| --- | --- |
| `cycleModel.js` | The pure rules: the four cycles, the five card states, which chart specs can be drawn, figure values and changes, the module query, the records count and pages, cells, and the in-app link check |
| `CycleCharts.jsx` | One SVG component per chart kind in the canvas (`hbar`, `vbars`, `vstack`, `funnel`, `stack`, `line`, `timeline`, `tiles`, `dots`, `rows`, `progress`, `big`, `heat`, `bands`), the legend and the sparkline. No chart library, and no HTML strings |
| `CycleOverview.jsx` | The overview: the header with its tabs and primary action, four figures, and one card per module in its five states |
| `CycleModulePage.jsx` | A module page: the chart at full size, the records as a working table (search, filters, sort, pages, Add), a link to the module's own tool where it has one, then its further parts |
| `CycleRoute.jsx` | The route component: picks the project (`?project_id=`, or the read's own `?project=`, else the founder's first) and hands it to every tab and card link, reads the cycle through `frontend/src/lib/api/cycles.js`, adapts it, and draws the overview (`/validate`, `/raise`, `/grow`) or a module page (`/<cycle>/:slug`) beside the Worker AI rail. It names each module's working tool and Add, the AI bands each module carries, and Grow's Share an update sheet |
| `DurabilityChecklist.jsx` | Durable company-building's further part: the durability checklist from Grow's module read, each item done by a Spin-Out Lab milestone or by hand, read-only |
| `modules.js` | Each wired cycle's modules in tab order, as its Worker read lists them; the module page's tabs come from here |
| `adapters/` | One door from a cycle's read to the page's shape. `index.js` passes a read already in D661's shape through untouched; `validate.js` maps Validate's read (#1487) and `grow.js` Grow's (#1488), one function per module slug, the canvas's chart for each card, and its records' columns |

## Rules

- **The components read nothing themselves.** `CycleRoute.jsx` is the one
  file that reads: it calls `frontend/src/lib/api/cycles.js`, whose table gains a cycle in
  the PR that wires it, because the drift test refuses a client method with
  no route.
- **A cycle is mounted only once its read is wired.** Validate, Raise and
  Grow are (D661, #1474). Build keeps its current page until its read is.
  Raise's read is already in D661's shape and passes through with no adapter.
  `/raise/data-room` is the data room tool's own route, so the Data room tab
  opens the tool itself.
- **The page adapts; the Worker is not changed** (S1 on #1474). A read in
  D661's shape passes through. Validate's merged with its own, so
  `adapters/validate.js` maps it, and `cloudflare-worker/test/cycle_adapters_d661.test.ts`
  runs the Worker's real output through it: every `ok` card must draw, and
  every column must have a value source.
- **A module's working tool stays where it is.** No canvas yet draws Add
  forms, a record's edit view, or Validate's curation, so a module page links
  to the zone page that edits it (`/validate/interviews`, `/pain-map`,
  `/hypotheses`, `/build/competitors`). Add is drawn only where it opens a form.
- **The overview draws no module list, no status pill and no Pro strip.** The
  cards are the modules.
- **A card fails alone.** An `unreadable` card names its source and offers its
  own retry; the others stay drawn. A missing value is "Not recorded", never 0,
  and a line needs three real points.
- `frontend/test/cycle_pages_d661.test.mjs` holds these rules, against the
  fixtures in `frontend/test/_cycle_fixtures.mjs`.
