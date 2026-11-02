# `frontend/src/routes/` — where a new area registers its routes

`App.jsx` holds every route the app has had so far (409 of them), and any two
PRs that add a page collide there. Measured on `main` from 2 August to 3
October 2026 (624 commits): `App.jsx` changed in 109 of them, and together with
`DECISIONS.md`, `api.js` and the built `docs/` it is where nearly every merge
conflict happens. Since D528 a **new area's routes live here**, one module per
area, and since #4105 `App.jsx` collects every module in this folder by itself:
a new area is one new file here and **no edit to `App.jsx`**. The 409 routes
already in `App.jsx` stay there: 156 tests read that file by path, so moving a
route is a change to the tests that pin it, not a tidy-up.

## The module

One file per area, `frontend/src/routes/<area>.jsx`, with a default export
named after the file: admin-labs.jsx exports adminLabsRoutes. It is a
function of `routeTools`, the object `App.jsx` builds from its own closures
(`guard`, `hqOnly`, `authOnly`, `labRoles`, `effectiveRole`, `user`,
`location`), and it returns a fragment of `<Route>` elements:

```jsx
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const LabsPage = lazy(() => import('../pages/admin/LabsPage'));

/** `/admin/labs` — D5xx. */
export default function adminLabsRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/labs" element={guard(['admin'], hqOnly(<LabsPage />))} />
    </>
  );
}
```

Three things keep a module's route identical to one written in `App.jsx`:

- **Lazy loading** is the module's own `lazy(() => import('../pages/…'))`, the
  same call `App.jsx` makes, so the page is a separate chunk either way.
- **Role gates** are the same `guard([...])`, `hqOnly(...)` and `authOnly(...)`
  wrappers, taken from `routeTools` rather than re-implemented, so a route in
  a module cannot be gated differently from one in `App.jsx`.
- **The `<Route>` line is written in the same shape and at the same six-space
  indentation** as the lines in `App.jsx`. The whole-app route tests read
  `App.jsx` and every module as one source (`frontend/test/_routesSource.mjs`,
  `readRoutesSource()`), and their parsers split on `<Route` and scan
  `path="…"` lines; a module that keeps the shape is checked exactly like
  `App.jsx`, and one that does not is invisible to them.

## Wiring it in

There is nothing to wire (#4105). `App.jsx` collects this folder with one eager
Vite glob and composes the list in one line, inside the block marked
`Route modules (D528)` above the catch-all:

```jsx
import { collectRouteModules } from './lib/routeModules';
const ROUTE_MODULES = collectRouteModules(import.meta.glob('./routes/*.jsx', { eager: true }));
…
      {ROUTE_MODULES.map(({ file, routes }) => <React.Fragment key={file}>{routes(routeTools)}</React.Fragment>)}
```

- **Order.** Modules compose in file-name order. A module whose routes must
  come before or after another module's exports `order`, a number (0 when
  absent; lower composes first): `export const order = -1;`. React Router
  ranks routes by specificity, so order matters only between equally specific
  paths.
- **Lazy stays lazy.** The glob is eager because `<Route>` elements are needed
  at once, and a module is a few lines. Its pages are not: each module loads
  its pages with its own `lazy(() => import('../pages/…'))`, so every page is
  still its own chunk. Never import a page statically in a module;
  `routes_modules_d528.test.mjs` fails on one.
- **Tests.** The node test loader expands the same glob
  (`frontend/test/_importMetaGlob.mjs`, used by `_deck-loader-hook.mjs`), so a
  test that renders `App.jsx` sees every module as the build does.

`frontend/test/routes_modules_d528.test.mjs` fails the build when `App.jsx`
loses the glob or the compose line, when a module's default export is not the
function its file name implies, or when a module imports a page eagerly.

## Rules

- A **new** area gets a module. A route that belongs to an area that already
  lives in `App.jsx` goes next to its siblings in `App.jsx`.
- Never move an existing route out of `App.jsx` to tidy; the tests that pin it
  read `App.jsx` by path.
- A module declares routes and nothing else: no page bodies, no data, no
  context providers. Pages live under `frontend/src/pages/`.
- A lazy component name means one page across `App.jsx` and every module:
  `admin_route_reachability` maps a route's component name to the file whose
  links it walks, in one table, so `const SettingsPage = lazy(…)` in a module
  must not name a different page than `App.jsx`'s `SettingsPage`. The guard
  fails on a collision and names both files; pick a name that says which
  page it is (`AdminSettingsPage`).
- The catch-all `*` route stays last in `App.jsx`; the module block sits
  above it, so no module's `order` can put a route below it.

## The modules

| Module | Area |
| --- | --- |
| `learning.jsx` | The Learning center (D562): every `/learning` route. |
| `portfolio.jsx` | Portfolio's canonical addresses (D1413, #3696): `/c/<company>[/p/<project>]` and `/p/<project>`, resolved and opened under Account › Portfolio. |
| `team.jsx` | Team (D1497, #3727): a company's Team, a project's Team in or out of a company, and Project settings › General. |
