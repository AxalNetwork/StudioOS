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
| `BucketOverview.jsx` | The body a bucket root renders: the bucket's zones as cards. |
| `NetworkWorkspace.jsx` | `/network/*` for founder, advisor and partner — one shared path, one zone list. |
| `ResearchWorkspace.jsx` | `/research/*`, shared path, per-role zone list. |
| `bucketOverview.css` | The overview grid. |

## Subfolders

| Folder | Role |
| --- | --- |
| `founder/` | `FounderValidateWorkspace.jsx` — the four `/validate/*` zones. |
| `investor/` | `InvestorDealsRoutes.jsx` — the four `/deals/*` zones. |
| `advisor/` | `AdvisorBucketRoutes.jsx` — `/practice/*`, `/cohorts/*`, `/expertise/*`. |
| `partner/` | `PartnerBucketRoutes.jsx` — `/pipeline/*`, `/delivery/*`, `/offers/*`. |

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
title={isRoot ? bucket?.label : undefined}
activeSlug={isRoot ? null : undefined}
```

**Never mark a pill current by its position.** Four founder desk stylesheets did
exactly that and lit the first pill on every overview; see `DECISIONS.md` D44 and
`frontend/test/zone_pill_active_state.test.mjs`, which bans the selector shape.

**One licence's chrome never renders on another's route.** The role decides,
once, in `shellConfig.js` — which is the whole reason this folder replaced
`FounderWorkspaceTabs`, `PartnerWorkspaceTabs`, `WorkspaceTabs` and three bespoke
investor workspaces all solving the same problem four ways.
