# Shell migration — Founder, Investor/LP, Advisor, Partner

Canonical plan for integrating the four workspace **page canvases** into the
live app. **`CLAUDE.md` outranks this file on production facts**; this file
outranks ad-hoc comments in components when they disagree about IA.

## Integration model (read this first)

The design canvases draw a three-pane frame: **`.side` license nav · main · AI
rail**. In production that splits cleanly:

| Canvas piece | Production owner | Rule |
| --- | --- | --- |
| `.side` (9-row licence nav) | **`SidebarNav` in `App.jsx`** | **Never re-import.** The current sidebar stays. Pages must not render a second vertical nav listing Deals / Portfolio / Validate / Build / … |
| Main (workspace overview + zone body) | **Page components** under `pages/founder/`, `pages/investor/`, zone routes in `App.jsx` | Ship canvas **content** only: headings, stats, tables, proposal bands, seam chips. Horizontal **zone pills** (`ZoneNav` or desk anchor rows) replace in-page `#anchors`, not the app sidebar. |
| `.rail` (Worker AI) | **`ui/WorkerRail.jsx`** | One shared rail per licence accent (violet founder, indigo investor). Passed as a sibling column (`main + rail`), never bundled with a canvas sidebar. |

`FounderWorkspaceTabs` / `WorkspaceTabs` on **legacy** routes are horizontal
sub-nav inside a bucket — not a replacement for `SidebarNav` and not the
canvas `.side` column.

**Status gate:** a shell joins `MIGRATED` in
`frontend/test/workspace_shell_routes.test.mjs` only when every zone route in
`shellConfig.js` is registered in `App.jsx` and sidebar rows point at workspace
**roots** (not first zones). **`sidebarConfig.js` row labels are not removed or
collapsed by this migration** unless product explicitly requests it.

| Shell | `MIGRATED` | Canvas source |
| --- | --- | --- |
| Founder | yes (2026-09-02) | `Founder Workspaces Canvas.dc.html` + `Pages · Founder *` |
| Investor / LP | yes (2026-09-02) | `Investor LP Canvas.dc.html` + `Pages · Investor *` |
| Advisor | no | `Advisor Canvas.dc.html` + `Pages · Advisor *` |
| Partner | no | `Partner Operator Canvas.dc.html` + `Pages · Partner *` |

---

## Shared rules (all four licences)

1. **Sidebar row → workspace root.** A row aimed one level down skips the
   overview and is how the founder overviews were lost the first time. Each
   bucket root renders its compressed canvas; `ZoneNav` below it opens zones.
2. **Zone pills are real routes.** No `href="#…"` anchors. Targets are composed
   only from `shellConfig.js` via `zonePath()`.
3. **Worker AI rail is one component.** `ui/WorkerRail.jsx` (indigo accent for
   investor, violet for founder). No per-page hand-built `<aside>` rails. Spend
   meter is live (`GET /api/ai/me/spend`); model picker and per-run cost stay
   absent until an investor surface registers in `ASSIST_SURFACES`.
4. **Seam hue is cyan (`#0e7490`), never a product accent.** Founder-sourced
   objects carry seam chips; product chrome uses each licence's accent from
   `ACCENT` in `shellConfig.js`.
5. **Full-bleed lists are single sources of truth.** `FOUNDER_FULL_BLEED` and
   `INVESTOR_FULL_BLEED` in `sidebarConfig.js` — not duplicated hand-typed
   expressions in `App.jsx`.
6. **Spin-Out Lab and Axal VC Fund are link rows, never re-bucketed.** Their
   routes stay in the Lab tree (`/spinout-lab/*`, `/spinout-lab/investor-workspace`).
7. **Trust and Company Settings are not duplicate sidebar rows** where the
   product decision pins them to the user menu or sidebar footer.

Guard tests: `founder_shell.test.mjs`, `founder_shell_canvas.test.mjs`,
`investor_shell.test.mjs`, `investor_shell_canvas.test.mjs`,
`workspace_shell_routes.test.mjs`.

---

## Founder shell migration

### Canvas map (A2–A7 · Pages · Founder *)

| Row | Tagline | Zones (archetype · route) |
| --- | --- | --- |
| A2 Validate | Prove someone wants this | Interviews (COLLECTION) · Pain map (ANALYTICS) · Hypotheses (WORK BOARD) · Verdict (LEDGER) → `/validate/*` |
| A3 Build | Operate the company this week | This week · Board · Roadmap (WORK BOARD) · Cadence (FEED) · KPI entry (LEDGER) → `/build/*` |
| A4 Raise | Get capital, stay legal | Status (ANALYTICS) · Pitch · Legal · Data room (COLLECTION) · Capital · Liquidity (LEDGER) → `/raise/*` |
| A5 Grow | Get customers, people, reach | Focus (ANALYTICS) · Talent · Capital match (MATCH ENGINE) · Customers · Partnerships (WORK BOARD) · Brand (COLLECTION) · Launch (FEED) → `/grow/*` |
| A6 Network | Work my relationships | Relationships (MATCH ENGINE) · Introductions (FEED) · Organizations (COLLECTION) → `/network/*` |
| A7 Research | Go deep on a market or company | Ask (FEED) · Markets (ANALYTICS) · Companies · Library (COLLECTION) · Funds (MATCH ENGINE) → `/research/*` |

Overviews: `FounderValidatePage`, `FounderBuildDesk`, `FounderRaiseDesk`,
`FounderGrowDesk`, `FounderNetworkDesk`, `FounderResearchDesk` — each
**main + `WorkerRail`**, no canvas `.side`.

Legacy desks remain reachable (`/execution`, `/build/discovery`, `/signals`, …)
via sidebar `match` arrays and `FounderWorkspaceTabs` on wrapped legacy routes.

### Shipped (2026-09-02)

- Six workspace overviews reachable from sidebar roots.
- `ZoneNav` on every bucket; pills navigate.
- `WorkerRail` on every founder workspace surface in `FOUNDER_FULL_BLEED`.
- `embedded` prop prevents double chrome on zone routes wrapped by
  `WorkspaceShell`.

### Still open (from canvas A1 / Founder Workspaces)

- Mode toggle, model card, 44px collapsed rail spine.
- Proposal anatomy: cost before run, receipt after, accept/edit/discard,
  amber overwrite confirm, provenance mark on accepted output.
- Per-workspace `ASSIST_SURFACES` registration so the rail can name a model
  honestly.

---

## Investor / LP shell migration

### System chrome — I1 (`Investor LP Canvas.dc.html`)

| Element | Spec | Shipped |
| --- | --- | --- |
| Licence accent | Indigo `#4f46e5`, not founder violet | yes — `ACCENT.investor`, `WorkerRail role="investor"` |
| Seam | Cyan chips on founder-sourced objects | yes — `--inv-seam`, seam badges on workspace headers |
| Transaction seam | Seven cross-boundary objects; three seam chip kinds | partial — copy on overviews; not all objects wired |
| Institutional Fund row | Locked, never hidden; upgrade surface on select | yes — `requiredInvestorTier: 'institutional'`, `LockedFundNotice`, inert preview on landing |
| Worker AI rail | Same rail on every page; dark tokens specified once in I1 | yes — shared `WorkerRail`; dark via `workerRail.css` + page `.dark` blocks |
| Proposal band | Accept / Edit first / Discard; cost before, receipt after | partial — UI pattern on canvases; not all zones generate proposals |
| Model picker / per-run cost | Named per page in detail canvases | **not shipped** — no investor `ASSIST_SURFACES` keys |

### Sidebar rows (nine live + pinned footer)

| ID | Label | Root | Notes |
| --- | --- | --- | --- |
| — | Studio | `/studio` | Persona hub |
| — | Spin-Out Lab | `/spinout-lab` | Untouched by migration |
| I3 | Deals | `/deals` | Tagline: *Find and close investments* |
| I4 | Portfolio | `/portfolio` | Tagline: *Know how my investments are doing* |
| I5 | Axal VC Fund | `/spinout-lab/investor-workspace` | LP commitment surface; not the GP add-on |
| I6 | Fund | `/funds` | Institutional tier; tagline: *Run my fund* |
| I7 | Network | `/network` | Tagline: *Work my relationships* |
| I8 | Research | `/research` | Tagline: *Go deep before money moves* |
| — | Trust | `/trust` | Canvas row; live nav includes it |
| — | Company Settings | `/company-settings` | **Pinned footer only** — not duplicated as a row |

### Zone inventory (Pages · Investor * detail canvases)

#### I3 · Deals — `/deals`

| Zone | Archetype | Route | Legacy alias |
| --- | --- | --- | --- |
| Pipeline | WORK BOARD | `/deals/pipeline` | `/pipeline` |
| Screening | ANALYTICS | `/deals/screening` | `/pipeline/screening` |
| Commit | LEDGER | `/deals/commit` | `/pipeline/commit` |
| Closing | COLLECTION | `/deals/closing` | `/pipeline/transactions` |

Overview: `InvestorDealsWorkspace.jsx`. Zones: `InvestorDealsRoutes.jsx` +
live pipeline pages. Guard: `investor_workspaces.test.mjs` (I3).

#### I4 · Portfolio — `/portfolio`

| Zone | Archetype | Route |
| --- | --- | --- |
| Positions | LEDGER | `/portfolio/positions` |
| Updates | FEED | `/portfolio/updates` |
| Value-add | FEED | `/portfolio/value-add` (legacy `/portfolio/growth`) |

Overview: `InvestorPortfolioCanvas.jsx`. Guard: `investor_portfolio_i4.test.mjs`.

Open vocabulary: Positions vs Health vs Cap Table naming across routes.

#### I6 · Fund — `/funds` (Institutional)

| Zone | Archetype | Route | Legacy handoff |
| --- | --- | --- | --- |
| LPs | COLLECTION | `/funds/lps` | — |
| Calls | LEDGER | `/funds/calls` | `/funds/capital-calls` |
| Accounting | LEDGER | `/funds/ledger` | `/funds/accounting` (ops tool) |
| Reporting | COLLECTION | `/funds/reporting` | `/lp-reports` |

Overview: `InvestorFundLanding.jsx` with locked state for non-institutional
tiers. Guard: `investor_fund_i6.test.mjs`.

#### I7 · Network — `/network`

| Zone | Archetype | Route |
| --- | --- | --- |
| Relationships | MATCH ENGINE | `/network/relationships` |
| Introductions | FEED | `/network/introductions` |
| Organizations | COLLECTION | `/network/organizations` |

Overview: `InvestorNetworkWorkspace.jsx` (`embedded` on zone routes via
`NetworkWorkspace.jsx`). Shared `NETWORK_ZONES` with founder/advisor/partner.

#### I8 · Research — `/research`

| Zone | Archetype | Route | Body treatment |
| --- | --- | --- | --- |
| Ask | FEED | `/research/ask` | centred card (`NoStoreYet`) |
| Diligence | COLLECTION | `/research/diligence` | centred card |
| Benchmarking | ANALYTICS | `/research/benchmarking` | centred card |
| Markets | ANALYTICS | `/research/markets` | live signals feed |
| Library | COLLECTION | `/research/library` | centred card |

Overview: `InvestorResearchWorkspace.jsx` on `/research` and `/market-intel`
(role branch). **`/research/*` deliberately excluded from `INVESTOR_FULL_BLEED`**
— zones render `WorkspaceShell` around a card, not a full canvas.

Guard: `investor_workspaces.test.mjs` (I8).

### Shipped (2026-09-02)

- Five bucket roots + nine sidebar rows aligned with `Investor LP Canvas`.
- All nineteen zone routes registered; `ZoneNav` composes targets from
  `shellConfig.js`.
- Twelve bespoke investor rails collapsed into `WorkerRail`.
- `INVESTOR_FULL_BLEED` single list (includes `/funds/*` zone canvases).
- Failed reads never render as empty (`detailFor`, `UNAVAILABLE` sentinel).
- Archetype badges match `Pages · Investor *` canvases (pinned in
  `investor_shell_canvas.test.mjs`).

### Still open

- **I1 proposal anatomy** on every zone (cost estimate, receipt, Llama-Guard
  shield on outbound artifacts).
- **I1 model card** and per-action pricing — blocked on `ASSIST_SURFACES`.
- **Detail-layer UPGRADEs** in `ROUTE_MAP.md` for each `Pages · Investor *`
  row (pipeline SLA, screening rubric, commit quorum, closing checklist, etc.).
- **Positions / Health / Cap Table** vocabulary alignment.
- **I5 Axal VC Fund** canvas fidelity — LP workspace remains DEFERRED in
  `ROUTE_MAP.md`; link row preserved.

---

## Advisor and Partner (not migrated)

Advisor sidebar still points Practice at `/practice` but Expertise/legacy paths
and Trust/Settings rows follow earlier product decisions documented in
`sidebarConfig.js`. Partner shell uses `/needs` and `/partner/operations/*`
legacy mounts inside workspace tabs.

Do not add these roles to `MIGRATED` until their sidebar rows point at bucket
roots and every zone in `shellConfig.js` opens in `App.jsx`.

---

## Verification checklist (Investor / LP — run before closing IA work)

```bash
node --test frontend/test/founder_shell.test.mjs \
  frontend/test/founder_shell_canvas.test.mjs \
  frontend/test/investor_shell.test.mjs \
  frontend/test/investor_workspaces.test.mjs \
  frontend/test/investor_portfolio_i4.test.mjs \
  frontend/test/investor_fund_i6.test.mjs \
  frontend/test/investor_shell_canvas.test.mjs \
  frontend/test/workspace_shell_routes.test.mjs
```

Manual spot-check after visual changes: each workspace overview shows indigo
active nav, cyan seam chips only on cross-licence objects, one `Worker AI ·
{workspace}` rail, zone pills that change the URL, and Fund row lock state for
free/professional tiers.
