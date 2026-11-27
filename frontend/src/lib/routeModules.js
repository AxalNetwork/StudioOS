/**
 * #4105 — the route modules under `frontend/src/routes/`, collected.
 *
 * `App.jsx` hands this the eager `import.meta.glob('./routes/*.jsx', { eager:
 * true })` and composes what it returns, so a new area's routes are one new
 * file in `routes/` and no edit to `App.jsx`. The glob is eager because React
 * Router needs the `<Route>` elements synchronously; the PAGES stay lazy, since
 * each module declares its own `lazy(() => import('../pages/…'))`, exactly as
 * when `App.jsx` imported the module by name. The node tests run `App.jsx`
 * through `frontend/test/_deck-loader-hook.mjs`, which expands the same glob.
 *
 * Each module default-exports a function of `routeTools` (D528) and may export
 * `order`, a number: modules compose by `order` (0 when absent), then by file
 * name. The catch-all `*` route stays last in `App.jsx`, below them all.
 *
 * Returns `[{ file, name, order, routes }]`, `file` being the module's path
 * relative to `frontend/src` (`routes/learning.jsx`). A module whose default
 * export is not a function, or whose `order` is not a finite number, throws:
 * a route table that silently skips a module is the failure this replaces.
 */
export function collectRouteModules(globbed) {
  const out = [];
  for (const [key, mod] of Object.entries(globbed)) {
    const file = key.replace(/^\.\//, '');
    const stem = file.replace(/^.*\//, '').replace(/\.jsx$/, '');
    if (typeof mod?.default !== 'function') {
      throw new Error(`${file}: a route module default-exports a function of routeTools`);
    }
    const order = mod.order === undefined ? 0 : mod.order;
    if (typeof order !== 'number' || !Number.isFinite(order)) {
      throw new Error(`${file}: \`order\` must be a finite number`);
    }
    out.push({ file, name: stem, order, routes: mod.default });
  }
  return out.sort((a, b) => (a.order - b.order) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
