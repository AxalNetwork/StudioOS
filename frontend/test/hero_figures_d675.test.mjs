/**
 * D675 (#1549), owner 2026-10-12 — the home hero's module count is the
 * platform's own, counted from the registries that serve each module
 * (`frontend/src/lib/siteModules.js`), never typed.
 *
 * Pins:
 *   - every counted route is one App.jsx opens: a zone the shells register, a
 *     cycle module under its cycle's `/:slug` route, or a Spin-Out Lab tool;
 *   - a zone the code renders with no store behind it is left out, unless
 *     another licence backs the same route;
 *   - every Research zone counted is one `ResearchWorkspace` renders live;
 *   - each route is counted once, and the page types no number for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const APP = read('frontend/src/App.jsx');

const { platformModuleRoutes, PLATFORM_MODULE_COUNT } = await import('../src/lib/siteModules.js');
const { MODULES: CYCLE_MODULES } = await import('../src/pages/cycles/modules.js');
const { PLATFORM_LAYERS } = await import('../src/lib/siteFirm.js');
const { bucketsFor, zonePath, ROLES_WITH_SHELL } = await import('../src/workspaces/shellConfig.js');

const ROUTES = platformModuleRoutes();
const routed = (path) => APP.includes(`path="${path}"`);

test('the count is the routes, each once', () => {
  assert.equal(PLATFORM_MODULE_COUNT, ROUTES.length);
  assert.equal(new Set(ROUTES).size, ROUTES.length, 'no route is counted twice');
  const zones = new Set(ROLES_WITH_SHELL.flatMap((r) => bucketsFor(r).flatMap((b) => b.zones.map((z) => zonePath(b, z)))));
  assert.ok(PLATFORM_MODULE_COUNT > zones.size, 'the cycle modules and Lab tools add to the workspace zones');
});

test('every counted route is one the app opens', () => {
  const cycleRoutes = new Set(Object.keys(CYCLE_MODULES).map((c) => `/${c}/:slug`));
  for (const c of cycleRoutes) assert.ok(routed(c), `${c} serves its cycle's modules`);
  for (const r of ROUTES) {
    const cycle = `/${r.split('/')[1]}/:slug`;
    const ok = routed(r) || (r === '/raise/capital-relationships/match' && routed('/raise/:slug/:id')) || (cycleRoutes.has(cycle) && Object.values(CYCLE_MODULES).flat().some((m) => r.endsWith(`/${m.slug}`)));
    assert.ok(ok, `${r} is a route App.jsx opens`);
  }
  for (const layer of PLATFORM_LAYERS) for (const m of layer.mods) assert.ok(ROUTES.includes(m.to), `${m.t} counts`);
});

test('a zone with nothing behind it is not a module', () => {
  // D1424 (#3700) mounted D1597's Visibility read (requests per link, opens),
  // so the zone has a store and counts; profile views stay Not recorded on it.
  assert.ok(ROUTES.includes('/expertise/visibility'), 'Visibility reads D1597 and counts');
  assert.ok(ROUTES.includes('/network/organizations'), 'Organizations counts: the founder, investor and partner licences back it');
});

test('every Research zone counted is one the workspace renders live', () => {
  const src = read('frontend/src/workspaces/ResearchWorkspace.jsx');
  const m = /const LIVE_ZONES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(m, 'ResearchWorkspace keeps its LIVE_ZONES set');
  const live = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  for (const r of ROUTES.filter((x) => x.startsWith('/research/'))) {
    assert.ok(live.has(r.slice('/research/'.length)), `${r} renders live; a zone without a store must leave the count`);
  }
});

test('the page types no module number', () => {
  const src = read('frontend/src/pages/LandingPage.jsx').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /PLATFORM_MODULE_COUNT/);
  assert.doesNotMatch(src, new RegExp(`\\b${PLATFORM_MODULE_COUNT}\\b`), 'the count is derived, never written down');
});

test('D2319: the module count uses live tools instead of retired shell aliases', () => {
  for (const [old, canonical] of [['/raise/capital-match', '/raise/capital-relationships/match'], ['/grow/brand', '/build/brand']]) {
    assert.equal(ROUTES.includes(old), false, old);
    assert.equal(ROUTES.includes(canonical), true, canonical);
    assert.equal(routed(old), false, old);
  }
});

test('D2319: restoring either old counter alias or losing its canonical destination fails, then restoration passes', async () => {
  const source = read('frontend/src/lib/siteModules.js');
  const check = (routes) => {
    for (const [old, canonical] of [['/raise/capital-match', '/raise/capital-relationships/match'], ['/grow/brand', '/build/brand']]) {
      assert.equal(routes.includes(old), false, old);
      assert.equal(routes.includes(canonical), true, canonical);
    }
  };
  check(ROUTES);
  for (const [from, to] of [['/raise/capital-match', '/raise/capital-relationships/match'], ['/grow/brand', '/build/brand']]) {
    for (const wrong of [from, '/missing-canonical-tool']) {
      const original = `'${from}': '${to}'`;
      const mutant = source.replace(original, `'${from}': '${wrong}'`);
      assert.notEqual(mutant, source);
      const resolved = mutant.replace(/from '(\.\.?\/[^']+)'/g,
        (_, spec) => `from '${new URL(spec, new URL('../src/lib/siteModules.js', import.meta.url)).href}'`);
      const changed = await import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
      assert.throws(() => check(changed.platformModuleRoutes()), assert.AssertionError);
      check(ROUTES);
    }
  }
});
