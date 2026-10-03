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
