# `frontend/src/workspaces/` — the chrome every workspace subpage sits in

A **bucket** is a route prefix that owns a group of pages (`/validate`, `/deals`,
`/practice`, `/offers`). A **zone** is one page inside it (`/validate/interviews`).
This folder holds the shell those pages share, and the four per-licence route
modules that mount bodies into it. The pages themselves live in
`frontend/src/pages/founder/`, `.../investor/`, `.../advisor/` and `.../partner/`.

## What is here

| File | Role |
| --- | --- |
| `shellConfig.js` | **The data.** Every bucket and zone for all five shells, in canvas order, with archetypes and per-role accents. The sidebar, the router and the guard tests all read it, so a row can never advertise a door that does not open. |
| `WorkspaceShell.jsx` | The frame: crumb, `<h1>` with its archetype badge, the zone pill row, the page body, and the Worker AI rail as a slot. Also exports `NotRecorded` and `SeamChip`. |
| `ZoneNav.jsx` | The zone pill row. Each pill is a real `NavLink`; the current one comes from the URL. `activeSlug={null}` is overview mode — a bucket root is above its zones and lights none of them. |
| `ZoneActions.jsx` | The zone header's action row — what a reader can *do* on the page. One ghost variant, because that is what every canvas draws. An action with no live endpoint states its limit instead of rendering a button. |
| `BucketOverview.jsx` | The body a bucket root renders when the canvas corpus draws **no root artboard** for it: the bucket's zones as cards. Advisor `/cohorts` and every founder and investor bucket. |
| `BucketBoard.jsx` | The body a bucket root renders when the corpus **does** draw one: an h1, then one section per zone, each with a real count, a short table of real rows and a footnote. Partner ×5, advisor ×4. |
| `useBucketSources.js` | A board's parallel fetch, one state per source. It reads the endpoints the **zone pages already read**, so the overview's number is the zone's number by construction — and so the honest `*_note` beside a null figure travels with it instead of being re-copied. |
| `NoStoreYet.jsx` | The honest state for a zone with no store: what it would hold, what would fill it, and the nearest live surface. Shared by the three route modules and by a gapped board section. |
| `NetworkWorkspace.jsx` | `/network/*` for founder, advisor and partner — one shared path, one zone list. |
| `ResearchWorkspace.jsx` | `/research/*`, shared path, per-role zone list. |
| `bucketOverview.css` | The overview grid. `BucketBoard` has no stylesheet — its only dynamic value is a per-section `grid-template-columns` from the canvas, which is an inline style. |

## Subfolders

| Folder | Role |
| --- | --- |
| `founder/` | `FounderValidateWorkspace.jsx` — the four `/validate/*` zones. |
| `investor/` | `InvestorDealsRoutes.jsx` — the four `/deals/*` zones. |
| `advisor/` | `AdvisorBucketRoutes.jsx` — `/practice/*`, `/cohorts/*`, `/expertise/*`. |
| `partner/` | `PartnerBucketRoutes.jsx` — `/pipeline/*`, `/delivery/*`, `/offers/*`. |
| `boards/` | One registry per composed bucket root, keyed `role:prefix` in `index.js`. Plain object literals, never JSX — `_codeOnly.mjs` cannot strip a JSX comment, so prose in a component file can match a ban before the code does. A section declares either a `source` or a `gap`, never both; `summary`, `rows` and `footnote` take the source payload as their **only** argument, which is why a gapped section cannot print a figure. |

## The rule for adding to it

**A zone is a line in `shellConfig.js` plus a route in `App.jsx`, in the same
change.** `frontend/test/workspace_shell_routes.test.mjs` reads this config as
text and asserts every zone it names is registered in the router; a zone with no
route fails the build rather than shipping a pill that 404s.

**A route module that resolves a zone must opt out on the bucket root.**
`zoneForPath` answers a root with its *first* zone — correct on a zone route,
wrong on a root, where the reader is above the zones and on none of them. Every
module here carries the same two lines:

```js
const isRoot = Boolean(bucket) && location.pathname === bucket.prefix;
// … then, on the shell:
title={isRoot ? bucketTitle(bucket) : undefined}   // the tagline, not the label
activeSlug={isRoot ? null : undefined}
```

**Never mark a pill current by its position.** Four founder desk stylesheets did
exactly that and lit the first pill on every overview; see `DECISIONS.md` D44 and
`frontend/test/zone_pill_active_state.test.mjs`, which bans the selector shape.

**One licence's chrome never renders on another's route.** The role decides,
once, in `shellConfig.js` — which is the whole reason this folder replaced
`FounderWorkspaceTabs`, `PartnerWorkspaceTabs`, `WorkspaceTabs` and three bespoke
investor workspaces all solving the same problem four ways.

**A zone header's actions come from the canvas, and each one is either wired or
stated.** `zoneActionBuilder.js` holds the rules; `founderZoneActions.js`,
`investorZoneActions.js`, `partnerZoneActions.js` and `advisorZoneActions.js`
hold each profile's answers — sixty-seven zones and a hundred and ninety-six
actions between them. The labels are copied from
the `ops:` array of the zone's artboard, and each is an export that runs
(`frontend/src/lib/csvExport.js`), a link to a route that performs it, or a
`note` saying nothing does. `ZoneActions.jsx` renders a note as text and never as
a button, because a button is a promise.
`frontend/test/profile_zone_actions.test.mjs` re-derives the labels from the canvases and
re-checks every link against `App.jsx`'s guards, for every profile.

**The builder is shared and the tables are not, deliberately.** The rules are
identical across licences and the answers are not: `/matches` is where
`introductionsRequest` lives and is guarded `['admin', 'partner', 'investor']`,
so the identical canvas label "Request an intro" is a link on the investor's
`/network/introductions` and a stated gap on the founder's. Four tables each
carrying their own copy of "what an empty export says" is how this repo ended up
with three CSV escapers that disagree.

**Two of those checks exist because a source test cannot see the screen.** A row
placed inside the Network zones' `{!embedded && <header>}` rendered nowhere —
that guard is false on the only route that mounts them — and a page that names a
variable it does not have throws at render while the bundle builds clean. Both
shipped into this folder and both were found by a browser, so both now have an
assertion.

**A row goes where the rows are.** Three shapes are in use and the choice is not
stylistic: a page that owns its list renders the row itself; seven partner zones
pass it to `ZoneBody` (in `frontend/src/pages/advisor/expertise/kit.jsx`), which renders it
above all four of its states; and two shared pages take it as a render prop
called with the rows their tab loaded, so the caller decides and the page learns
nothing about licences. Wiring from a bucket router instead would be one edit
rather than ten — and would cost every export its rows, which is most of what
this pass delivers.

**A surface serving more than one licence asks `zoneActionsByRole.js`.**
`/network/*` and `/research/*` are one component each answering four roles: the
bodies are the same and the actions are not, so the body stays shared and the
answers stay in each profile's table. An unknown role gets an empty list, never
a default profile's. Six shared bodies take the row as a render prop called with
the rows they loaded, which is what lets "export this view" mean anything there.
