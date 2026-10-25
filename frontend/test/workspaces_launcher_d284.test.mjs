/**
 * One Messages button, and a palette that indexes what the map places (D284,
 * tasks 420 and 408), with the Workspaces launcher retired (D563).
 *
 * The 29 working pages (26 since AI Matches went, and Market Intelligence and
 * Signals with D670; 20 since the owner removed six on 2026-10-20; 15 since
 * #2324, #2341, #2337 and #2338 removed five more) left
 * `SIDEBAR_GROUPS.admin`
 * for a top-bar launcher (D284); D563 retired that launcher, and each page now
 * lights a profile sidebar row (`workspaces_retired_d563.test.mjs`). Messages
 * left the admin sidebar for a top-bar button on both admin shells; and ⌘K for
 * an admin shell indexes the shell's own rows, the consoles H35 places and the
 * 18 — never the old 50-row sidebar, never an `hqOnly` route for someone
 * without the elevation, never the parked X. The list the palette reads is
 * `WORKSPACES` in `lib/adminPlacement.js`; the palette's index is
 * `lib/paletteIndex.js`, pure, so this file puts a holder, a plain admin and a
 * founder through it rather than reading the component.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { WORKSPACES, WORKSPACE_GROUP_ORDER, ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import {
  pageItemsFor, sidebarPageItems, groupByKind, KIND_ORDER, ADMIN_SHELLS, MESSAGES_ROLES,
} from '../src/lib/paletteIndex.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const PALETTE = read('frontend/src/components/CommandPalette.jsx');

/** path → hqOnly, read off every <Route> line. */
const ROUTES = new Map();
for (const seg of APP.split('<Route').slice(1)) {
  const p = /^\s*path="([^"]+)"/.exec(seg);
  if (!p) continue;
  ROUTES.set(p[1], /\bhqOnly\(/.test(seg.slice(0, seg.indexOf('\n'))));
}
const pathOf = (to) => to.split('?')[0].split('#')[0];
const registered = (to) => ROUTES.has(pathOf(to));

/** App.jsx outside <Routes>: the chrome. */
const CHROME = APP.slice(0, APP.indexOf('<Routes')) + APP.slice(APP.indexOf('</Routes>'));

/* ------------------------------------------------------------------ *
 * The 29
 * ------------------------------------------------------------------ */

// S23 / H37: group, label, route. Pinned because it IS the spec; the
// descriptions are checked for presence, not restated.
const CANVAS = [
  ['Studio', 'Pipeline Board', '/pipeline'],
  // Scoring Engine (/scoring) and Risk Matrix (/portfolio/risk-matrix) stood
  // here; the owner removed both pages on 2026-10-20.
  // ['Studio', 'Market Intelligence', '/market-intel'] and ['Studio', 'Signals',
  // '/signals'] stood here; D670 retired both pages.
  // ['Studio', 'Advisory', '/advisory'] stood here; the owner removed it
  // (#2341) and the address forwards to Team › Advisors.
  // ['Studio', 'AI Matches', '/matches'] stood here; that page was deleted.
  ['Studio', 'Deal Flow', '/deals'],
  // Capital & Investment, Liquidity & Exits, Reserve Allocation and Watchlist
  // & Journal stood in this group; the owner removed them on 2026-10-20.
  // Portfolio Coverage, Service Catalogue and Needs Board stood here; the owner
  // removed them on 2026-10-21 (#2337, #2338).
  ['Capital & Legal', 'Portfolio Health', '/portfolio/health'],
  ['Capital & Legal', 'Exit Waterfall', '/portfolio/waterfall'],
  // ['Capital & Legal', 'Legal & Capital', '/legal-capital'] stood here; the
  // owner removed it (#2354) and the address forwards to Raise › Legal.
  ['Capital & Legal', 'Incorporate', '/incorporate'], ['Capital & Legal', 'Compliance Calendar', '/compliance'],
  // Network Effects stood here; #2324 removed the page (#2297 §3).
  ['Network & Growth', 'Network', '/network'],
  ['Network & Growth', 'Jobs', '/my/jobs'], ['Network & Growth', 'Demand Insights', '/partner/insights'],
  ['Network & Growth', 'Partner Office Hours', '/partner/office-hours'], ['Network & Growth', 'Co-Marketing Review', '/comarketing'],
  ['More', 'Co-Founder Agreement', '/incorporate/cofounder-agreement'], ['More', '83(b) Tracker', '/spinout-lab/83b'],
  ['More', 'Perks', '/perks'],
];

test('the palette list is the canvas list less the retired and removed pages: 14 pages in four groups, every one a registered route', () => {
  assert.deepEqual(WORKSPACES.map((w) => [w.group, w.label, w.route]), CANVAS);
  assert.deepEqual(WORKSPACE_GROUP_ORDER, ['Studio', 'Capital & Legal', 'Network & Growth', 'More']);
  assert.deepEqual(WORKSPACE_GROUP_ORDER.map((g) => [g, WORKSPACES.filter((w) => w.group === g).length]),
    [['Studio', 2], ['Capital & Legal', 4], ['Network & Growth', 5], ['More', 3]]);
  for (const w of WORKSPACES) {
    assert.ok(w.description && w.description.endsWith('.'), `${w.route} has no description`);
    assert.ok(registered(w.route), `palette route ${w.route} is not registered in App.jsx`);
  }
  // One list: the entries are the map's palette tier, nothing else.
  assert.equal(ADMIN_PLACEMENT.filter((e) => e.tier === 'palette').length, WORKSPACES.length);
});

test('no page is labelled as an AI advisor, and the three founder redirects still apply only to a founder', () => {
  // The voice rule: the model is Eadwyn, never an advisor. H37's "AI Advisory
  // Suite" went with the launcher (D563).
  assert.ok(!WORKSPACES.some((w) => /\bAI Advis/i.test(w.label)), 'a page is labelled as an AI advisor again');
  const jobs = APP.split('\n').find((l) => l.includes('path="/my/jobs"'));
  assert.ok(jobs, '/my/jobs is not routed');
  assert.match(jobs, /user\?\.role === 'founder' \? <Navigate/, '/my/jobs no longer redirects only a founder');
  // #2338: /services and /needs are removed and forward everyone, but only a
  // founder still lands on the founder marketplace's tab.
  for (const [path, tab] of [['/services', 'services'], ['/needs', 'needs']]) {
    const line = APP.split('\n').find((l) => l.includes(`path="${path}"`));
    assert.ok(line, `${path} is not routed`);
    assert.match(line, new RegExp(`<MarketplaceRedirect role=\\{user\\?\\.role\\} founderTab="${tab}"`), `${path} no longer sends a founder to their tab`);
  }
  assert.match(APP, /function MarketplaceRedirect\(\{ role, founderTab, to \}\) \{[\s\S]{0,80}?if \(role === 'founder'\) return <Navigate to=\{`\/build\/marketplace\?tab=\$\{founderTab\}`\} replace \/>;/,
    'the founder branch of the marketplace redirect is gone');
});

/* ------------------------------------------------------------------ *
 * The sidebar and the top bar
 * ------------------------------------------------------------------ */

test('the 29 rows and Messages have left the admin sidebar, and a workspace page lights no row', () => {
  const rows = SIDEBAR_GROUPS.admin.flatMap((g) => g.items || []);
  const routes = new Set(WORKSPACES.map((w) => w.route));
  const still = rows.filter((r) => routes.has(r.to) || r.to === '/messages').map((r) => r.to);
  assert.deepEqual(still, [], 'these rows are back in SIDEBAR_GROUPS.admin');
  const keys = SIDEBAR_GROUPS.admin.map((g) => g.key);
  for (const k of ['studio', 'capital', 'network', 'more']) assert.ok(!keys.includes(k), `the ${k} group is back`);
  const lit = rows.filter((r) => (r.match || []).some((m) => routes.has(m))).map((r) => r.to);
  assert.deepEqual(lit, [], 'these admin rows light on a workspace page');
});

test('no Workspaces launcher is mounted (D563), and Messages is offered to exactly the roles /messages admits', () => {
  assert.deepEqual(ADMIN_SHELLS, ['admin', 'super_admin']);
  assert.doesNotMatch(CHROME, /WorkspacesLauncher/, 'App.jsx mounts the Workspaces launcher again');
  assert.doesNotMatch(APP, /from '\.\/components\/WorkspacesLauncher'/, 'App.jsx imports the launcher again');
  assert.ok(!existsSync(resolve(root, 'frontend/src/components/WorkspacesLauncher.jsx')), 'the launcher component is back');
  assert.match(CHROME, /MESSAGES_ROLES\.includes\(activeRole\) && \(\s*<Link\s+to="\/messages"/,
    'App.jsx no longer offers the Messages button by role');
  const route = APP.split('\n').find((l) => l.includes('path="/messages"'));
  const admits = /guard\(\[([^\]]+)\]/.exec(route)[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
  assert.deepEqual(MESSAGES_ROLES, admits, 'the Messages button and the /messages guard name different roles');
});

/* ------------------------------------------------------------------ *
 * The palette
 * ------------------------------------------------------------------ */

const holder = { role: 'admin', is_super_admin: 1 };
const plain = { role: 'admin' };
const byTo = (items) => new Map(items.map((i) => [i.to, i]));

test('a holder in the HQ shell indexes the eleven rows, the placed consoles and the 29, at their real routes', () => {
  const items = pageItemsFor({ role: 'admin', shellRole: 'super_admin', user: holder, superAdmin: true });
  const m = byTo(items);
  for (const g of SIDEBAR_GROUPS.super_admin) for (const it of g.items) {
    assert.ok(m.has(it.to), `HQ row ${it.label} is not indexed`);
  }
  for (const w of WORKSPACES) assert.equal(m.get(w.route)?.hint, `Workspaces · ${w.group}`, `${w.route} is not indexed as a workspace`);
  assert.ok(m.has('/admin/wellbeing'), 'Wellbeing has a home, so it is indexed');
  assert.ok(m.has('/admin/telegram'), 'a holder is offered the hqOnly console');
  assert.ok(!m.has('/admin/x'), 'the parked X is indexed');
  // Real routes: only the Home row goes to /hq, because /hq is Home.
  assert.deepEqual(items.filter((i) => i.to === '/hq').map((i) => i.label), ['Home']);
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'an entry is indexed twice');
  const dangling = items.filter((i) => !registered(i.to)).map((i) => i.to);
  assert.deepEqual(dangling, [], 'these palette entries open no registered route');
});

test('a plain admin is never offered an hqOnly route, and still gets the 29 and Wellbeing', () => {
  const items = pageItemsFor({ role: 'admin', shellRole: 'admin', user: plain, superAdmin: false });
  const m = byTo(items);
  const elevated = items.filter((i) => ROUTES.get(pathOf(i.to)) === true).map((i) => i.to);
  assert.deepEqual(elevated, [], 'these hqOnly routes are offered to an admin without the elevation');
  for (const w of WORKSPACES) assert.ok(m.has(w.route), `${w.route} is not indexed for a plain admin`);
  assert.ok(m.has('/admin/wellbeing'));
  assert.ok(!m.has('/admin/x'));
  // The shell's own rows are there too — except a row that points at an
  // hqOnly route (Telegram, whose row ends at a notice for a plain admin).
  for (const g of SIDEBAR_GROUPS.admin) for (const it of g.items) {
    if (ROUTES.get(pathOf(it.to)) === true) assert.ok(!m.has(it.to), `${it.to} is hqOnly and was offered`);
    else assert.ok(m.has(it.to), `${it.to} is not indexed`);
  }
});

test('the other shells index their own sidebar, as before', () => {
  const founder = { role: 'founder', subscription_tier: 'studio' };
  const items = pageItemsFor({ role: 'founder', shellRole: 'founder', user: founder });
  assert.deepEqual(items, sidebarPageItems('founder', founder));
  assert.deepEqual(items.map((i) => i.to), SIDEBAR_GROUPS.founder.flatMap((g) => g.items.map((it) => it.to)));
  assert.ok(!items.some((i) => i.hint.startsWith('Workspaces')), 'a founder was given the admin shells\' page list');
});

test('an article result renders: every indexed kind has a bucket, in order', () => {
  assert.deepEqual(KIND_ORDER, ['page', 'action', 'article', 'activity', 'doc']);
  const grouped = groupByKind([
    { id: 'a', kind: 'article', label: 'An article', to: '/articles/x' },
    { id: 'p', kind: 'page', label: 'A page', to: '/studio' },
  ]);
  assert.deepEqual(Object.keys(grouped), KIND_ORDER);
  assert.equal(grouped.article.length, 1, 'the article bucket is gone, so an article result is dropped before it renders');
  const flat = KIND_ORDER.flatMap((k) => grouped[k]);
  assert.deepEqual(flat.map((i) => i.id), ['p', 'a']);
  assert.match(PALETTE, /groupByKind\(matched\)/, 'the palette groups by hand again');
});

test('the palette reads the index, not the sidebar', () => {
  assert.match(PALETTE, /pageItemsFor\(\{ role: r, shellRole, user, superAdmin: isSuperAdminUser\(user\) \}\)/,
    'CommandPalette no longer asks the index for its pages');
  assert.doesNotMatch(PALETTE, /SIDEBAR_GROUPS/, 'CommandPalette reads SIDEBAR_GROUPS[role] again');
});
