# pages/cycles — the four cycle overviews and their module pages (D661)

One overview and one module page draw all four founder cycles (Validate,
Build, Raise, Grow) and their 27 modules from #1469's shared read (D656):
`GET /api/cycles/:cycle/overview` and `GET /api/cycles/:cycle/modules/:slug`.
The canvases are `design/canvases/integrated/Cycle Overview.dc.html` and its two boards.

| File | What it holds |
| --- | --- |
| `cyclePaths.js` | D694's pure predicate for cycle roots, modules, actions, new pages and records; App gives each one the cycle's own inset |
| `recordModel.js` | D696 PR 1's pure record rules: safe record links, Worker id checks, row/tone mapping, section anchors, declared-action dispatch and the client export registry. PR 2 maps the merged Worker forms and confirmations, filters unsaveable forms, and builds JSON or multipart action bodies. |
| `RecordView.jsx` | D696's record body: pills/actions, four facts, main/side sections and real activity. Exports `RecordActions`, `RecordFacts`, `RecordSection` and `RecordActivity`; the caller supplies cycle/module names and callbacks, and owns reads and every dialog. |
| `ParamRedirect.jsx` | D696 decision 13: `ParamRedirect({ to })`, which redirects an old or canvas-slug record address to the app's, filling `:name` params through `encodeURIComponent` and keeping the query and the hash. `App.jsx` re-exports it beside `HistoryRedirect`. |
| `verdictForm.js` | D693: Record a decision (CO:335) in D695's field format: Decision (Proceed, Pivot, Stop; Proceed first), For and Evidence it rests on from Verdict's `form-options`, Reasoning, and If Pivot only while Pivot is chosen. No evidence starts checked, its note counts the checks, `fromQuery` presets For from `?for=h-<id>`, and it submits through `verdictApi.record`, with no Edit. Joins `forms.js` with the Verdict module (#1704's closing PR). Since D757 (#1928) `withSuggestedEvidence` checks the interview evidence the Worker names in `evidence.suggested_evidence`; the founder may untick it |
| `validateRedirects.js` | D704 decision 1: `validateZoneTarget(zone, search, hash)`, where the three retired Validate pages land (`interviews` → Customer research, `pain-map` → Problem discovery, `hypotheses` → Experiments and evidence), the query and the hash kept, and the Interviews page's `?new=` turned into `/validate/record` or `?log=`. Pure; `ValidateZoneRedirect.jsx` renders it, and #1666's PR 2b and closing PR mount that on the three addresses |
| `ValidateZoneRedirect.jsx` | D704 (#1666): `ValidateZoneRedirect({ zone })`, a `<Navigate replace>` to `validateZoneTarget(zone, search, hash)`. `App.jsx` re-exports it beside `HistoryRedirect`; it lives here so a test can mount it. Mounted on no route until #1666's PR 2b |
| `cycleModel.js` | The pure rules: the four cycles, the five card states, which chart specs can be drawn, figure values and changes, the module query, the records count and pages, cells, and the in-app link check |
| `CycleCharts.jsx` | One SVG component per chart kind in the canvas (`hbar`, `vbars`, `vstack`, `funnel`, `stack`, `line`, `timeline`, `tiles`, `dots`, `rows`, `progress`, `big`, `heat`, `bands`), the legend and the sparkline. No chart library, and no HTML strings |
| `CycleOverview.jsx` | The overview: the header with its tabs and primary action, four figures, and one card per module in its five states |
| `CycleModulePage.jsx` | A module page: the chart at full size, the records as a working table (search, filters, sort, pages, Add), quiet text links to the module's tools where it has them, then its further parts |
| `CycleRoute.jsx` | The route component: picks the project (`?project_id=`, or the read's own `?project=`, else the founder's first) and hands it to every tab and card link, reads the cycle through `frontend/src/lib/api/cycles.js`, adapts it, and draws the overview (`/validate`, `/build`, `/raise`, `/grow`) a module page (`/<cycle>/:slug`) or one record (`/<cycle>/:slug/:id`, D696) beside the Eadwyn AI rail. It wraps the frame in `RailCrumbsProvider` (`../../ui/railCrumbs.js`, D698) with the cycle's name and, on a module route, the module's, so the rail reads "Validate › Customer research"; a record view adds its title with `useSetRailCrumbs`. It names each module's working tool and Add, the AI bands each module carries, and Grow's Share an update lightbox (`ShareUpdateLightbox`, D686 §5.8, #1599) D686 (#1596): with `lightbox`, it is the cycle's action route (`/validate/record`, `/build/connect`, `/raise/call`, `/grow/update`); each `CYCLE_DEFS` entry names its `path` and the `Mount` that renders the open lightbox, `openAction` pushes the route with `state.under`, `closeAction` goes back, and finishing replaces it. `cycleModel.js`'s Build, Raise and Grow histories are each cycle's second tab, drawn once `live`; Validate uses Customer research's table (D694). |
| `forms.js` | The Add and Edit forms for the stores with no page of their own (every Grow store: feedback, channels, KPIs, roles, partners, markets and obligations; every Raise store: readiness scores, narrative versions, deck links, data-room files, cap-table holders, the use-of-funds split and prospects; every Build store: features, must-haves, roadmap items, founders, filings and core systems; every Validate store: themes, segments, competitors, signals and hypotheses; the canvas's forms since D695 #1656 and #1657): each form's `key` (unique in its module, for `/new?form=`), its `cta`, its fields (today's types or the canvas's T, CH and CK kinds, which `initialValues` and `validate` both read, D695), the body its Worker route takes, and its writes. An Edit form also reads a row's store id (`idOf`) and current values (`valuesOf`), and saves with "Save". Pure, so the contract test sends each body through the real route |
| `FormLightbox.jsx` | The one dialog that draws every Add and Edit form (D695): the eyebrow "<Cycle> · <Module>", the fields in the T, CH and CK kinds (an Edit form's from the row), the form's own checks, then the Worker's sentence on the field it names when it refuses. Below 1024px it is a page (`frontend/src/ui/Lightbox.jsx`'s `pageBelow`), which `CycleRoute` draws as the body's content |
| `ValidateSections.jsx` | D697 (#1659): Validate's three bottom sections, mounted as its `parts` under Customer research's, Problem discovery's and Experiments and evidence's tables: what FVW's Interviews, Pain map and Hypotheses pages drew (the strips, Log an interview and Export interviews with the `?log=notes|upload` opener, More tools, the unthemed quotes with Assign, Export map and the Problem slide link, the fit line, Distance to the bar, the history notes, Link to a pain and New hypothesis). They read nothing: counts are the module read's `parts`, writes are `CycleRoute`'s callbacks, and every dialog goes through the parts context's `openDialog`, which `CycleRoute` draws after the size container. Write tools are drawn only with `parts.can_write`. D757 (#1928) adds `FromYourInterviews`, mounted by `CycleRoute` on every Validate module but Verdict: the module read's `parts.suggestions` (writers only), each with Accept, Edit and Discard, "Heard in <name> · 00:12:31 · <speaker>" linking the transcript line, and Accept all |
| `DurabilityChecklist.jsx` | Durable company-building's further part: the durability checklist from Grow's module read, each item done by a Spin-Out Lab milestone or by hand, with a tick for an open item and an undo for the founder's own tick |
| `founderToolNavigation.js` | The shared module/tool map for quiet tool doors and editor return links; preserves the selected project, route roles and Liquidity's Studio navigation gate (#1539) |
| `validatePhone.js` | The phone root's model (D703, #1665; begun as D685 §5.12's Validate focus, #1589): for each cycle, the Worker's `focus`, `meter` and `index` (#1701) as sent, the cycle as each function's last argument. Where one is null (unreadable) it falls back to the raw overview's figures and cards (raw because adapting a card replaces its series); an `index` that is not an array reads as none sent. `targetValue` is "Set a target"'s value for `PUT /cycles/validate/interviews-target`. D757 (#1928): the "From your interviews" rules (`suggestionsView`, `heardLine`, `suggestionLine` with `findingLine` mirroring the Worker's, `acceptAllBatches`, `acceptSuggestions`) and `verdictInterviewLine`, the Verdict card's line for writers on both widths |
| `PhoneCycleRoot.jsx` | D703 (#1665): a cycle's phone root, One Next Thing, for all four cycles: the eyebrow with the page's Eadwyn button, the headline, the why, the meter, a 52px CTA, "Then" once, "Everything else in <Cycle>" and "Also in <Cycle>". It draws the Worker's `focus`, `meter` and `index` through `validatePhone.js`, which takes the cycle as each function's last argument. `CycleRoute.jsx` draws it below 1024px on a cycle's root, in place of the overview and `AlsoIn` (#1665's PR 1b); the desktop page draws neither |
| `PhoneModulePage.jsx` | D703 (#1665): a module as a pushed page on a phone, with `CycleModulePage`'s props: `CycleBar` (the exported wrapper of `PhoneBar`, lifted out of the body's gutter), "One next thing" with the module's Add as its CTA, the chart at a glance, the table's controls, one `PhoneRows` group of records (a row opens its record exactly when `rowLinks` says so), paging, the tool links as handed and `children`. Also exports `PHONE_GUTTER`, the body's gutter below `lg`, for an action page. `CycleRoute.jsx` renders it below 1024px on a module route, in place of `CycleModulePage` (#1665's PR 2c) |
| `RecordView.jsx` (phone) | D703: under `RecordPhoneProvider`, which `CycleRoute` sets from `usePhoneWidth()` in record mode (#1665's PR 3a), `RecordView` and its exported parts draw CO:270-273's groups: Next for this record (run through the declared action), the pills, At a glance, each section with its anchor and its action as the last row, Activity with Show all, and Actions with a danger action in red |
| `CallsHistory.jsx` | Raise's Calls history (D686 §5.6, #1598), Capital relationships' `#calls` section from the module read's `parts.calls`: Coming soon while round calls are off, Unreadable on a failed read |
| `ToolsHistory.jsx` | Build's Tools history (D686 §5.4), Operating systems' `#tools` section from the module read's `parts.tools`; above the table, GitHub as the Code system (`parts.tools.code`), and below it each sync as a line (`parts.tools.syncs`, D782) |
| `codeSystem.js` | D782: the Code system's and the sync lines' words, pure: repository names or a count when they are not the viewer's, each fed module with its count and a local link, and one sync line's state and text |
| `SolutionDesignFromCode.jsx` | D782 (#2114): Solution design's `#from-github` part from the module read's `parts.from_code`: Built with (each repository's languages and topics), the proposals GitHub made with Accept and Dismiss (`cyclesWrite.build.acceptDesignProposal`, `dismissDesignProposal`), and the accepted architecture notes. Repository text is drawn as text; nothing is drawn when GitHub brought nothing |
| `designFromCode.js` | D782 (#2114): that part's words, pure: languages with their share, a link only when it is GitHub's own https page, and the part's cleaned lists |
| `FoundingTeamFromCode.jsx` | D782 (#2115): Founding team's `#from-github` part from the module read's `parts.github`: each matched founder's "Builds: N commits in the last 90 days" per repository with Unmatch, and Not yet matched with the founder's own control (`cyclesWrite.build.matchGithubLogin`, `unmatchGithubLogin`). A login is never matched by name or email |
| `CompanyFromCode.jsx` | D782 (#2115): Company creation's `#from-github` part: where each repository's code sits and its licence as a fact, the proposed IP step with Accept and Dismiss (`acceptCompanyProposal`, `dismissCompanyProposal`), and the evidence on the IP assignment step |
| `teamFromCode.js` | D782 (#2115): those two parts' words, pure: the Builds line, the owner and licence facts, the members-only count, and the parts' cleaned lists |
| `RoadmapFromGithub.jsx` | D782 (#2111): Product roadmap's `#from-github` part from the module read's `parts.github`: each GitHub milestone as a group with its target and items, each item's Shipped mark linking to its release, and the Releases strip |
| `roadmapGithub.js` | D782 (#2111): that part's words, pure: a group's target and count, an item's Shipped mark, one release's title, date and what it shipped, the strip's count, and a link out only to a release's page on github.com |
| `MvpFromGithub.jsx` | D782 (#2112): Prototype / MVP's `#from-github` part from the module read's `parts.github`: each must-have from a pull request with GitHub's state and its link, and each release's checks, in then not in |
| `mvpGithub.js` | D782 (#2112): that part's words, pure: a must-have's state, tone and Dropped note, a release's title, date, in and not in, the list's count, and a link out only to a pull request or release page on github.com |
| `UpdateAskReplies.jsx` | "From update asks" on Distribution (a Lead) and Partner network (a Partner), D686 §5.8 (#1599): the replies a shared update's customer and partner asks brought in, from the module read's `parts.from_update_asks`; nothing is drawn while there is none |
| `ReportingDesk.jsx` | D1056 (#2427): Grow's Reporting desk at `/grow/reporting` and Duties at `/grow/reporting/duties`, drawn by `CycleRoute`'s `reporting` prop under Grow's tab row with Reporting lit. The History is `UpdatesHistory` on the Durable company-building read; Due next, Needs you, the calendar and Duties say "Not read here yet" with the part each waits for |
| `reportingModel.js` | D1056: the pure rules of the desk and the investor's company page: the addresses and tabs, the search a tab keeps, the waiting blocks' words, the company uid check, the holding line (no zero for a missing amount) and one company's reports, newest first |
| `UpdatesHistory.jsx` | Grow's Updates history (D686 §5.8, #1599), Durable company building's `#updates` section above the checklist from `parts.updates`: a row links only with the Worker's `href`, an amber Ask again pill, legacy rows unlinked with their label, Unreadable when the read failed, "No update shared yet" with Share an update |
| `modules.js` | Each wired cycle's modules in tab order, as its Worker read lists them; the module page's tabs come from here |
| `adapters/` | One door from a cycle's read to the page's shape. `index.js` passes a read already in D661's shape through untouched; `validate.js` maps Validate's read (#1487) and `grow.js` Grow's (#1488), one function per module slug, the canvas's chart for each card, and its records' columns |

## Rules

On a module page, `?add=1` is its first Add's address: the URL becomes `/<cycle>/<slug>/new`, the rest of the query kept. Modules without a form and cycle overviews ignore it (D688, D695).

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
  `/raise/data-room` answers by mode (D696): with no mode it is the Data room
  module page, `?mode=access` the read-only access view (its tool link) and
  `?mode=workspace` the files tool (a #1539 door in `founderToolNavigation.js`,
  so no file here spells that mode).
- **The page adapts; the Worker is not changed** (S1 on #1474). A read in
  D661's shape passes through. Validate's merged with its own, so
  `adapters/validate.js` maps it, and `cloudflare-worker/test/cycle_adapters_d661.test.ts`
  runs the Worker's real output through it: every `ok` card must draw, and
  every column must have a value source.
- **A module's working tool stays where it is.** D695 supplies the Add/Edit forms and D696 the record pages. A module page links
  to the tool that edits it where it has one (`/build/competitors` for Market
  intelligence). Validate's zone pages are gone (D704): its curation is its
  module pages and records, and the three old addresses redirect there. Add is drawn only where it opens a form.
  Every Add has an address (D695): `App.jsx` routes `/<cycle>/:slug/new` to
  `CycleRoute` with `adding`, and `/validate/customer-research/new` redirects
  to Record a session, the query kept. `RecordsTable`'s Add link passes its
  entry's `state`, for `state.under`. `CycleRoute` opens the form named by
  `?form=` (else the first) as a dialog over the module page, or as the page
  itself below 1024px; an Edit is the same URL with `state.editing`.
- **The overview draws no module list, no status pill and no Pro strip.** The
  cards are the modules.
- **A card fails alone.** An `unreadable` card names its source and offers its
  own retry; the others stay drawn. A missing value is "Not recorded", never 0,
  and a line needs three real points.
- `frontend/test/cycle_pages_d661.test.mjs` holds these rules, against the
  fixtures in `frontend/test/_cycle_fixtures.mjs`.

D697 (#1659): a cycle's def may name a `recordPage` per module, drawn in record mode in place of `RecordView` with the record read and a context (`projectId`, `id`, `activity`, the record handlers, `act` for `recordAction`, `reload` and `openDialog`). Validate's is Customer research's interview record, `../founder/InterviewReviewPage.jsx`, built from `RecordView`'s exported parts.

D696 PR 2 mounts record mode on all four cycles. It calls only the record read,
keeps every request scoped to the URL’s venture, and refuses malformed ids
before a read. A 403/404 prints the Worker’s sentence; other failures offer Retry.
Forms use `state.editing`; confirms and desktop forms sit after the cycle size
container, while a phone form is the body’s only child. Edits use the registered
store PATCH; other declared actions use `recordAction`. A signed file opens
only through `/api/files/dl/` without rereading; successful mutations reread,
and a deleted record returns to its module. Activity pages append on Show all.
Rows link only with `records.linkable` and a genuine Worker id. Build and Raise
pass their ids through, and Grow and Validate set `recordId` to the Worker's id
or null (D696 decision 7). In record mode the rail's crumbs carry the record's
title (`RecordCrumb`, D696).
