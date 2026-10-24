/**
 * The H36 strips, a row that stays lit on `?tab=`, and a tab that follows the
 * URL (D285, task 422).
 *
 * Three things were true before: SidebarNav lit a row from the pathname
 * alone, so following /admin?tab=integration-keys from Platform lit nothing;
 * AdminPage read `?tab=` once and never wrote back, so a second strip link
 * while the page was mounted changed nothing; and no strip existed. This
 * file pins the strips to H36 in both places they live (the lib list the
 * highlight reads, and the literal links the shell renders — the second so
 * the reachability walk can see `/admin/team`), the query-aware row, the
 * write-back, the `section` override, and the phone rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { HQ_STRIPS, HQ_ROW_ROUTE, hqRowFor, stripFor, stripItemFor } from '../src/lib/hqStrips.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const CHROME = APP.slice(0, APP.indexOf('<Routes')) + APP.slice(APP.indexOf('</Routes>'));
const STRIP = codeOnly(read('frontend/src/components/HqSubNavStrip.jsx'));
const SIDEBAR_NAV = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));

/** path → registered, read off every <Route> line. */
const ROUTES = new Set();
for (const seg of APP.split('<Route').slice(1)) {
  const p = /^\s*path="([^"]+)"/.exec(seg);
  if (p) ROUTES.add(p[1]);
}
const pathOf = (to) => to.split('?')[0].split('#')[0];


// H36, verbatim.
const PLATFORM = [
  ['Overview', '/admin/platform'], ['Switches', '/admin/platform/switches'], ['Topology', '/admin/platform/topology'],
  ['Integration keys', '/admin?tab=integration-keys'], ['GitHub Sync', '/admin?tab=github'], ['Payments', '/admin/platform/payments'],
  ['Promo codes', '/admin?tab=promos'], ['Monitoring', '/monitoring'], ['Telegram', '/admin/telegram'],
];
// D642 (#1435) — U7's page joins the Platform row after Topology, so it lights that row.
PLATFORM.splice(3, 0, ['AI allowances', '/admin/platform/allowances']);
// D791 part 2 (#2216) — HQ › AI usage joins the Platform row after AI allowances.
PLATFORM.splice(4, 0, ['AI usage', '/admin/platform/ai-usage']);
// D708 (#1773) — the Bank accounts console joins the Platform row after Payments.
PLATFORM.splice(PLATFORM.findIndex(([l]) => l === 'Payments') + 1, 0, ['Bank accounts', '/admin?tab=bank-accounts']);
// The owner's ruling (2026-10-20) — Integration keys and GitHub Sync leave the
// strip for an HQ row of their own, `/admin/integration-keys`.
PLATFORM.splice(PLATFORM.findIndex(([l]) => l === 'Integration keys'), 2);
// D815 (#2261) — HQ › Product testing joins the Platform row after Bank accounts.
PLATFORM.splice(PLATFORM.findIndex(([l]) => l === 'Bank accounts') + 1, 0, ['Product testing', '/admin?tab=product-testing']);
const CONTENT = [
  ['Overview', '/admin/content'], ['Content queue', '/admin/articles'], ['Publications', '/admin/publications'],
  // D997 (#2378): Personas is now Persona segments, at its own address.
  ['Persona segments', '/admin/persona-segments'],
  ['Advisors & Partners', '/admin/advisors-partners'], ['Public team page', '/admin/team'],
];
// D938 (#2743, #2375's route map) — the Admin Console is retired: each tab is
// a page at its own address, and Personas is "Persona segments".
const MOVED = {
  '/admin?tab=payments': '/admin/platform/payments', '/admin?tab=bank-accounts': '/admin/platform/bank-accounts',
  '/admin?tab=product-testing': '/admin/platform/product-testing', '/admin?tab=promos': '/admin/platform/promo-codes',
  '/admin?tab=personas': '/admin/persona-segments',
};
for (const list of [PLATFORM, CONTENT]) for (const p of list) if (MOVED[p[1]]) p[1] = MOVED[p[1]];
// D981 (#2376) — #2375's Licences strip: the ledger and Program grants.
const LICENCES = [['Ledger', '/admin/licences'], ['Program grants', '/admin/licences/programs']];
const pairs = (items) => items.map((i) => [i.label, i.route]);

/** The literal links inside one `<HqSubNavStrip label="…">` block in the chrome. */
function chromeStrip(label) {
  const open = CHROME.indexOf(`<HqSubNavStrip label="${label}">`);
  assert.ok(open >= 0, `the shell no longer renders the ${label} strip`);
  const close = CHROME.indexOf('</HqSubNavStrip>', open);
  const block = CHROME.slice(open, close);
  return [...block.matchAll(/<StripLink to="([^"]+)">([^<]+)<\/StripLink>/g)]
    .map((m) => [m[2].replace('&amp;', '&'), m[1]]);
}

/* ------------------------------------------------------------------ *
 * The strips
 * ------------------------------------------------------------------ */

test('the strips are H36\'s, in H36\'s order, in the list the highlight reads', () => {
  assert.deepEqual(pairs(HQ_STRIPS.Platform), PLATFORM);
  assert.deepEqual(pairs(HQ_STRIPS.Content), CONTENT);
  assert.deepEqual(pairs(HQ_STRIPS.Licences), LICENCES);
  assert.deepEqual(Object.keys(HQ_STRIPS), ['Licences', 'Platform', 'Content']);
});

test('the shell renders both strips as literal links, in the same order, and only in the HQ shell', () => {
  assert.deepEqual(chromeStrip('Platform'), PLATFORM, 'the Platform strip in App.jsx is not H36\'s');
  assert.deepEqual(chromeStrip('Content'), CONTENT, 'the Content strip in App.jsx is not H36\'s');
  assert.deepEqual(chromeStrip('Licences'), LICENCES, 'the Licences strip in App.jsx is not #2375\'s');
  assert.match(CHROME, /const hqStrip = shellRole === 'super_admin' \? stripFor\(location\.pathname\) : null;/,
    'the strip is no longer decided by the location, in the HQ shell only');
  assert.match(CHROME, /\{hqStrip === 'Platform' && \(\s*<HqSubNavStrip label="Platform">/);
  assert.match(CHROME, /\{hqStrip === 'Content' && \(\s*<HqSubNavStrip label="Content">/);
  // The door the reachability walk needs once D286 replaces the admin rows.
  assert.ok(CHROME.includes('<StripLink to="/admin/team">'), '/admin/team has no literal door in the chrome');
});

test('every strip route is registered, and none is a query on the retired console (D938)', () => {
  for (const [row, items] of Object.entries(HQ_STRIPS)) {
    for (const i of items) {
      assert.ok(ROUTES.has(pathOf(i.route)), `${row} strip: ${i.route} is not registered`);
      assert.ok(!i.route.includes('?'), `${row} strip: ${i.route} lives on a query`);
    }
  }
});

test('the strips are held to the H35 map: every sub-nav placement is in its strip, and every strip console is placed there', () => {
  const routesOf = (row) => new Set(HQ_STRIPS[row].map((i) => i.route));
  for (const e of ADMIN_PLACEMENT) {
    for (const p of [e, ...(e.also || [])]) {
      if (p.tier === 'HQ' && (p.row === 'Platform' || p.row === 'Content') && p.form === 'sub-nav') {
        assert.ok(routesOf(p.row).has(e.route), `${e.key} is placed as a sub-nav item on HQ · ${p.row} but is not in its strip`);
      }
    }
  }
  const byRoute = new Map(ADMIN_PLACEMENT.map((e) => [e.route, e]));
  for (const [row, items] of Object.entries(HQ_STRIPS)) {
    for (const i of items) {
      const e = byRoute.get(i.route);
      if (!e) continue; // the row's own pages (Overview, Switches, Topology) are not legacy consoles
      const placed = [e, ...(e.also || [])].some((p) => p.tier === 'HQ' && p.row === row);
      assert.ok(placed, `${i.route} sits in the ${row} strip but the map does not place it on HQ · ${row}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * The row that stays lit
 * ------------------------------------------------------------------ */

test('a strip\'s pages light the strip\'s row, by path; every other page is left to the path rules', () => {
  // D938: the consoles left /admin for their own addresses under Platform and Content.
  for (const p of ['/admin/platform/payments', '/admin/platform/bank-accounts', '/admin/platform/product-testing', '/admin/platform/promo-codes']) {
    assert.equal(hqRowFor(p), HQ_ROW_ROUTE.Platform, p);
  }
  assert.equal(hqRowFor('/admin/persona-segments'), HQ_ROW_ROUTE.Content);
  // A page's tabs are sub-paths of its address, so they keep the strip (#2375).
  assert.equal(hqRowFor('/admin/platform/promo-codes/usage'), HQ_ROW_ROUTE.Platform, 'the strip is lost on a tab');
  assert.equal(stripFor('/admin/platform/promo-codesx'), 'Platform', 'the Overview item owns the subtree');
  assert.equal(stripFor('/admin/persona-segmentsx'), null, 'a sibling path took the strip');
  // The strip's own pages light its row too.
  assert.equal(hqRowFor('/admin/platform/switches'), HQ_ROW_ROUTE.Platform);
  assert.equal(hqRowFor('/monitoring'), HQ_ROW_ROUTE.Platform);
  assert.equal(hqRowFor('/admin/team'), HQ_ROW_ROUTE.Content);
  // Everything else is left to the path rules: Team, Revenue, Contracts and
  // Integration keys light on their own addresses and `match` lists.
  for (const p of ['/admin', '/admin/accounts/all', '/admin/revenue/billing', '/admin/contracts', '/admin/integration-keys', '/admin/wellbeing', '/hq']) {
    assert.equal(hqRowFor(p), null, p);
  }
  assert.equal(hqRowFor('/admin/analytics'), null, 'the analytics pin, not this, lights Home there');
  assert.equal(HQ_ROW_ROUTE['Integration keys'], '/admin/integration-keys');
  // The selected strip item is the longest address that owns the location.
  assert.equal(stripItemFor('/admin/platform/promo-codes/usage'), '/admin/platform/promo-codes');
  assert.equal(stripItemFor('/admin/platform'), '/admin/platform');
  assert.equal(stripItemFor('/admin/platform/payments'), '/admin/platform/payments', 'Overview is lit beside Payments');
  assert.equal(stripItemFor('/admin/accounts/all'), null);
  // The row routes are read off the shell, not typed.
  assert.equal(HQ_ROW_ROUTE.Platform, '/admin/platform');
  assert.equal(HQ_ROW_ROUTE.Content, '/admin/content');
});

test('the rows #2375 names light on the pages that left the console (D938)', () => {
  const lit = (group, to, path) => {
    const item = SIDEBAR_GROUPS[group].flatMap((g) => g.items).find((i) => i.to === to);
    return path === item.to || (item.match || []).some((p) => path === p || path.startsWith(`${p}/`));
  };
  assert.ok(lit('super_admin', '/admin/accounts', '/admin/accounts/all'), 'Team');
  assert.ok(lit('super_admin', '/admin/accounts', '/admin/accounts/credits/7'), 'Team keeps a member\'s credits');
  assert.ok(lit('super_admin', '/admin/revenue', '/admin/revenue/billing'), 'Revenue');
  for (const p of ['/admin/articles/calendar', '/admin/persona-segments', '/admin/advisors-partners/deck', '/admin/team']) {
    assert.ok(lit('super_admin', '/admin/content', p), `Content on ${p}`);
  }
  assert.ok(lit('admin', '/admin/held/accounts', '/admin/accounts/all'), 'Accounts');
  assert.ok(lit('admin', '/admin/held/accounts', '/admin/persona-segments'), 'Accounts on Persona segments');
  for (const p of ['/admin/kyc', '/admin/partner-profiles']) assert.ok(lit('admin', '/admin/held/approvals', p), `Approvals on ${p}`);
  for (const p of ['/admin/directory', '/admin/wellbeing', '/admin/wellbeing/resources']) assert.ok(lit('admin', '/admin/community', p), `Community on ${p}`);
});

test('SidebarNav lights the derived row in the HQ shell and keeps the path rules elsewhere', () => {
  // The pin is the HQ arm — the HQ shell derives its row from the map — not
  // the whole line: D286 gave the Admin shell an arm of its own beside it.
  assert.match(SIDEBAR_NAV, /const derivedRow = role === 'super_admin' \? hqRowFor\(navLocation\.pathname\) : null;/,
    'SidebarNav no longer derives the HQ row from the map');
  assert.match(SIDEBAR_NAV, /const active = derivedRow !== null\s*\? to === derivedRow\s*: \(manualActive === null \? isActive : manualActive\);/,
    'path-only matching is back: the derived row does not decide the active row');
  // The analytics pins (D210): the path rules still govern where the map is silent.
  const row = (group, to) => SIDEBAR_GROUPS[group].flatMap((g) => g.items).find((i) => i.to === to);
  assert.ok(row('super_admin', '/hq').match.includes('/admin/analytics'), 'H15 lights HQ Home');
  assert.ok(row('branch_admin', '/branch/insights').match.includes('/branch/insights'), 'S15 lights Insights');
});

/* ------------------------------------------------------------------ *
 * The console that followed the URL, retired
 * ------------------------------------------------------------------ */

test('the Admin Console is retired: no tab follows location.search any more (D938)', () => {
  assert.ok(!existsSync(resolve(root, 'frontend/src/pages/AdminPage.jsx')), 'AdminPage.jsx is back');
  assert.doesNotMatch(STRIP, /location\.search/, 'a strip item is still selected by the query');
});

/* ------------------------------------------------------------------ *
 * States and the phone rule
 * ------------------------------------------------------------------ */

test('the strip draws H36\'s states', () => {
  assert.match(STRIP, /aria-current=\{selected \? 'page' : undefined\}/, 'the selected item carries no aria-current');
  assert.match(STRIP, /shadow-\[inset_0_-2px_0_#881337\]/, 'the selected item has no 2px oxblood underline');
  assert.match(STRIP, /text-\[#881337\]/, 'the selected item is not oxblood');
  assert.match(STRIP, /focus-visible:ring-2 focus-visible:ring-\[#881337\] focus-visible:ring-offset-2/, 'keyboard focus is not a 2px ring at offset 2');
  assert.match(STRIP, /: 'font-semibold text-gray-600/, 'the default item is not weight 600');
});

test('the strip\'s own container owns the overflow, and brings the selected item into view itself', () => {
  assert.match(STRIP, /<div ref=\{containerRef\} className="overflow-x-auto/, 'the strip container no longer scrolls');
  assert.match(STRIP, /className="flex gap-1 w-max"/, 'the row no longer keeps its own width, so nothing can scroll');
  assert.match(STRIP, /c\.scrollLeft = /, 'the container no longer scrolls the selected item into view');
  assert.doesNotMatch(STRIP, /scrollIntoView|window\.scrollTo/, 'the window is scrolled instead of the container');
  // The page never scrolls sideways: <main> keeps its vertical-only overflow.
  const mainTag = /<main\b[\s\S]*?>/.exec(CHROME)[0];
  assert.doesNotMatch(mainTag, /overflow-x/, 'the overflow moved to the page');
  assert.match(mainTag, /overflow-y-auto/);
});
