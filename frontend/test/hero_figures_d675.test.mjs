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
    const ok = routed(r) || (cycleRoutes.has(cycle) && Object.values(CYCLE_MODULES).flat().some((m) => r.endsWith(`/${m.slug}`)));
    assert.ok(ok, `${r} is a route App.jsx opens`);
  }
  for (const layer of PLATFORM_LAYERS) for (const m of layer.mods) assert.ok(ROUTES.includes(m.to), `${m.t} counts`);
});

test('a zone with nothing behind it is not a module', () => {
  assert.ok(!ROUTES.includes('/expertise/visibility'), 'the advisor\'s profile-views zone has no store');
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
