import { actual, checks } from './_founder_tool_checks.mjs';
/**
 * The Workspaces launcher is retired; its 28 pages live in the profile
 * sidebars (D563, #1164).
 *
 * S1's decision A: the profile sidebars keep the rows their approved canvases
 * draw. Each kept page joins the `match` of the row that owns it, so it lights
 * that row, and the row's overview links it in an "Also in" list. The command
 * palette still indexes them on an admin shell, and every page keeps its
 * route. `/liquidity` redirected a founder to `/raise/liquidity`; the owner
 * removed both on 2026-10-20, with five more of the pages.
 *
 * `PAGE_HOMES` in `lib/adminPlacement.js` is the mapping. This file checks
 * every line of it against the three things that make it true: the route's
 * guard in App.jsx, the row's `match` in `sidebarConfig.js` (read the way
 * SidebarNav reads it), and the overview that draws the link.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { WORKSPACES, PAGE_HOMES, alsoInFor } from '../src/lib/adminPlacement.js';
import { bucketsFor } from '../src/workspaces/shellConfig.js';
import { routeBlock } from './_routes.mjs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AlsoIn from '../src/workspaces/AlsoIn.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');

const PROFILES = ['founder', 'investor', 'partner', 'advisor'];
const DOORS = ['row', 'also', 'lab'];

/** The roles a route's guard names, and whether `labRoles(...)` widens it. */
function guard(path) {
  const block = routeBlock(APP, path);
  assert.ok(block, `${path} is not routed in App.jsx`);
  const m = /guard\((labRoles\()?\[([^\]]*)\]/.exec(block);
  assert.ok(m, `${path} has no guard list`);
  return { roles: m[2].match(/'([^']+)'/g).map((s) => s.slice(1, -1)), lab: Boolean(m[1]) };
}
const guardRoles = (path) => guard(path).roles;

/** Every sidebar row of a profile. */
const rowsOf = (role) => SIDEBAR_GROUPS[role].flatMap((g) => g.items || []);

/** SidebarNav's rule: a `match` list is the row's whole claim; no list means `to` exactly. */
function lights(row, path) {
  if (path === row.to) return true;
  if (!Array.isArray(row.match)) return false;
  return row.match.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Where each "also" row's overview draws its list. The founder cycle rows are
 * one page, `CycleRoute.jsx` (D661, #1474), whose overview draws the list for
 * the cycle it is mounted for, under the cycle's own name.
 */
const CYCLE_ROUTE = 'frontend/src/pages/cycles/CycleRoute.jsx';
const DESK = {
  'founder|Validate': CYCLE_ROUTE,
  'founder|Raise': CYCLE_ROUTE,
  'founder|Grow': CYCLE_ROUTE,
  'investor|Portfolio': 'frontend/src/pages/investor/InvestorPortfolioCanvas.jsx',
};
// Every other row is a bucket root, which renders BucketBoard or, with no
// board registered, BucketOverview. Both draw the list for their own bucket.
const BUCKET_BODIES = ['frontend/src/workspaces/BucketBoard.jsx', 'frontend/src/workspaces/BucketOverview.jsx'];

test('the mapping covers exactly the 15 pages, and every line names a profile, a row and a door', () => {
  assert.deepEqual(Object.keys(PAGE_HOMES).sort(), WORKSPACES.map((w) => w.route).sort());
  // 28 until D670 retired Market Intelligence and Signals; 26 until the owner
  // removed Scoring, Risk Matrix, Capital, Liquidity, Reserves and Watchlist
  // (2026-10-20); 20 until #2324 removed Network Effects (#2297 §3); 19 until
  // the owner removed Advisory, Portfolio Coverage, Service Catalogue and Needs Board
  // (2026-10-21, #2341, #2337 and #2338).
  assert.equal(WORKSPACES.length, 15);
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    assert.ok(homes.length > 0, `${route} has no home`);
    for (const [role, row, door] of homes) {
      assert.ok(PROFILES.includes(role), `${route}: ${role} is not a profile`);
      assert.ok(DOORS.includes(door), `${route}: door ${door}`);
      assert.ok(rowsOf(role).some((r) => r.label === row), `${route}: ${role} has no ${row} row`);
    }
  }
});

test('every home is a role the route\'s guard admits', () => {
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    const { roles, lab } = guard(route);
    for (const [role, row, door] of homes) {
      // `labRoles` adds the viewer's own role when their Lab is active, so a
      // Lab page admits a Lab member of any profile, and only the Lab door
      // may rely on that.
      const admitted = roles.includes(role) || (door === 'lab' && lab);
      assert.ok(admitted, `${route} is homed on ${role} · ${row}, but its guard admits ${roles.join(', ')}${lab ? ' and Lab members' : ''}`);
    }
  }
});

test('every kept page lights its sidebar row', () => {
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    for (const [role, label, door] of homes) {
      const row = rowsOf(role).find((r) => r.label === label);
      assert.ok(lights(row, route), `${route} does not light ${role} · ${label}`);
      if (door === 'also' || door === 'lab') {
        assert.ok(Array.isArray(row.match) && row.match.some((p) => route === p || route.startsWith(`${p}/`)),
          `${route} lights ${role} · ${label} only by accident, not by its match list`);
      }
    }
  }
});

test('one home per page per role: no route lights two rows of the same profile', () => {
  for (const role of PROFILES) {
    for (const { route } of WORKSPACES) {
      const lit = rowsOf(role).filter((r) => lights(r, route)).map((r) => r.label);
      assert.ok(lit.length <= 1, `${route} lights ${lit.join(' and ')} for ${role}`);
    }
  }
});

test('every "also" page is linked from its row\'s overview', () => {
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    for (const [role, row, door] of homes) {
      if (door !== 'also') continue;
      assert.ok(alsoInFor(role, row).some((w) => w.route === route), `${route} is missing from ${role} · ${row}'s Also in list`);
      const desk = DESK[`${role}|${row}`];
      if (desk === CYCLE_ROUTE) {
        assert.match(read(desk), /<AlsoIn role="founder" row=\{name\} \/>/, `${desk} does not draw the cycle's Also in list`);
        assert.match(read('frontend/src/pages/cycles/cycleModel.js'), new RegExp(`name: '${row}'`), `no cycle is named ${row}`);
      } else if (desk) {
        assert.match(read(desk), new RegExp(`<AlsoIn role="${role}" row="${row}" />`), `${desk} does not draw ${row}'s Also in list`);
      } else {
        assert.ok(bucketsFor(role).some((b) => b.label === row), `${role} · ${row} is neither a desk nor a bucket root`);
      }
    }
  }
  for (const f of BUCKET_BODIES) {
    assert.match(read(f), /<AlsoIn role=\{role\} row=\{bucket\.label\} \/>/, `${f} no longer draws the bucket's Also in list`);
  }
});

test('the Also in list draws exactly the "also" pages, and a row with none draws nothing', () => {
  assert.deepEqual(alsoInFor('investor', 'Portfolio').map((w) => w.route),
    ['/portfolio/waterfall']);
  assert.deepEqual(alsoInFor('founder', 'Raise').map((w) => w.route),
    ['/legal-capital', '/incorporate', '/compliance', '/incorporate/cofounder-agreement']);
  // `row` doors are the row itself; they are not listed under it.
  assert.ok(!alsoInFor('partner', 'Pipeline').some((w) => w.route === '/pipeline'));
  assert.deepEqual(alsoInFor('investor', 'Trust'), []);
  const comp = read('frontend/src/workspaces/AlsoIn.jsx');
  assert.match(comp, /if \(!pages\.length\) return null;/);
  assert.match(comp, /<Link to=\{p\.route\}/);
});

test('the rendered Also in list links exactly the row\'s "also" pages, in order', () => {
  // Rendered, not read: a swapped argument (`alsoInFor(row, role)`) empties
  // every list while every source-text check above still passes.
  for (const [role, row] of [['investor', 'Portfolio'], ['founder', 'Raise']]) {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(AlsoIn, { role, row })));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, alsoInFor(role, row).map((w) => w.route), `${role} · ${row} renders the wrong links`);
    assert.ok(hrefs.length > 0, `${role} · ${row} renders no list`);
  }
  assert.equal(renderToStaticMarkup(h(MemoryRouter, null, h(AlsoIn, { role: 'investor', row: 'Trust' }))), '',
    'a row with no "also" page draws nothing');
});

test('a "row" door is the row itself: the row opens that page', () => {
  // Reclassifying an "also" page as a "row" door drops it from the Also in
  // list; this is what makes that a failure rather than a silent loss.
  const ALIAS = { '/portfolio/health': '/portfolio' };
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    for (const [role, label, door] of homes) {
      if (door !== 'row') continue;
      const row = rowsOf(role).find((r) => r.label === label);
      assert.equal(row.to, ALIAS[route] ?? route, `${route} is a row door of ${role} · ${label}, whose row opens ${row.to}`);
    }
  }
});

test('the Lab page is linked from the Lab\'s own arsenal', () => {
  const arsenal = read('frontend/src/lib/spinoutLabArsenal.js');
  for (const [route, homes] of Object.entries(PAGE_HOMES)) {
    if (!homes.some(([, , door]) => door === 'lab')) continue;
    assert.match(arsenal, new RegExp(`route: '${route}'`), `${route} is not in the Lab's arsenal`);
  }
});

test('the removed pages have no route, no row match and no Also in entry (owner, 2026-10-20)', () => {
  const GONE = ['/scoring', '/portfolio/risk-matrix', '/capital', '/liquidity', '/raise/liquidity', '/portfolio/reserves', '/watchlist', '/watchlist/:uid', '/lp-reports', '/funds/accounting'];
  // Network Effects has a compatibility redirect, pinned by network_effects_removed_2324.
  for (const route of GONE) {
    assert.equal(routeBlock(APP, route), null, `${route} is still a route`);
    assert.ok(!(route in PAGE_HOMES), `${route} still has a home`);
  }
  assert.doesNotMatch(APP, /LiquidityPage|liquidityParams/, 'the Liquidity page or its redirect is still wired');
  for (const role of ['founder', 'investor', 'partner']) {
    for (const r of rowsOf(role)) {
      for (const route of GONE) assert.ok(!(r.match || []).includes(route), `${role} ${r.label} still matches ${route}`);
    }
  }
  // The editors still return to their modules.
  checks.returns(actual);
});

test('the pages removed on 2026-10-21 only forward, and no row or Also in names them (#2337, #2338)', () => {
  // Unlike the 2026-10-20 removals these keep their address, as a redirect the
  // inventory counts (#2301) until #2319 retires it.
  const FORWARDS = {
    '/portfolio/coverage': /<Navigate to="\/delivery\/health" replace \/>/,
    '/services': /<MarketplaceRedirect role=\{user\?\.role\} founderTab="services" to="\/offers\/catalog" \/>/,
    '/needs': /<MarketplaceRedirect role=\{user\?\.role\} founderTab="needs" to="\/pipeline\/leads" \/>/,
  };
  for (const [route, forward] of Object.entries(FORWARDS)) {
    const block = routeBlock(APP, route);
    assert.ok(block, `${route} lost its redirect`);
    assert.match(block, forward, `${route} renders something other than its forward`);
    assert.ok(!(route in PAGE_HOMES), `${route} still has a home`);
    for (const role of ['founder', 'investor', 'partner']) {
      for (const r of rowsOf(role)) assert.ok(!(r.match || []).includes(route), `${role} ${r.label} still matches ${route}`);
    }
  }
});

test('no launcher: the component is gone and nothing in the header renders it', () => {
  assert.ok(!existsSync(resolve(root, 'frontend/src/components/WorkspacesLauncher.jsx')));
  assert.doesNotMatch(APP, /WorkspacesLauncher/);
  assert.doesNotMatch(APP, /data-testid="workspaces-launcher"/);
});
