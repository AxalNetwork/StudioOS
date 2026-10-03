/**
 * D528 — a new area's routes live in `frontend/src/routes/<area>.jsx`, and
 * the whole-app route tests see them as if they were in `App.jsx`.
 *
 * `App.jsx` holds every route and changed in 109 of the last 624 commits; any
 * two PRs that add a page collide in it. D528 moves NEW routes into modules
 * that `App.jsx` composes in one block, and keeps the existing routes where
 * 156 tests read them. Two things can fail quietly, and this file pins both:
 *
 *   - A module that exists and is not wired in: a page nobody can open, and a
 *     route table that `App.jsx` and the module disagree about.
 *     `missingRouteModules()` reports it, on the real tree and on a fixture
 *     tree where one module is deliberately left out.
 *   - A route in a module that the whole-app tests cannot see. They read
 *     `readRoutesSource()`, which is `App.jsx` plus every module; on the
 *     fixture tree the module's route parses exactly like `App.jsx`'s own,
 *     through the same `<Route`-split and `path="…"` readers those tests use.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/routes_modules_d528.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { routeBlock } from './_routes.mjs';
import {
  APP_PATH, ROUTES_DIR, readRoutesSource, routeModuleFiles, routeModuleExport, missingRouteModules,
} from './_routesSource.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const FIXTURE = resolve(process.cwd(), 'frontend/test/fixtures/routes_modules');
const APP = read(APP_PATH);

/** The `path="…"` of every `<Route>` in a source, the way the whole-app tests read them. */
const routePaths = (src) => [...src.split('<Route').slice(1)]
  .map((seg) => /^\s*path="([^"]+)"/.exec(seg)?.[1])
  .filter(Boolean);

/**
 * The import block and the composition block of an App.jsx, each as one
 * string. Both markers of each block must exist, opening before closing: a
 * block with one marker missing would slice to the end of the file and read
 * as "present".
 */
function blocks(src) {
  const bounded = (open, close) => {
    const a = src.indexOf(open);
    const b = src.indexOf(close);
    assert.ok(a >= 0, `${open} marker is missing`);
    assert.ok(b >= 0, `${close} marker is missing`);
    assert.ok(a < b, `${close} comes before ${open}`);
    return src.slice(a, b);
  };
  const imp = bounded('// ── Route modules (D528)', '// ── end route modules');
  const comp = bounded('{/* ── Route modules (D528)', '{/* ── end route modules');
  return { imp, comp };
}

test('App.jsx carries the two blocks, one above the imports and one above the catch-all, and the folder explains itself', () => {
  const { imp, comp } = blocks(APP);
  assert.ok(imp.length > 0, 'the import block is gone');
  assert.ok(comp.length > 0, 'the composition block is gone');
  assert.ok(APP.indexOf('// ── end route modules') < APP.indexOf('{/* ── Route modules (D528)'), 'the import block is not above the composition block');
  // Above the catch-all: a module's routes must be matched before `*`.
  assert.ok(APP.indexOf('{/* ── end route modules') < APP.indexOf('<Route path="*"'), 'the composition block sits below the catch-all');
  assert.ok(APP.indexOf('<Routes>') < APP.indexOf('{/* ── Route modules (D528)'), 'the composition block is outside <Routes>');
  // `routeTools` is what a module is handed, built from this file's own gates.
  // It exists exactly when a module does: declared with none to read it, it is
  // a dead variable (CodeQL flagged the first draft); declared by the first
  // module, it must carry every gate, so a module cannot be gated differently
  // from a route written here.
  const TOOLS = /const routeTools = \{ guard, hqOnly, authOnly, labRoles, effectiveRole, user, location \};/;
  if (routeModuleFiles().length === 0) {
    assert.doesNotMatch(codeOnly(APP), /const routeTools\b/, 'routeTools is declared with no module to read it');
    assert.match(APP, /const routeTools = \{ guard, hqOnly, authOnly, labRoles, effectiveRole, user, location \};/, 'the reserved line no longer says what the first module adds');
  } else {
    assert.match(codeOnly(APP), TOOLS, 'a module exists but routeTools is missing or does not carry every gate');
  }
  assert.ok(existsSync(resolve(process.cwd(), `${ROUTES_DIR}/README.md`)), 'frontend/src/routes/README.md is missing');
  assert.match(read(`${ROUTES_DIR}/README.md`), /readRoutesSource\(\)/, 'the README does not tell a module author how the tests will read it');
  assert.match(read(`${ROUTES_DIR}/README.md`), /Never move an existing route out of `App\.jsx`/);
});

test('every module under frontend/src/routes/ is imported and composed by App.jsx, alphabetically, one line each', () => {
  const missing = missingRouteModules();
  assert.deepEqual(missing, [], `modules that exist and are not wired in: ${JSON.stringify(missing)}`);
  const { imp, comp } = blocks(APP);
  const files = routeModuleFiles();
  const names = files.map(routeModuleExport);
  // One import and one composition line per module, in file-name order.
  const importOrder = [...imp.matchAll(/^import (\w+) from '\.\/routes\/[\w-]+';$/gm)].map((m) => m[1]);
  const composeOrder = [...comp.matchAll(/^\s*\{(\w+)\(routeTools\)\}$/gm)].map((m) => m[1]);
  assert.deepEqual(importOrder, names, 'the import block is not one line per module in file-name order');
  assert.deepEqual(composeOrder, names, 'the composition block is not one line per module in file-name order');
  // Nothing composes a module outside the block: every `{xRoutes(routeTools)}`
  // in the CODE (comments stripped, so the block's own prose does not count)
  // is one of the block's lines.
  const everywhere = [...codeOnly(APP).matchAll(/\{(\w+)\(routeTools\)\}/g)].map((m) => m[1]);
  assert.deepEqual(everywhere, names, 'a module is composed outside the block, or twice');
});

test('a route declared in a module is served: the readers the whole-app tests use see it exactly like an App.jsx route', () => {
  const src = readRoutesSource(FIXTURE);
  const paths = routePaths(src);
  // The fixture has modules, so its App.jsx declares routeTools and hands it over.
  assert.match(codeOnly(readFileSync(resolve(FIXTURE, APP_PATH), 'utf8')), /const routeTools = \{ guard, hqOnly, authOnly \};/, 'the fixture App.jsx no longer declares routeTools');
  assert.ok(paths.includes('/fixture-home'), 'the fixture App.jsx route is not read');
  assert.ok(paths.includes('/fixture-alpha'), 'the route declared in the wired module is invisible to the route reader');
  // The same line-window reader the shell tests use finds the module's guard.
  const alpha = routeBlock(src, '/fixture-alpha');
  assert.ok(alpha, 'routeBlock cannot find the module route');
  assert.match(alpha, /guard\(\['admin'\], <AlphaPage \/>\)/, 'the module route\'s gate is not read as App.jsx\'s would be');
  // The module's source follows App.jsx, with a marker naming the file.
  assert.ok(src.indexOf('path="/fixture-home"') < src.indexOf('// ---- frontend/src/routes/alpha.jsx ----'));
  assert.ok(src.indexOf('// ---- frontend/src/routes/alpha.jsx ----') < src.indexOf('path="/fixture-alpha"'));
  // And the marker is prose to `codeOnly`, so it never reads as code.
  assert.doesNotMatch(codeOnly(src), /---- frontend\/src\/routes\/alpha\.jsx ----/);
  // Reading App.jsx alone, as the tests did before D528, would not see it.
  assert.ok(!routePaths(readFileSync(resolve(FIXTURE, APP_PATH), 'utf8')).includes('/fixture-alpha'));
});

test('a module missing from App.jsx\'s block is reported, with which half is missing', () => {
  const missing = missingRouteModules(FIXTURE);
  assert.deepEqual(missing, [
    { file: 'frontend/src/routes/beta.jsx', name: 'betaRoutes', imported: false, composed: false },
    // Imported and never composed is the quieter half: the import is dead
    // code and the page has no route. It is reported on its own.
    { file: 'frontend/src/routes/gamma.jsx', name: 'gammaRoutes', imported: true, composed: false },
  ]);
  // The unwired module's route is still read (it exists), which is why the
  // wiring check is its own assertion rather than a side effect of parsing.
  assert.ok(routePaths(readRoutesSource(FIXTURE)).includes('/fixture-beta'));
  // The export name follows the file name, hyphens camel-cased.
  assert.equal(routeModuleExport('frontend/src/routes/admin-labs.jsx'), 'adminLabsRoutes');
  assert.equal(routeModuleExport('frontend/src/routes/alpha.jsx'), 'alphaRoutes');
});

test('the whole-app route tests read the helper, not App.jsx alone', () => {
  // Switching a test is one import and one read; this holds the switch for
  // the readers that ask whole-app questions, so a module route is checked
  // like an App.jsx route by each of them.
  const SWITCHED = [
    'admin_route_reachability', 'route_role_zone_contract', 'route_namespace_policy', 'workspace_shell_routes',
    'admin_placement_h35', 'super_admin_shell', 'founder_shell', 'investor_shell', 'advisor_shell', 'partner_shell',
  ];
  for (const t of SWITCHED) {
    const src = codeOnly(read(`frontend/test/${t}.test.mjs`));
    assert.match(src, /from '\.\/_routesSource\.mjs'/, `${t} does not import the helper`);
    assert.match(src, /readRoutesSource\(/, `${t} does not read the route table through the helper`);
    assert.doesNotMatch(src, /App\.jsx'\)/, `${t} still reads App.jsx by itself`);
  }
});
