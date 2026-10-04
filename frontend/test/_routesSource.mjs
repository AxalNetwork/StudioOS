/**
 * The route table as one source: `App.jsx` plus every module under
 * `frontend/src/routes/` (D528).
 *
 * WHY. `App.jsx` holds every `<Route>` and 150-odd tests read it by path to
 * ask whole-app questions: is this path registered, which roles does its
 * guard admit, does the admin-route walk reach it. Since D528 a new area's
 * routes live in `frontend/src/routes/<area>.jsx` and `App.jsx` composes the
 * module in one block, so a test that reads `App.jsx` alone would stop seeing
 * those routes and report them as unregistered, unguarded or unreachable. A
 * whole-app route test reads `readRoutesSource()` instead and sees a route in
 * a module exactly as it sees one in `App.jsx`: a module writes its `<Route>`
 * lines in the same shape and at the same indentation, so every parser that
 * splits on `<Route` or scans `path="…"` lines works unchanged.
 *
 * `missingRouteModules()` is the other half: a module that exists but is not
 * imported and composed in `App.jsx`'s block is a page nobody can open and a
 * route table two readers disagree about. `routes_modules_d528.test.mjs`
 * fails on one.
 *
 * `root` defaults to the repository root (the cwd the suite runs from) and is
 * a parameter so the test can point the helper at a fixture tree.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

export const APP_PATH = 'frontend/src/App.jsx';
export const ROUTES_DIR = 'frontend/src/routes';

/** Repo-relative paths of every route module, alphabetical. README.md is not a module. */
export function routeModuleFiles(root = process.cwd()) {
  const dir = resolve(root, ROUTES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.jsx$/.test(e.name))
    .map((e) => `${ROUTES_DIR}/${e.name}`)
    .sort();
}

/**
 * `App.jsx` followed by every module, each introduced by a one-line comment
 * naming its file, so a failing assertion can say where the route lives.
 * Comments are what `codeOnly` strips, so the marker never reads as code.
 */
export function readRoutesSource(root = process.cwd()) {
  const parts = [readFileSync(resolve(root, APP_PATH), 'utf8')];
  for (const file of routeModuleFiles(root)) {
    parts.push(`\n// ---- ${file} ----\n`);
    parts.push(readFileSync(resolve(root, file), 'utf8'));
  }
  return parts.join('');
}

/**
 * Every `const X = lazy(() => import('…'))` across `App.jsx` and the modules,
 * as `{ name, source, target }`: `source` is the file the line is in and
 * `target` the imported page, repo-relative and extension-less. A module's
 * `../pages/…` and `App.jsx`'s `./pages/…` both name a file under
 * `frontend/src`; a module sits one level down.
 */
export function lazyImports(root = process.cwd()) {
  const rows = [];
  for (const source of [APP_PATH, ...routeModuleFiles(root)]) {
    const src = readFileSync(resolve(root, source), 'utf8');
    for (const m of src.matchAll(/const (\w+) = lazy\(\(\) => import\('(\.\.?\/[^']+)'\)\)/g)) {
      const spec = m[2];
      const target = spec.startsWith('../') ? `frontend/src/${spec.slice(3)}` : `frontend/src/${spec.slice(2)}`;
      rows.push({ name: m[1], source, target });
    }
  }
  return rows;
}

/**
 * Lazy component names that two sources declare for DIFFERENT pages. The
 * whole-app readers key a route's page by its component name across
 * `App.jsx` and the modules as one table (`admin_route_reachability` maps a
 * name to the file whose doors it scans), so one name must mean one page;
 * a second declaration of the same name for the same page is a duplicate
 * chunk, not a wrong answer, and is not reported here. Empty when the table
 * is sound.
 */
export function conflictingLazyImports(root = process.cwd()) {
  const byName = new Map();
  for (const row of lazyImports(root)) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }
  const out = [];
  for (const [name, rows] of byName) {
    const targets = new Set(rows.map((r) => r.target));
    if (targets.size > 1) out.push({ name, declared: rows.map(({ source, target }) => ({ source, target })) });
  }
  return out;
}

/** The export a module's file name implies: `admin-labs.jsx` → `adminLabsRoutes`. */
export function routeModuleExport(file) {
  const stem = basename(file, '.jsx');
  const camel = stem.replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase());
  return `${camel}Routes`;
}

/**
 * Modules under `frontend/src/routes/` that `App.jsx` does not both import
 * (`import <name>Routes from './routes/<area>'`) and compose
 * (`{<name>Routes(routeTools)}`). Empty when every module is wired.
 */
export function missingRouteModules(root = process.cwd()) {
  const app = readFileSync(resolve(root, APP_PATH), 'utf8');
  const missing = [];
  for (const file of routeModuleFiles(root)) {
    const name = routeModuleExport(file);
    const stem = basename(file, '.jsx');
    const imported = app.includes(`import ${name} from './routes/${stem}';`);
    const composed = app.includes(`{${name}(routeTools)}`);
    if (!imported || !composed) missing.push({ file, name, imported, composed });
  }
  return missing;
}
