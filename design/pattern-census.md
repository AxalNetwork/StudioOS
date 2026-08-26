# Duplicate-Component-Pattern Census — Axal VC Platform

Scope: 107 `*.dc.html` design canvases in `/home/user/StudioOS/Axal VC platform/`
(`uploads/`, `scraps/` excluded), diffed against the live React app in
`/home/user/StudioOS/frontend/src/`.

Method: structural probes over inline CSS, per-canvas class prefixes, and
`<sc-for list="{{ … }}">` data-shape names, run over all 107 files
(scripts: `census.sh`, `census2.sh`, `census.py` in this scratchpad). Counts below
are file counts from those probes, not impressions.

**Repo state:** `frontend/src/ui/` **does not exist**. There is no `Button`, `Card`,
`Badge`, `Pill`, `Modal`, `Dialog`, `Table`, `Tabs`, `Drawer`, `Stat`, `Avatar`,
`PageHeader`, or `Field` primitive anywhere in `frontend/src/components/`. Stack is
React 19 + Vite 8 + Tailwind v4 (CSS-first `@theme` in `frontend/src/index.css`),
JSX (TS only under `src/decks/` and `src/brand/`).

---

# 1. RailNav: the 8-to-1 consolidation analysis

## 1.0 Correction to the brief (read this first)

The task brief describes the 8 rail canvases as "8 variants of the same **left-rail
navigation**". They are not. **All 8 are the right-hand AI control rail**, not
navigation. Every one of them renders: a "Worker AI · {page}" eyebrow, a mode
selector, a model card or model menu, an assist/batch block, a monthly-spend meter,
and a trust footer. None contains a single route link.

The actual left navigation is a *different* element — `.side` (172–198px, 16 canvases
at exactly 186px) — and it already has a live React implementation
(`SidebarNav` in `App.jsx`, see §1.6). The two must not be merged.

So the correct consolidation target is:

| Brief says | Reality | Target component |
| --- | --- | --- |
| `RailNav` (left nav, 8 variants) | Right-hand AI control rail, 8 variants | **`AssistRail`** — new build |
| — | Left nav, 27 canvases | `SidebarNav` — **already exists**, already config-driven |

I use **`AssistRail`** below for what the brief calls `RailNav`. Rename at will; the
analysis is unaffected.

Container evidence: 27 canvases share an identical 3-pane app shell —
`.frame{width:1440px}` = `.side` (left nav) + `.main` + `.rail`. The `.rail` width is
264–288px across those 27 (280px in 16 of them). The 8 `*Rail.dc.html` files are that
`.rail` column extracted as standalone specs.

## 1.1 What is IDENTICAL across all 8 (the fixed skeleton)

Verbatim-identical, byte-for-byte in every one of the 8:

1. **Root wrapper** — `font-family:Inter,system-ui,sans-serif;color:#18181b`.
2. **Header row** — `display:flex;align-items:center;justify-content:space-between;gap:10px`,
   containing a 10px/800-weight uppercase eyebrow (`letter-spacing:.09em`) and a `›`
   chevron on the right.
3. **Section-label typography** — every section heading is exactly
   `font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#615c6e`
   with `margin-top:15–16px`.
4. **Card shell** — `border:1px solid #ececf1;border-radius:9px;padding:10–11px`.
   Accented cards swap the border/background for the accent's `edge`/`tint` and add
   `box-shadow:0 0 0 2px rgba(<accent>,.08)`.
5. **Toggle switch** — `width:24px;height:14px;border-radius:999px` with an absolutely
   positioned `top:2px;right:2px;width:10px;height:10px;border-radius:50%;background:#fff`
   knob. Identical in all 8 (this exact string appears in exactly 11 canvases total —
   the 8 rails plus the 3 workspace canvases that embed a rail).
6. **Spend meter** — `<div style="height:5px;background:#eceaf2;border-radius:999px;overflow:hidden">`
   with an inner `width:{{pct}}%` fill in the accent. Present in all 8, identical.
7. **Spend header row** — `display:flex;align-items:baseline;justify-content:space-between`,
   a 16–17px/800 tabular-nums amount, and a 10.5px `of {{ plan }}` on the right.
8. **Model ID typography** — `font-family:ui-monospace,Menlo,monospace;word-break:break-all`
   at 10.5px `#615c6e`.
9. **Footer rule** — `margin-top:14px;padding-top:13px;border-top:1px solid #f2f1f5`.
10. **Cost arithmetic** — every rail computes `tin/1e6*pin + tout/1e6*pout` from one
    shared helper so the pre-run estimate and the post-run receipt can never diverge.
    Six of the eight literally carry the same comment ("ONE arithmetic for the
    before-estimate and the after-receipt"). This is a domain invariant, not styling —
    it belongs in a `lib/aiCost.js`, not in the component.
11. **Money formatter** — `c4 = (n) => '$' + n.toFixed(4)`, byte-identical in all 8.

## 1.2 What VARIES (→ becomes config)

Section-presence matrix, derived by grep over the `<x-dc>` body of each file:

| Section | AIRail | InvRail | AdvRail | PartnerRail | AdminRail | ForgeRail | DetailRail | EmberRail |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Eyebrow shows page name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| "Inherited from {page}" dashed banner | – | – | – | – | – | – | ✓ | ✓ |
| Mode = 2-card grid (Manual / AI) | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Mode = single card | – | – | – | – | ✓ | ✓ | ✓ | ✓ |
| Red guardrail card ("never sends, signs or voids") | – | – | – | – | – | ✓ | – | – |
| Model **menu** (`sc-for models`, selectable) | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Model **single card** (fixed) | – | – | – | – | ✓ | ✓ | ✓ | ✓ |
| "Remembered per page" footnote | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| Assist/batch block | – | – | – | ✓ | ✓ | ✓ (list) | ✓ | ✓ |
| Spend meter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| "Last run" receipt line | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| "Axal VC margin" row | – | – | – | – | ✓ (super only) | ✓ (super only) | – | – |
| Footer = Screened chip + safety note | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ |
| Footer = Scope chip + scope note | – | – | – | – | ✓ | ✓ | – | – |

Other axes of variation:

**a) Accent color** — four rails hardcode it, four take it as a prop:

| Rail | Accent | Source |
| --- | --- | --- |
| AIRail | violet `#7c3aed` / deep `#4c1d95` / tint `#faf7ff` / edge `#d8c9ff` | hardcoded |
| InvRail | indigo `#4f46e5` / `#3730a3` / `#f5f5ff` / `#c7d2fe` | hardcoded |
| AdvRail | emerald `#059669` / `#065f46` / `#f2fdf7` / `#a7f3d0` | hardcoded |
| PartnerRail | amber `#d97706` / `#92400e` / `#fffbf2` / `#fde68a` | hardcoded |
| DetailRail | violet **or** indigo | prop `accent` |
| EmberRail | emerald **or** amber | prop `accent` |
| AdminRail | slate `#475569`/`#334155` **or** oxblood `#9f1239`/`#881337` | prop `tier` |
| ForgeRail | slate **or** oxblood (same pair) | prop `tier` |

Every accent resolves to the same 4-slot shape `{ fill, deep, tint, edge }`, where
`fill` is non-text only and `deep` is the AA-safe text step. AdvRail/EmberRail carry an
explicit comment that emerald and amber text tokens must be the 700 step because 600
fails AA on white. **That rule belongs in the shared token map, once.**

**b) Product noun** — the eyebrow prefix and the mode label are per-persona strings:
"Worker AI" (7 rails) vs "Forge" (ForgeRail); mode label is
"Advisor fills the blanks" (AIRail, InvRail) / "AI fills the blanks" (AdvRail,
PartnerRail, EmberRail) / "Personal Advisor" (AdminRail) / "Forge fills the blanks"
(ForgeRail).

**c) Page enum** — each persona ships a different page list, which keys the whole
per-page payload:
- AIRail: Validate, Build, Raise, Grow, Network, Research
- InvRail: Home, Deals, Portfolio, AxalFund, Fund, Network, Research
- AdvRail: Home, Practice, Expertise, Network, Research
- PartnerRail: Home, Pipeline, Delivery, Offers, Network, Research
- AdminRail: Home, Approvals, Accounts, Insights, Licenses, Revenue, Governance
- EmberRail: Practice, Cohorts, Expertise, Delivery, Pipeline, Analytics
- DetailRail: Build, Raise, Grow, Deals, Network, Fund, Portfolio, Research
- ForgeRail: free-text (Contracts, Support, Security, Record) — page is a *surface*,
  and ForgeRail keys on `surface × tier`, a 2-D lookup no other rail has.

**d) Plan cap** — `$40` (AIRail, AdvRail, PartnerRail, DetailRail, EmberRail), `$80`
(InvRail, AdminRail-subsidiary), `$400` (AdminRail-super). Data, not code.

**e) Model-menu row states** — recommended rows get accent border + 2px ring, the
`RECOMMENDED` chip, the mono model id, the tag chips, the full price line, the optional
cached-input line, and the green estimate. Non-recommended rows get a single inline
price and a one-line rationale. Identical logic in all four menu rails, only the
accent hexes differ.

**f) Badge label** — `RECOMMENDED` (AIRail, InvRail, AdvRail, PartnerRail, AdminRail,
ForgeRail) vs `INHERITED` (DetailRail, EmberRail).

**g) Assist block arity** — one op (AdminRail, PartnerRail, DetailRail, EmberRail) vs a
list of 1–4 ops each with its own cost multiplier (ForgeRail).

## 1.3 Proposed config shape

```ts
// ── shared token map — defined ONCE, not per rail ──────────────────────────
type AccentName = 'violet' | 'indigo' | 'emerald' | 'amber' | 'slate' | 'oxblood';
interface Accent { fill: string; deep: string; tint: string; edge: string }
// deep is the AA-safe text step (700 for emerald/amber); fill is non-text only.

interface ModelRef {
  name: string;              // "DeepSeek V4 Pro"
  id: string;                // "@cf/deepseek-ai/deepseek-v4-pro-0813"  (mono, break-all)
  why: string;               // one-line rationale
  price?: string;            // "$1.320 / M in · $3.960 / M out"
  priceInline?: string;      // "$1.320 / $3.960" — collapsed form for non-recommended rows
  cached?: string;           // "Cached input $0.044 / M — 30× cheaper on re-read"
  tags?: string[];           // ["Best for: legal & terms", "Highest quality"]
  recommended?: boolean;
}

interface RunProfile {        // drives BOTH the estimate and the receipt — one arithmetic
  tin: number; tout: number;  // token counts
  pin: number; pout: number;  // $ per 1M
  cachedIn?: number;          // $ per 1M for cached input
  label: string;              // "term sheet clause review"
  unit:  string;              // "per term-sheet review"
}

interface AssistOp { op: string; note?: string; costFactor?: number }

interface PageConfig {
  label?:   string;           // display override, e.g. AxalFund → "Axal VC Fund"
  modeNote: string;
  manualNote?: string;        // only when mode.kind === 'choice'
  run:      RunProfile;
  models?:  ModelRef[];       // mode.model === 'menu'
  model?:   ModelRef;         // mode.model === 'fixed'
  assists?: AssistOp[];       // 0, 1, or many
  assistLabel?: string;       // "Batch on this page" | "Admin assist" | "Contract assists"
  spend:    number;           // this page, this month
  footer:   { kind: 'screened'; note: string }
          | { kind: 'scope'; chip: string; note: string };
}

interface AssistRailConfig {
  product:   string;                 // "Worker AI" | "Forge"
  accent:    AccentName | Accent;
  planCap:   number;                 // 40 | 80 | 400
  totalSpend?: number;               // account-wide MTD; omit to sum page spends
  mode: {
    kind:   'choice' | 'fixed' | 'inherited';
    label:  string;                  // "AI fills the blanks" | "Personal Advisor" | …
    model:  'menu' | 'fixed';
    badge?: 'RECOMMENDED' | 'INHERITED';
  };
  inheritedFrom?: string;            // renders the dashed banner; DetailRail/EmberRail
  guardrail?: { title: string; body: string };   // red card; ForgeRail only
  margin?: { pct: number; note?: string };       // super tier only
  showReceipt?: boolean;             // "Last run ·" line
  showRememberedNote?: boolean;      // "Remembered per page." footnote
  pages: Record<string, PageConfig>;
  defaultPage: string;
}
```

Component signature:

```jsx
<AssistRail config={INV_RAIL} page={page} onPageChange={setPage} />
```

`pages` is intentionally a `Record` rather than an array: every rail keys its whole
payload off the page/surface name, and ForgeRail's 2-D `surface × tier` lookup is
expressed by building the record at call time (`forgeConfig(tier)`), not by adding a
second dimension to the component.

### One persona's config, concretely (InvRail, abbreviated)

```js
export const INV_RAIL = {
  product: 'Worker AI',
  accent: 'indigo',
  planCap: 80,
  totalSpend: 31.00,
  mode: { kind: 'choice', label: 'Advisor fills the blanks', model: 'menu', badge: 'RECOMMENDED' },
  showReceipt: true,
  showRememberedNote: true,
  defaultPage: 'Home',
  pages: {
    Home: {
      modeNote: 'Composes the daily capital brief, triages what arrived across the seam, ranks by relevance.',
      manualNote: 'Tables, boards and models work alone. No tokens.',
      run: { tin: 18600, tout: 1420, pin: 0.293, pout: 2.253,
             label: 'capital brief across 14 positions', unit: 'per daily brief' },
      spend: 3.12,
      models: [
        { ...L33, recommended: true,
          why: 'Synthesis across your whole book at once — 14 positions, every update, in one read.',
          tags: ['Best for: synthesis', 'Long context'] },
        { ...GRANITE, why: 'Near-free alert triage. Sort what arrived; escalate the reading to the 70B.' },
        { name: 'BGE-M3', id: '@cf/baai/bge-m3', priceInline: '$0.012 in',
          why: 'Relevance ranking behind the brief’s ordering.' },
      ],
      footer: { kind: 'screened',
        note: 'Nothing here is outbound. Screening applies only if you forward a brief to a partner or LP.' },
    },
    Fund: {
      label: 'Fund',
      modeNote: 'Drafts call letters from the schedule, explains waterfalls step by step, assembles LP packs.',
      manualNote: 'Tables, boards and models work alone. No tokens.',
      run: { tin: 12400, tout: 1850, pin: 1.320, pout: 3.960,
             label: 'capital call letter, 11 LPs', unit: 'per call letter' },
      spend: 7.90,
      models: [
        { ...DS_PRO, recommended: true,
          why: 'The strongest reasoning available for calls, waterfalls and LP letters. This is money leaving a bank account.',
          tags: ['Best for: calls & waterfalls', 'Highest quality'],
          cached: 'Cached input $0.044 / M — re-reading the same schedule is 30× cheaper' },
        // …
      ],
      footer: { kind: 'screened',
        note: 'Every LP letter is outbound and legally consequential — screened, and every number traceable to the schedule.' },
    },
    // AxalFund, Deals, Portfolio, Network, Research …
  },
};
```

Model refs are hoisted (`L33`, `GRANITE`, `DS_PRO`, `FLASH`, `R1`, `MIST`) exactly as
InvRail already does in-canvas — the same six models recur across five of the eight
rails, so they belong in a shared `MODELS` registry, not in each persona config.

## 1.4 What CANNOT be config → needs a slot / render-prop

1. **ForgeRail's guardrail card.** Red (`#fecaca` / `#fffbfb` / `#991b1b`), 1.5px
   border, placed between the mode card and the model card. Only one rail has it, only
   one has that treatment, and its copy is a compliance statement, not a label. Config
   as `guardrail?: {title, body}` works today, but if a second rail ever needs a
   *different-shaped* legal notice this must become a `slot="afterMode"`.
   → **`slots.afterMode`** is the safer contract.

2. **AdminRail's margin block.** It is not a variant of the spend meter — it is a
   *second* metric with different semantics ("subsidiaries see their spend; only HQ
   sees what it earned") appended inside the usage card, gated on tier. The
   `margin?: {pct, note}` config covers both current uses, but the visibility rule is
   an authorization decision, not presentation. → keep the render in config, but the
   `tier === 'super'` gate must be resolved by the caller, never inside `AssistRail`.

3. **ForgeRail's `surface × tier` keying.** Config is 1-D (`pages`). Forge's payload is
   2-D. Resolve at the call site with a `forgeConfig(tier)` factory that flattens to the
   1-D shape. Do not add a `tier` dimension to `AssistRailConfig` — five rails would
   carry a dead axis.

4. **The mode toggle's behaviour.** All 8 canvases draw the switch in its ON state and
   none of them wire it. The real component needs `mode`/`onModeChange` as controlled
   props with the persisted per-page memory that the "Remembered per page. Switching
   changes nothing already accepted." footnote promises. That is a hook
   (`useAssistMode(pageKey)`), not config.

5. **Model selection.** Same: the canvases render a static menu. Live, this is
   `selectedModelId` + `onSelectModel`, persisted per page.

6. **`DetailRail`/`EmberRail`'s inheritance link.** The copy says "Change the model
   there and this page follows" — that implies a live read of the parent workspace's
   choice, i.e. context, not a prop. → `useAssistMode` should read through to the parent
   surface when `mode.kind === 'inherited'`.

## 1.5 Payoff

8 canvases × ~120 lines of markup + ~90 lines of per-page data ≈ **1,700 lines of
spec** collapse to **one component (~220 lines) + 8 config objects (~90 lines each,
almost all of which is copy, not code)**. The duplicated cost arithmetic (`c4`, `run`,
`tok`, the `tin/1e6*pin + tout/1e6*pout` expression), duplicated 8 times today, becomes
one `lib/aiCost.js`.

## 1.6 The existing `SidebarNav` — how close is it?

`SidebarNav` lives at **`/home/user/StudioOS/frontend/src/App.jsx:584`** (≈180 lines),
fed by **`/home/user/StudioOS/frontend/src/sidebarConfig.js`** (547 lines,
`SIDEBAR_GROUPS` keyed by role: `admin`, `founder`, `partner`, `investor`, `advisor`,
`exploring`).

It is the live counterpart of the canvases' `.side` column, **not** of the 8 `*Rail`
files. Verdict on each:

| | Canvas `.side` (27 canvases) | `SidebarNav` today |
| --- | --- | --- |
| Config-driven items | ✓ `nav`/`navGroups`/`navN` arrays | ✓ `SIDEBAR_GROUPS[role]` |
| Collapsible groups | mostly flat lists | ✓ + localStorage persistence (`sidebar_open_groups`) |
| Icons per item | ✓ inline SVG | ✓ lucide-react |
| Active state | `cls: 'nav on'` | ✓ `NavLink` + optional `match[]` prefixes |
| Collapsed/icon-rail mode | not drawn | ✓ (`collapsed` prop, abbreviated labels) |
| Tier lock chips | ✓ `.lock` "Inst." chip | ✓ `requiredTier` / `requiredInvestorTier` → `PaywallModal` |
| Search filter | not drawn | ✓ (with match highlighting) |
| Company switcher / footer | not drawn | ✓ `CompanySwitcher` + Company Settings footer |
| Width | 172–198px (186px modal) | Tailwind-driven |

**`SidebarNav` is ahead of the canvases on every axis.** The canvases' left rail is a
simplified stand-in drawn to give the artboards context. Do **not** rebuild it.

The one real action for `SidebarNav` is a **lift, not a rewrite**: it is defined inline
in `App.jsx` alongside `CompanySwitcher` and `PortalSwitcher`. Move it to
`frontend/src/ui/SidebarNav.jsx` (config already lives outside in `sidebarConfig.js`, so
this is a file move plus imports) so `ui/` owns the app chrome and `App.jsx` shrinks
from 2,190 lines.

---

# 2. Recurring non-rail patterns

Counts are **distinct canvases (of 107)** where the pattern's structural probe fires.
Only patterns at 3+ canvases are listed; all listed patterns clear that bar by a wide
margin.

| Pattern | Canvases | Example canvases | Variants observed | Existing React component | Recommendation |
| --- | :-: | --- | --- | --- | --- |
| **Section header / eyebrow label** | 106 | Quarterly Report (43×), Spin-Out Lab Workspace (35×), Co-founder Match (25×) | Standalone eyebrow; eyebrow + right-aligned meta; eyebrow + count; 9px vs 10px scale | none (`SectionScaffold.jsx` is a page placeholder, not this) | **Build new** `ui/SectionLabel.jsx` + `ui/SectionHeader.jsx`. Single most duplicated token in the whole system: `font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#615c6e`. Ship first — it is 15 lines and unblocks every other component. |
| **Numeric treatment (tabular / mono)** | 104 | System Sheet (14×), Events (13×), all 8 rails | `tabular-nums` inline; `.num` class; Roboto Mono for IDs; `ui-monospace` for model/contract IDs | none | **Build new** — two utility classes in `index.css` (`.num`, `.mono-id`), not a component. `Roboto Mono` is already imported at `index.css:1`. |
| **Card surface** | 94 | Founder Workspaces (41×), Investor LP (39×), Spin-Out Lab Workspace (39×) | plain; accented (tint + edge + 2px ring); dashed (inherited / placeholder); sunken; dark-mode variants in 23 canvases | none | **Build new** `ui/Card.jsx` with `variant: 'plain' \| 'accent' \| 'dashed' \| 'sunken'` and `tone`. Canonical: `border:1px solid #ececf1; border-radius:9–11px`. |
| **Stat / KPI tile** | 93 | Axal VC Website (14×), Mobile Canvas (10×), Portfolio (9×) | label + value; + delta with tone; + note line; + 6-bar sparkline (Portfolio); 4-up grid is the dominant layout | none — 138 React files hand-roll `text-2xl font-bold` + label; 167 hand-roll the grid | **Build new** `ui/Stat.jsx` + `ui/StatGrid.jsx`. Highest-volume duplication in the React codebase. |
| **Page header (breadcrumb + H1 + sub)** | 73 | Detail Layer Canvas I/II (22× each), Pages · * family (15× each) | crumb + h1 + sub; + right-aligned action buttons; + status pill next to title; + route chip | partial: `WorkspaceHeader` in `components/WorkspaceTabs.jsx` (icon + title + description only, 13 importers); `PageExplainer.jsx` (40 importers) slots under it | **Lift + extend** `WorkspaceHeader` → `ui/PageHeader.jsx`; add `breadcrumb`, `actions`, `status`. 147 React files hand-roll an `<h1 class="text-2xl font-bold">` block today. |
| **Data table** | 51 | Partner Operator (56×), Detail Layer II (27×), Funds · Fabric (27×) | CSS-grid table (dominant — shared `cols` string + `.th`/`.td`); real `<table>` (11 canvases); sortable headers (`.pf-sort`); row hover; horizontal scroll (`.pf-wide`); cells carrying pills/seam chips | none — 72 React files hand-roll `<table>` | **Build new** `ui/DataTable.jsx` (columns config + `renderCell`) and `ui/TableCellPill`. Must ship with `overflow-x:auto` and row-hover built in; both are re-derived in nearly every canvas. |
| **Status pill / badge** | 46 (+40 with a `pill()` tone factory) | Detail Layer II (25×), Advisor Canvas (18×), Advisor Detail (16×) | rounded-999px chip; 3–4px radius uppercase micro-tag; dot + label; lock chip ("Inst."); seam chip (cyan); "RECOMMENDED"/"INHERITED" | none generic — 4 bespoke ones: `TrustScoreBadge.jsx`, `UserTrustBadge.jsx`, `FounderRiskBadge.jsx`, `IncorporationStatusBadge.jsx`, each with its own private tone map | **Build new** `ui/Pill.jsx`. **40 canvases define a `pill(tone)` style factory and the argument order has already drifted** — `ok:['#a7f3d0','#f2fdf7','#047857']` in 4 canvases vs `ok:['#ecfdf5','#047857','#a7f3d0']` in 3 vs `ok:['#f2fdf7','#a7f3d0','#047857']` in 1. That is copy-paste rot in the spec itself. Canonical tones: `ok` emerald, `warn` amber, `bad` red, `neutral` slate, `info` indigo. |
| **Form field group** | 46 | Spin-Out Lab Workspace (27×), Account (20×), Fund Administration (19×) | label + input; label + input + helper; inline validation; select; textarea; `.field` class in 13 canvases | none | **Build new** `ui/Field.jsx` — thin wrapper (label / control / help / error). Low risk, high reuse. |
| **Avatar / person row** | 43 | Spin-Out Lab Workspace (9×), Axal VC Website (4×), Detail Layer II (4×) | circle initials; rounded-square initials (drawer headers use 12px radius); avatar + name + role; stacked/overlapping groups; sizes 20–46px | none — `AuthorCard.jsx` is content-specific | **Build new** `ui/Avatar.jsx` + `ui/PersonRow.jsx`. Initials derivation is re-implemented per canvas (`name.split(' ').map(x=>x[0]).join('')`). |
| **Modal / overlay** | 42 | LP Investor Workspace (36×), Compliance (25×), 83b Election Tracker (23×) | centered dialog; confirm; full-bleed viewer; toast-over-modal | none generic — 5 bespoke: `PaywallModal`, `StepUpModal`, `InactivityWarningModal`, `ShareViewerSignupModal`, `PitchDeckModals`. **97 React files hand-roll `fixed inset-0`**; only 26 use the `useEscapeClose` hook that exists | **Build new** `ui/Modal.jsx` wrapping the existing `components/useEscapeClose.js`. Biggest a11y win available: 71 of 97 hand-rolled overlays currently have no ESC handling. |
| **Tabs / segmented control** | 40 | Cap Table Pro, Deal Flow, Liquidity & Secondaries, Portfolio | underline tabs (`.tab`, `border-bottom:2px`); segmented pill group (`.seg`); zone chips (`.zb`, with attention dot); state tabs with counts | `components/WorkspaceTabs.jsx` (13 importers) — route-driven underline tabs only | **Lift + extend** `WorkspaceTabs` → `ui/Tabs.jsx`. Add `variant: 'underline' \| 'segmented' \| 'chips'` and a non-routed (state-driven) mode; 36 React files hand-roll `border-b-2`. `NetworkSubNav.jsx` should then be re-expressed as `<Tabs>` + a link list. |
| **Progress bar / meter** | 40 | Co-founder Match (5×), Founder Workspaces (4×), Pages · Partner Pipeline (4×) | 5px spend meter (all 8 rails); thicker completion bar; segmented/stacked; labelled with used/cap | `components/QuotaCard.jsx` has a private `QBar` with threshold tones (warn ≥80%, danger ≥100%); `InvestorQuotaBars.jsx` duplicates it | **Lift** `QBar` out of `QuotaCard.jsx` → `ui/Meter.jsx`; then rewrite `QuotaCard` and `InvestorQuotaBars` on top of it. Its warn/danger thresholds are the behaviour the canvases only imply. |
| **Filter bar / chip toolbar** | 39 | all 11 `Pages · *`, Axal VC Website, Detail Layer Canvas, Get Paid & Invoicing | filter chips (`.fil` / `.fil.on`); + right-aligned ghost ops (`margin-left:auto`); + search input (5 canvases); zone chips above the bar | none | **Build new** `ui/FilterBar.jsx` (chips + `actions` slot). The `Pages · *` family shows the canonical shape: `filters` left, `ops` right, `border-bottom` rule under. |
| **Left nav / app shell** | 38 (27 with the full 3-pane `.frame`) | Axal VC Website (17×), Investor LP (16×), Partner Operator (14×), all `Pages · *` | 1-pane; 2-pane (side + main); 3-pane (side + main + rail 264–288px); flat vs grouped nav; lock chips | **`SidebarNav` (App.jsx:584) + `sidebarConfig.js`** — already ahead of the canvases | **Lift only.** Move `SidebarNav` (+ `CompanySwitcher`) out of `App.jsx` into `ui/`. Then add `ui/AppShell.jsx` for the 3-pane grid so `AssistRail` has a home. |
| **Timeline / activity feed** | 29 | 83b Election Tracker, Account, Advisory Practice, Detail Layer Canvas, Trust Center | vertical line + dots; ledger rows (date/event/amount); receipt log; milestone track | none | **Build new** `ui/Timeline.jsx`. Note the `ledger`/`receipts`/`history` data shapes are all the same row: `{ when, what, note, amount? }`. |
| **Empty / locked / gated state** | 28 | Spin-Out Lab Workspace (52×), Founder Studio (23×), Investor LP (15×) | empty ("Nothing here yet"); locked-by-tier (`.lock` chip / blurred preview); no-data-yet with CTA | **`components/EmptyState.jsx`** (good API: icon/title/body/cta/secondary, WCAG-sized targets) — but **only 4 importers**. Also `LockedPreview.jsx`, `LockedFounderCard.jsx`, `ErrorState.jsx` (4 importers), `Skeleton.jsx` (4 importers) | **Lift, then evangelise.** Move `EmptyState`/`ErrorState`/`Skeleton` into `ui/` unchanged and add a `locked` variant. These are the best components already in the repo and are essentially unused; the gap is adoption, not design. |
| **Step / progress indicator** | 25 | Auth and Onboarding (4×), Customer Templates (4×), BD Console (3×) | numbered dots + connector; "Step N of M" text; phase/lifecycle track; milestone rail | none — `OnboardingWizard.jsx`, `SpinoutWizard.jsx` each embed their own | **Build new** `ui/Steps.jsx`, then refactor both wizards onto it. |
| **AI proposal card (accept / edit / discard)** | 25 | Founder Workspaces (50×), Investor LP (34×), Advisor Canvas (32×), Partner Operator (20×) | tinted accent card + `PROPOSAL` chip + right-aligned cost estimate + body + accept/edit/discard button row; some add a source/receipt line | **none** (one near-match in `pages/PartnerOnboardPage.jsx`) | **Build new** `ui/ProposalCard.jsx`. This is the product's signature interaction and it has *zero* React implementation. It pairs directly with `AssistRail` — same accent tokens, same `c4()` cost formatter. Prioritise alongside `AssistRail`. |
| **Drawer / right side-panel** | 12 (7 with a real drawer) | Office Hours (520px), Co-founder Match (560px), Advisors (540px), Team (440px), Scoring Engine (460px), Spin-Out Lab Workspace (400px), Co-founder Agreement (520px) | widths 400–560px; all right-anchored, all `width:100%!important` under 1080px; sticky header w/ avatar + close; backdrop `rgba(24,24,27,.4)` + `backdrop-filter:blur(2px)` | none | **Build new** `ui/Drawer.jsx` with `width` prop (default 480px) and the mobile full-width rule baked in. Shares the backdrop + focus trap with `ui/Modal.jsx` — build them together. |
| **Toggle switch** | 11 | all 8 rails + Advisor Canvas, Founder Workspaces, Investor LP | one form only: 24×14 track, 10px knob | none | **Build new** `ui/Toggle.jsx` — 20 lines, byte-identical across all 11 canvases. Trivial, do it with `AssistRail`. |

---

# 3. Prioritized `ui/` build list

## Tier 0 — lift what already exists (file moves, near-zero risk)

These are already written and already good. They are under-adopted because they live in
`components/` next to 70 feature-specific files and are not discoverable.

| # | Action | From | To |
| --- | --- | --- | --- |
| 1 | Move unchanged | `components/EmptyState.jsx` | `ui/EmptyState.jsx` |
| 2 | Move unchanged | `components/ErrorState.jsx` | `ui/ErrorState.jsx` |
| 3 | Move unchanged | `components/Skeleton.jsx` | `ui/Skeleton.jsx` |
| 4 | Move unchanged | `components/InfoStrip.jsx` | `ui/InfoStrip.jsx` |
| 5 | Move + extract | `App.jsx:584` `SidebarNav` (+ `CompanySwitcher`) | `ui/SidebarNav.jsx` |
| 6 | Split + generalise | `components/WorkspaceTabs.jsx` | `ui/Tabs.jsx` + `ui/PageHeader.jsx` |
| 7 | Extract `QBar` | `components/QuotaCard.jsx` | `ui/Meter.jsx` (then rewrite `QuotaCard` + `InvestorQuotaBars` on it) |
| 8 | Wrap existing hook | `components/useEscapeClose.js` | consumed by `ui/Modal.jsx` (Tier 2) |

Add `ui/index.js` as the single barrel export, and a lint rule (or a `test:drift`-style
smoke test, matching the repo's existing convention) that fails a PR adding
`fixed inset-0` or `<h1 className="text-2xl` outside `ui/`.

## Tier 1 — author new, highest leverage (unblocks everything else)

| # | Component | Why first | Canvases |
| --- | --- | --- | --- |
| 9 | `ui/SectionLabel.jsx` + `ui/SectionHeader.jsx` | 106/107 canvases. 15 lines. Every other component composes it. | 106 |
| 10 | `ui/Pill.jsx` | 46 canvases, and the tone map has **already drifted** in the spec (3 different argument orders for `ok`). Fixes 4 bespoke badge components. | 46 |
| 11 | `ui/Card.jsx` | 94 canvases. `variant` × `tone`. Precondition for Stat, Proposal, Drawer, AssistRail. | 94 |
| 12 | `ui/Stat.jsx` + `ui/StatGrid.jsx` | 93 canvases; **138 React files** hand-roll it — the single largest duplication in the app. | 93 |
| 13 | `ui/PageHeader.jsx` | 73 canvases; **147 React files** hand-roll an h1 block. Extends existing `WorkspaceHeader`. | 73 |
| — | `index.css` utilities `.num` / `.mono-id` | 104 canvases; CSS, not a component. Ship with #9. | 104 |

## Tier 2 — author new, high value

| # | Component | Notes | Canvases |
| --- | --- | --- | --- |
| 14 | `ui/Modal.jsx` | Wraps `useEscapeClose`. 97 hand-rolled overlays, 71 of them with no ESC handling. Build with #15. | 42 |
| 15 | `ui/Drawer.jsx` | Right-anchored, `width` 400–560, mobile full-width. Shares backdrop + focus trap with #14. | 12 |
| 16 | `ui/DataTable.jsx` | CSS-grid-first (matching the canvases), `<table>` semantics under the hood. 72 hand-rolled tables. | 51 |
| 17 | `ui/FilterBar.jsx` | chips + right-aligned `actions` slot. Canonical shape is the `Pages · *` family. | 39 |
| 18 | `ui/Field.jsx` | label / control / help / error. | 46 |
| 19 | `ui/Avatar.jsx` + `ui/PersonRow.jsx` | Includes the initials helper every canvas re-derives. | 43 |
| 20 | `ui/Toggle.jsx` | 20 lines, byte-identical in all 11 canvases that use it. | 11 |

## Tier 3 — the AI surface (build as one unit)

These four share tokens, the `c4()` formatter, and the cost arithmetic. Building them
separately guarantees the same drift the canvases already show.

| # | Component | Notes |
| --- | --- | --- |
| 21 | `lib/aiTokens.js` | The `{fill, deep, tint, edge}` map for the 6 accents, with the "emerald/amber text must be the 700 step for AA" rule encoded once. |
| 22 | `lib/aiCost.js` | `c4()`, `tok()`, `runCost({tin,tout,pin,pout})`, `cachedCost()`. Duplicated 8× today. |
| 23 | **`ui/AssistRail.jsx`** | The 8→1 consolidation from §1. Consumes #9–#12, #20, #21, #22. Ships with 8 configs in `ui/assistRailConfigs/`. |
| 24 | `ui/ProposalCard.jsx` | The accept/edit/discard card — 25 canvases, zero React implementations, and it is the product's signature interaction. Same tokens as #23. |

## Tier 4 — remaining

| # | Component | Canvases |
| --- | --- | --- |
| 25 | `ui/AppShell.jsx` (3-pane `side` + `main` + `rail`) | 27 |
| 26 | `ui/Timeline.jsx` | 29 |
| 27 | `ui/Steps.jsx` (then refactor `OnboardingWizard`, `SpinoutWizard`) | 25 |

## Sequencing note

Tier 0 is a day of file moves and is worth doing before anything else, because it makes
`ui/` real and gives Tier 1 somewhere to land. Tier 1 items #9–#12 are each under 60
lines and every later component depends on them; do not start Tier 2 or 3 until they
exist, or the new components will re-derive the same inline styles the canvases already
duplicate 800+ times.
