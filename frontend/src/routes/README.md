# `frontend/src/routes/` — where a new area registers its routes

`App.jsx` holds every route the app has had so far (409 of them), and any two
PRs that add a page collide there. Measured on `main` from 2 August to 3
October 2026 (624 commits): `App.jsx` changed in 109 of them, and together with
`DECISIONS.md`, `api.js` and the built `docs/` it is where nearly every merge
conflict happens. Since D528 a **new area's routes live here**, one module per
area, and `App.jsx` composes each module in one block. The 409 routes already
in `App.jsx` stay there: 156 tests read that file by path, so moving a route
is a change to the tests that pin it, not a tidy-up.

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

`App.jsx` has one block for route modules, marked `Route modules (D528)`: one
import and one composition line per module, alphabetical by file name. The
**first** module also adds `routeTools` itself, on the line the comment above
`return (` reserves for it, because a declared-but-unread `routeTools` is a
dead variable until a module exists:

```jsx
import adminLabsRoutes from './routes/admin-labs';
…
  const routeTools = { guard, hqOnly, authOnly, labRoles, effectiveRole, user, location };
…
      {adminLabsRoutes(routeTools)}
```

`frontend/test/routes_modules_d528.test.mjs` fails the build for a module that
exists here and is not both imported and composed, and for a block that is out
of alphabetical order.

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
- The catch-all `*` route stays last in `App.jsx`; the block sits above it.
