/**
 * The Workspaces launcher is retired; its 28 pages live in the profile
 * sidebars (D563, #1164).
 *
 * S1's decision A: the profile sidebars keep the rows their approved canvases
 * draw. Each kept page joins the `match` of the row that owns it, so it lights
 * that row, and the row's overview links it in an "Also in" list. The command
 * palette still indexes all 28 on an admin shell, and every page keeps its
 * route. One page redirects, and only a founder: `/liquidity`, which is the
 * same `LiquidityPage` that `/raise/liquidity?mode=workspace` renders.
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

test('the mapping covers exactly the 28 pages, and every line names a profile, a row and a door', () => {
  assert.deepEqual(Object.keys(PAGE_HOMES).sort(), WORKSPACES.map((w) => w.route).sort());
  assert.equal(WORKSPACES.length, 28);
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
    ['/portfolio/risk-matrix', '/capital', '/liquidity', '/portfolio/reserves', '/portfolio/waterfall', '/watchlist']);
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

test('the one retired page redirects a founder to the zone that replaced it, and no one else', () => {
  const block = routeBlock(APP, '/liquidity');
  assert.match(block, /effectiveRole === 'founder' \? <Navigate replace to=\{\{ pathname: '\/raise\/liquidity', search: `\?\$\{liquidityParams\}`, hash: location\.hash \}\} \/>/);
  // The query and the hash travel, as D422's redirects do; only `mode` is set.
  assert.match(APP, /const liquidityParams = new URLSearchParams\(location\.search\);\n\s*liquidityParams\.set\('mode', 'workspace'\);/,
    'the redirect must keep the query it arrived with and set mode=workspace');
  assert.match(block, /: <FounderWorkspaceTabs set="raise" user=\{user\}><LiquidityPage currentUser=\{user\} \/><\/FounderWorkspaceTabs>/,
    'a partner or investor no longer lands on /liquidity');
  assert.ok(guardRoles('/raise/liquidity').includes('founder'), 'the redirect lands on a route the founder cannot open');
  assert.match(routeBlock(APP, '/raise/liquidity'), /get\('mode'\) === 'workspace'\s*\?[^:]*<LiquidityPage/,
    '/raise/liquidity?mode=workspace no longer renders LiquidityPage');
  // The founder's Raise row no longer claims a path a founder cannot render.
  const raise = rowsOf('founder').find((r) => r.label === 'Raise');
  assert.ok(!raise.match.includes('/liquidity'), 'founder Raise still matches /liquidity');
  assert.ok(lights(raise, '/raise/liquidity'), 'founder Raise does not light the redirect target');
  // The Raise tab bar lights Liquidity on the address the founder lands on.
  const tabs = read('frontend/src/pages/founder/FounderWorkspaceTabs.jsx');
  assert.match(tabs, /to: '\/liquidity', label: 'Liquidity', icon: TrendingUp, match: \['\/liquidity', '\/raise\/liquidity'\]/);
  assert.match(tabs, /tabs\.map\(\(\{ to, label, icon, match \}\) => \(\{ to, label, icon, match \}\)\)/,
    'FounderWorkspaceTabs drops a tab\'s match before WorkspaceTabs sees it');
});

test('no launcher: the component is gone and nothing in the header renders it', () => {
  assert.ok(!existsSync(resolve(root, 'frontend/src/components/WorkspacesLauncher.jsx')));
  assert.doesNotMatch(APP, /WorkspacesLauncher/);
  assert.doesNotMatch(APP, /data-testid="workspaces-launcher"/);
});
