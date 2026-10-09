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

## Rules

- **The components read nothing themselves.** A cycle is wired by handing its
  read in. Its API module under `lib/api/` arrives with the first cycle whose read is on
  `main`, because the drift test refuses a client method with no route.
- **Nothing here is mounted until that cycle's read lands.** Until then the
  cycle keeps its current page, and its old module URLs are not redirected.
- **The overview draws no module list, no status pill and no Pro strip.** The
  cards are the modules.
- **A card fails alone.** An `unreadable` card names its source and offers its
  own retry; the others stay drawn. A missing value is "Not recorded", never 0,
  and a line needs three real points.
- `frontend/test/cycle_pages_d661.test.mjs` holds these rules, against the
  fixtures in `frontend/test/_cycle_fixtures.mjs`.
