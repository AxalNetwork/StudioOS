# The hub files: what still lives in them, and where a new entry goes (D5615)

A hub is a file that collected entries for the whole product, so any two PRs
adding a feature collided in it. In the seven days to 2026-11-11 (`origin/main`
at `5ba48e651`, 569 commits) the five that remain changed in these many
commits:

| Hub | Commits | Lines then |
| --- | --- | --- |
| `frontend/src/lib/api.js` | 29 | 6,110 |
| `frontend/src/pages/cycles/CycleRoute.jsx` | 26 | 1,527 |
| `cloudflare-worker/src/routes/advisors.ts` | 26 | 2,006 |
| `cloudflare-worker/src/index.ts` | 17 | 3,533 |
| `frontend/src/App.jsx` | 13 | 4,335 |

#4105 gave a new router, a new API module and a new route area a home of their
own, but nothing failed a PR that added to the old files anyway. Since D5615
(#5615) the five are **frozen**: `scripts/hub-freeze.json` lists, per hub, the
names it held when the freeze landed, and `frontend/test/hub_freeze_5615.test.mjs`
(under `npm run test:frontend`) fails on any name a hub holds that its list
does not, naming the entry and the section of this file below that says where
it goes instead. `scripts/lib/hubFreeze.mjs` reads the names.

**The list is a set, not a count.** A name that leaves a hub stays on the list
harmlessly, so moving entries out never edits the list, and a removal never
makes room for an addition. Never add a name to the list to let an entry in:
put the entry where its section says. Only a part that moves entries out of a
hub may rewrite that hub's list, and then only to drop names.

Each section says what still lives in the hub, where a new entry goes, and the
follow-up part that empties it further.

## `frontend/src/lib/api.js`

**What lives there.** The request transport (`request`, deadlines, refusal
reading, the active company), `export * from './apiModules.generated.js'`, the
`api` object with about 1,300 methods, and twenty smaller exported objects
(`dd`, `publications`, `news`, `events`, `jobs`, `spinoutLab`, …). Frozen
names: every export (`export <name>`) and every key of an exported object
(`api.<key>`, `dd.<key>`).

**Where a new entry goes.** A method for an API domain that has a module goes
in that module, `frontend/src/lib/api/<domain>.js`. A new domain is a new
module there (D527); the index `api.js` re-exports is built, never committed,
by `node scripts/build-generated.mjs` (D5612), so `api.js` is not edited (#4105). Either way the method
needs a mounted Worker route (`npm run test:drift` checks it).

**Follow-up.** Moving the `api` object's existing methods into their domain
modules is #4574's extraction, already open; it adds no part here.

## `frontend/src/App.jsx`

**What lives there.** The shell, the auth and role gates, and the routes it has
had since before D528: about 330 lazy page imports and the `<Route>` elements
that draw them. Frozen names: every import specifier, static or dynamic
(`lazy(() => import(…))`).

**Where a new entry goes.** A new route area is one file,
`frontend/src/routes/<area>.jsx`, which `App.jsx` collects with its
`import.meta.glob` (D528, #4105; `frontend/src/routes/README.md` has the
module's shape). A page it draws is imported there, not in `App.jsx`.

**Follow-up.** Moving the existing routes into area modules is #4574's
extraction, already open; it adds no part here.

## `frontend/src/pages/cycles/CycleRoute.jsx`

**What lives there.** The route component every cycle page draws through:
choosing the venture (`useProject`), the overview, module and record pages,
the Distribution, Narrative, Cap table, Data room, Use of funds and Capital
relationships tool branches, the forms, the AI bands' one mount and the one
lightbox mount. Frozen names: every import specifier, static or dynamic
(`lazyStep(() => import(…))`).

Since D5615 each cycle's entry in the table it draws by (`CYCLE_DEFS`) is its
own file: `defs/validate.jsx`, `defs/build.jsx`, `defs/raise.jsx` and
`defs/grow.jsx` hold that cycle's modules, its action and the `*Mount`
lightbox it opens, its tools, Add, fill bands, AI bands, the parts drawn under
each module, record pages, and the lazy steps only that cycle draws.
`CycleRoute.jsx` imports the four and builds `CYCLE_DEFS` from them.

**Where a new entry goes.** A cycle's new part, band, tool, Add or record page
goes in its `defs/<cycle>.jsx`, with the import it needs; a component only one
cycle draws is a `lazyStep` there. A change to the route component's own
behaviour is an edit inside it that adds no import.

**Follow-up.** The `CycleRoute` component body (about 650 lines: the tool
branches, record pages and forms) is a follow-up part of #5615, out of its
scope.

## `cloudflare-worker/src/index.ts`

**What lives there.** The Worker's entry: about 430 static imports, the
middleware (`app.use`), 398 `app.route(…)` mounts written before #4105, a few
handlers of its own, the registry hook (`attachRouteRegistry`,
`mountRemaining`), the `fetch`, `queue` and `scheduled` handlers, and the
Durable Object exports. Frozen names: every static import or re-export
(`import <spec>`) and every registration on `app`: `ROUTE <path> <router>`,
`USE <path> <middleware>`, `GET <path>`, …

**Where a new entry goes.** A new router is one file,
`cloudflare-worker/src/routes/<name>.ts`, exporting `mount` (`{ path, router,
before? }`), which `node scripts/build-generated.mjs` collects into the
uncommitted `routes/_registry.ts` (#4105, D5612,
`cloudflare-worker/src/util/routeRegistry.ts`). Never an `app.route(…)` line.
Middleware for a new router belongs on that router.

**Cron is the one exception, for now.** A cron job is loaded with a dynamic
`await import(…)` inside `scheduled()`, and dynamic imports are not frozen:
cron has no other home yet.

**Follow-up.** Self-registering cron tasks (a task module that declares its
schedule, the way a router declares its mount) is a follow-up part of #5615,
out of its scope. Moving the existing mounts and imports out is #4574's
extraction, already open; it adds no part here.

## `cloudflare-worker/src/routes/advisors.ts`

**What lives there.** The advisor directory and profile (`/me`), matching,
slots, availability, session types, booking links, bookings and their
reviews, client notes and the access log, and the six sub-routers #4715 split
out (`advisors_services.ts`, `advisors_proof.ts`, `advisors_money.ts`,
`advisors_cohorts.ts`, `advisors_engagements.ts`,
`advisors_deliverables.ts`), mounted at `/` behind its `use('*')` store guard.
It is mounted at `/api/advisors` and `/api/mentors`. Frozen names: every
registration on its router, method plus path (`GET /me`, `POST /:uid/book`,
`ROUTE / advisorServicesRoutes`).

**Where a new entry goes.** A new advisor area is its own router file,
`cloudflare-worker/src/routes/advisors_<area>.ts`, mounted through the
registry: `mount = [{ path: '/api/advisors', router, before: [advisorsRoutes]
}, { path: '/api/mentors', router, before: [advisorsRoutes] }]`, so it is
matched before the directory's `/:uid`. It is not behind `advisors.ts`'s store
guard, so it ensures its own stores. A new handler for an existing area goes
in that area's file.

**Follow-up.** The rest of `advisors.ts` (the areas above that have no file of
their own) is a follow-up part of #5615, out of its scope.
