/**
 * The H35 placement map answers for every legacy admin console (D283).
 *
 * `frontend/src/lib/adminPlacement.js` says where each old sidebar row, each
 * Admin Console tab and the parked X row now lives. This guard holds it to
 * three things it cannot be trusted to say about itself: that it covers the
 * whole legacy set and nothing outside it, that every route it names is
 * registered, and that its `hqOnly` flags restate App.jsx rather than a
 * belief about App.jsx.
 *
 * THE LEGACY ROWS ARE PINNED HERE, NOT READ FROM `SIDEBAR_GROUPS`. D286
 * replaces `SIDEBAR_GROUPS.admin` with S20's eight rows, and the map has to
 * keep answering for the fifty that were there before — reading the live
 * array would make this guard shrink its own question the day the sidebar
 * changes. Fifty routes, copied once, is the question.
 *
 * The tabs ARE read live, from `ADMIN_SECTIONS` in AdminPage.jsx: a tab added
 * there is a new console with no placement, which is exactly what this guard
 * should name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_PLACEMENT, UNPLACED, TIERS, FORMS, HQ_ROWS, ADMIN_ROWS, TOP_BAR,
  X_PARKED_REASON, placedOn, routePath,
} from '../src/lib/adminPlacement.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const ADMIN_PAGE = read('frontend/src/pages/AdminPage.jsx');
const SIDEBAR_RAW = read('frontend/src/sidebarConfig.js');

/* ------------------------------------------------------------------ *
 * The question: the fifty rows, the tabs, and X
 * ------------------------------------------------------------------ */

const LEGACY_ROWS = [
  // home
  '/studio', '/messages',
  // admin
  '/admin', '/admin/due-diligence', '/admin/assessment', '/admin/best-fit', '/admin/events',
  '/admin/jobs', '/admin/circles', '/admin/advisor-cohorts', '/admin/exploring',
  '/admin/lp-applications', '/monitoring', '/admin/telegram', '/admin/articles',
  '/admin/publications', '/admin/partners', '/admin/refer-earn', '/admin/team',
  '/admin/my-licence', '/admin/trash',
  // studio
  '/pipeline', '/scoring', '/portfolio/risk-matrix', '/market-intel', '/signals', '/advisory',
  '/matches', '/deals',
  // capital
  '/capital', '/liquidity', '/portfolio/health', '/portfolio/coverage', '/portfolio/reserves',
  '/portfolio/waterfall', '/watchlist', '/legal-capital', '/incorporate', '/compliance',
  // network
  '/network', '/network-effects', '/my/jobs', '/services', '/needs', '/partner/insights',
  '/partner/office-hours', '/comarketing',
  // more
  '/incorporate/cofounder-agreement', '/spinout-lab/83b', '/perks',
];

/** The tab values, read out of ADMIN_SECTIONS itself rather than assumed. */
const TABS = (() => {
  const start = ADMIN_PAGE.indexOf('const ADMIN_SECTIONS = [');
  const end = ADMIN_PAGE.indexOf('];', start);
  assert.ok(start >= 0 && end > start, 'ADMIN_SECTIONS is no longer where this guard reads it');
  return [...ADMIN_PAGE.slice(start, end).matchAll(/\{ value: '([\w-]+)'/g)].map((m) => m[1]);
})();

/** The parked row is present in the text and commented out — the reachability guard's own reading. */
const X_ROW_PARKED = SIDEBAR_RAW.split('\n').some((l) => /^\s*\/\/\s*\{\s*to: '\/admin\/x'/.test(l));

/* ------------------------------------------------------------------ *
 * App.jsx, read for the two facts the map restates
 * ------------------------------------------------------------------ */

/** path → whether its element is wrapped in `hqOnly(`. */
const ROUTES = new Map();
for (const seg of APP.split('<Route').slice(1)) {
  const p = /^\s*path="([^"]+)"/.exec(seg);
  if (!p) continue;
  const line = seg.slice(0, seg.indexOf('\n'));
  ROUTES.set(p[1], /\bhqOnly\(/.test(line));
}

const KEYS = ADMIN_PLACEMENT.map((e) => e.key);
const byKey = (k) => ADMIN_PLACEMENT.find((e) => e.key === k);
const entryFor = (legacyRoute) => byKey(legacyRoute) || UNPLACED.find((u) => u.key === legacyRoute);

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

test('the question is the size it was measured at', () => {
  // Fifty live rows on the day the map was drawn, fourteen tabs, one parked
  // row. A shorter list here means the guard is asking less than it did.
  assert.equal(LEGACY_ROWS.length, 50);
  assert.equal(new Set(LEGACY_ROWS).size, 50, 'a legacy route is listed twice');
  assert.ok(TABS.length >= 14, `ADMIN_SECTIONS read ${TABS.length} tabs; the map was drawn for 14`);
  assert.ok(X_ROW_PARKED, 'the commented-out /admin/x row is gone from sidebarConfig.js');
  assert.ok(ROUTES.size >= 300, `App.jsx parsed to ${ROUTES.size} routes — the route reader is broken`);
  // The floor, so an empty map cannot pass: rows + tabs + X, minus the
  // recorded exceptions.
  const expected = LEGACY_ROWS.length + TABS.length + 1 - UNPLACED.length;
  assert.equal(ADMIN_PLACEMENT.length, expected,
    `the map holds ${ADMIN_PLACEMENT.length} entries; the question has ${expected}`);
});

test('every legacy row, every tab and X has exactly one placement, or a recorded reason for none', () => {
  // The exception list is pinned by value: a new exception is a decision, and
  // a decision is written here, not appended in the module.
  assert.deepEqual(UNPLACED.map((u) => u.key), ['/admin']);
  for (const u of UNPLACED) {
    assert.ok(u.why && u.why.length > 20, `${u.key} is unplaced without a reason`);
    assert.ok(!byKey(u.key), `${u.key} is both placed and on the exception list`);
  }
  const missing = [];
  for (const route of LEGACY_ROWS) if (!entryFor(route)) missing.push(route);
  for (const value of TABS) if (!byKey(`tab:${value}`)) missing.push(`/admin?tab=${value}`);
  if (!byKey('/admin/x')) missing.push('/admin/x');
  assert.deepEqual(missing, [], 'these legacy consoles have no placement on the map and no recorded exception');
});

test('nothing is placed twice, and nothing outside the legacy set is placed at all', () => {
  const dup = KEYS.filter((k, i) => KEYS.indexOf(k) !== i);
  assert.deepEqual(dup, [], 'these keys appear more than once');
  const routes = ADMIN_PLACEMENT.map((e) => e.route);
  const dupRoute = routes.filter((r, i) => routes.indexOf(r) !== i);
  assert.deepEqual(dupRoute, [], 'these routes are placed under two keys');
  const universe = new Set([...LEGACY_ROWS, '/admin/x', ...TABS.map((t) => `tab:${t}`)]);
  const stray = KEYS.filter((k) => !universe.has(k));
  assert.deepEqual(stray, [], 'these entries answer for a console that was never a legacy row or tab');
  for (const e of ADMIN_PLACEMENT) {
    const seen = new Set([`${e.tier}·${e.row}`]);
    for (const a of e.also || []) {
      const at = `${a.tier}·${a.row}`;
      assert.ok(!seen.has(at), `${e.key} is placed on ${at} twice`);
      seen.add(at);
    }
  }
});

test('every placed route is registered in App.jsx, and every ?tab= is a section', () => {
  const unregistered = [];
  for (const e of [...ADMIN_PLACEMENT, ...UNPLACED]) {
    if (!ROUTES.has(routePath(e.route))) unregistered.push(`${e.key} → ${e.route}`);
  }
  assert.deepEqual(unregistered, [], 'these placements open a route App.jsx does not register');
  const badTab = [];
  for (const e of ADMIN_PLACEMENT) {
    const q = e.route.split('?')[1];
    if (!q) continue;
    const value = new URLSearchParams(q).get('tab');
    if (!value || !TABS.includes(value)) badTab.push(`${e.key} → ${e.route}`);
    if (e.kind === 'tab') assert.equal(e.tabValue, value, `${e.key} names one tab and links another`);
  }
  assert.deepEqual(badTab, [], 'these placements deep-link a tab ADMIN_SECTIONS does not offer');
});

test('hqOnly restates App.jsx: derived from the hqOnly( wrappers, never believed', () => {
  const disagree = [];
  for (const e of [...ADMIN_PLACEMENT, ...UNPLACED]) {
    const derived = ROUTES.get(routePath(e.route));
    if (e.hqOnly !== derived) disagree.push(`${e.key}: map says ${e.hqOnly}, App.jsx says ${derived}`);
  }
  assert.deepEqual(disagree, [], 'these hqOnly flags disagree with the route table');
  // The derivation itself has teeth: the elevation-only routes read as such.
  assert.equal(ROUTES.get('/admin/licences'), true);
  assert.equal(ROUTES.get('/admin/x'), true);
  assert.equal(ROUTES.get('/monitoring'), false, '/monitoring is guard([admin]) with no elevation — H35 places it on HQ · Platform regardless');
});

test('every placement names a real tier, a real row of that tier, and a real form', () => {
  const rowsOf = { HQ: [...HQ_ROWS, TOP_BAR], Admin: [...ADMIN_ROWS, TOP_BAR] };
  const check = (key, p) => {
    assert.ok(TIERS.includes(p.tier), `${key}: tier ${p.tier}`);
    if (p.tier === 'HQ' || p.tier === 'Admin') {
      assert.ok(rowsOf[p.tier].includes(p.row), `${key}: ${p.tier} has no row ${p.row}`);
      assert.ok(FORMS.includes(p.form) && p.form !== 'launcher', `${key}: form ${p.form} on a shell row`);
      if (p.form === 'top bar') assert.equal(p.row, TOP_BAR, `${key}: a top-bar placement sits on the top bar, not a row`);
      else assert.notEqual(p.row, TOP_BAR, `${key}: the top bar takes buttons, not a ${p.form}`);
    }
    if (p.tier === 'launcher') assert.deepEqual([p.row, p.form], [null, 'launcher'], `${key}: a launcher entry has no row`);
    if (p.tier === 'parked') assert.deepEqual([p.row, p.form], [null, null], `${key}: a parked entry is nowhere`);
  };
  for (const e of ADMIN_PLACEMENT) {
    check(e.key, e);
    for (const a of e.also || []) {
      check(`${e.key} (also)`, a);
      assert.ok(a.tier === 'HQ' || a.tier === 'Admin', `${e.key}: a second placement is on a shell`);
    }
    if (e.tier === 'launcher') assert.ok(e.group, `${e.key}: a launcher entry names its group`);
  }
  assert.equal(ADMIN_PLACEMENT.filter((e) => e.tier === 'launcher').length, 29, 'S23 and H37 launch 29 pages');
});

test('the three decided placements hold: Wellbeing, X, Trash', () => {
  // The coordinator's decision, quoted: "Wellbeing goes to Admin · Community."
  const wellbeing = byKey('tab:wellbeing');
  assert.ok(wellbeing, 'Wellbeing has no placement');
  assert.deepEqual([wellbeing.tier, wellbeing.row], ['Admin', 'Community']);
  assert.ok(placedOn('Admin', 'Community').some((e) => e.key === 'tab:wellbeing'));

  // X is parked, in H35's words, and its row stays commented out.
  const x = byKey('/admin/x');
  assert.deepEqual([x.tier, x.row, x.form, x.how], ['parked', null, null, X_PARKED_REASON]);
  assert.ok(!ADMIN_PLACEMENT.some((e) => e.tier !== 'parked' && e.route === '/admin/x'), 'X has been given a home');

  // "The Trash proposal is not adopted: /admin/trash gets a literal door on
  // the Admin Console." Not HQ · Security, and the door is a literal <Link>
  // in AdminPage.jsx — the reachability walk reads exactly that syntax.
  const trash = byKey('/admin/trash');
  assert.equal(trash.tier, 'Admin', 'Trash is placed on the Admin shell, not on HQ · Security');
  assert.ok(!(trash.also || []).some((a) => a.row === 'Security'), 'the Security proposal crept back in as a second placement');
  const header = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('{!section && ('), ADMIN_PAGE.indexOf('<AdminSectionNav'));
  assert.ok(header.includes('<Link to="/admin/trash"'),
    'the Admin Console header no longer carries a literal <Link to="/admin/trash">; the door is gone');
});

test('Messages is a top-bar button on both shells', () => {
  const m = byKey('/messages');
  assert.deepEqual([m.tier, m.row, m.form], ['Admin', TOP_BAR, 'top bar']);
  assert.ok((m.also || []).some((a) => a.tier === 'HQ' && a.row === TOP_BAR && a.form === 'top bar'));
});
