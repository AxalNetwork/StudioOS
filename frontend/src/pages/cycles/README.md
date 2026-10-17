# pages/cycles — the four cycle overviews and their module pages (D661)

One overview and one module page draw all four founder cycles (Validate,
Build, Raise, Grow) and their 26 modules from #1469's shared read (D656):
`GET /api/cycles/:cycle/overview` and `GET /api/cycles/:cycle/modules/:slug`.
The canvases are `design/canvases/integrated/Cycle Overview.dc.html` and its two boards.

| File | What it holds |
| --- | --- |
| `cyclePaths.js` | D694's pure predicate for cycle roots, modules, actions, new pages and records; App gives each one the cycle's own inset |
| `recordModel.js` | D696 PR 1's pure record rules: safe record links, Worker id checks, row/tone mapping, section anchors, declared-action dispatch and the client export registry. Routing and reads wait for PR 2 dependencies. |
| `RecordView.jsx` | D696's unmounted record body: pills/actions, four facts, main/side sections and real activity. Exports `RecordActions`, `RecordFacts`, `RecordSection` and `RecordActivity`; the caller supplies cycle/module names and callbacks, and owns reads and every dialog. |
| `ParamRedirect.jsx` | D696 decision 13: `ParamRedirect({ to })`, which redirects an old or canvas-slug record address to the app's, filling `:name` params through `encodeURIComponent` and keeping the query and the hash. `App.jsx` re-exports it beside `HistoryRedirect`. |
| `cycleModel.js` | The pure rules: the four cycles, the five card states, which chart specs can be drawn, figure values and changes, the module query, the records count and pages, cells, and the in-app link check |
| `CycleCharts.jsx` | One SVG component per chart kind in the canvas (`hbar`, `vbars`, `vstack`, `funnel`, `stack`, `line`, `timeline`, `tiles`, `dots`, `rows`, `progress`, `big`, `heat`, `bands`), the legend and the sparkline. No chart library, and no HTML strings |
| `CycleOverview.jsx` | The overview: the header with its tabs and primary action, four figures, and one card per module in its five states |
| `CycleModulePage.jsx` | A module page: the chart at full size, the records as a working table (search, filters, sort, pages, Add), quiet text links to the module's tools where it has them, then its further parts |
| `CycleRoute.jsx` | The route component: picks the project (`?project_id=`, or the read's own `?project=`, else the founder's first) and hands it to every tab and card link, reads the cycle through `frontend/src/lib/api/cycles.js`, adapts it, and draws the overview (`/validate`, `/build`, `/raise`, `/grow`) or a module page (`/<cycle>/:slug`) beside the Eadwyn AI rail. It wraps the frame in `RailCrumbsProvider` (`../../ui/railCrumbs.js`, D698) with the cycle's name and, on a module route, the module's, so the rail reads "Validate › Customer research"; a record view adds its title with `useSetRailCrumbs`. It names each module's working tool and Add, the AI bands each module carries, and Grow's Share an update lightbox (`ShareUpdateLightbox`, D686 §5.8, #1599) D686 (#1596): with `lightbox`, it is the cycle's action route (`/validate/record`, `/build/connect`, `/raise/call`, `/grow/update`); each `CYCLE_DEFS` entry names its `path` and the `Mount` that renders the open lightbox, `openAction` pushes the route with `state.under`, `closeAction` goes back, and finishing replaces it. `cycleModel.js`'s Build, Raise and Grow histories are each cycle's second tab, drawn once `live`; Validate uses Customer research's table (D694). |
| `forms.js` | The Add and Edit forms for the stores with no page of their own (Grow's feedback, channels, partners, markets and obligations; Build's risks, formation steps and MVP must-haves): each form's fields, the body its Worker route takes, and its writes. An Edit form also reads a row's store id (`idOf`) and current values (`valuesOf`). Pure, so the contract test sends each body through the real route |
| `RecordFormSheet.jsx` | The one side sheet that draws every Add and Edit form: the fields (an Edit form's from the row), the form's own checks, then the Worker's sentence on the field it names when it refuses |
| `DurabilityChecklist.jsx` | Durable company-building's further part: the durability checklist from Grow's module read, each item done by a Spin-Out Lab milestone or by hand, with a tick for an open item and an undo for the founder's own tick |
| `founderToolNavigation.js` | The shared module/tool map for quiet tool doors and editor return links; preserves the selected project, route roles and Liquidity's Studio navigation gate (#1539) |
| `validatePhone.js`, `ValidatePhoneFocus.jsx` | Validate's phone focus below md (D685 §5.12, #1589): the focus card, the interviews meter and the six "Everything else in Validate" rows (D694). The Worker's `focus`, `meter` and `index` (#1609) come first; where one is null (unreadable) it falls back to the raw overview's figures and cards (raw because adapting a card replaces its series). "Set a target" writes `PUT /cycles/validate/interviews-target` and re-reads the overview. `CycleRoute.jsx` mounts it above the overview |
| `CallsHistory.jsx` | Raise's Calls history (D686 §5.6, #1598), Capital relationships' `#calls` section from the module read's `parts.calls`: Coming soon while round calls are off, Unreadable on a failed read |
| `ToolsHistory.jsx` | Build's Tools history (D686 §5.4), Operating systems' `#tools` section from the module read's `parts.tools` |
| `UpdateAskReplies.jsx` | "From update asks" on Distribution (a Lead) and Partner network (a Partner), D686 §5.8 (#1599): the replies a shared update's customer and partner asks brought in, from the module read's `parts.from_update_asks`; nothing is drawn while there is none |
| `UpdatesHistory.jsx` | Grow's Updates history (D686 §5.8, #1599), Durable company building's `#updates` section above the checklist from `parts.updates`: a row links only with the Worker's `href`, an amber Ask again pill, legacy rows unlinked with their label, Unreadable when the read failed, "No update shared yet" with Share an update |
| `modules.js` | Each wired cycle's modules in tab order, as its Worker read lists them; the module page's tabs come from here |
| `adapters/` | One door from a cycle's read to the page's shape. `index.js` passes a read already in D661's shape through untouched; `validate.js` maps Validate's read (#1487) and `grow.js` Grow's (#1488), one function per module slug, the canvas's chart for each card, and its records' columns |

## Rules

On a module page, `?add=1` opens its first Add form. Closing or saving the form removes the parameter with a replace. Modules without a form and cycle overviews ignore it (D688).

- **The components read nothing themselves.** `CycleRoute.jsx` is the one
  file that reads: it calls `frontend/src/lib/api/cycles.js`, whose table gains a cycle in
  the PR that wires it, because the drift test refuses a client method with
  no route.
- **A cycle is mounted only once its read is wired.** All four are (D661,
  #1474). Raise's and Build's reads are already in D661's shape and pass
  through with no adapter; Validate's and Grow's have one each.
- **Build's overview keeps the one way to create a startup.** `/build?new=1`
  opens `CreateStartupForm` on it, and every cycle with no venture yet
  offers "Create your startup".
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
