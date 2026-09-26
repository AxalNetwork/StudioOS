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
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { ADMIN_PLACEMENT } from '../src/lib/adminPlacement.js';
import { HQ_STRIPS, HQ_ROW_ROUTE, hqRowFor, stripFor, hereFrom } from '../src/lib/hqStrips.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const CHROME = APP.slice(0, APP.indexOf('<Routes>')) + APP.slice(APP.indexOf('</Routes>'));
const ADMIN_PAGE = codeOnly(read('frontend/src/pages/AdminPage.jsx'));
const STRIP = codeOnly(read('frontend/src/components/HqSubNavStrip.jsx'));
const SIDEBAR_NAV = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));

/** path → registered, read off every <Route> line. */
const ROUTES = new Set();
for (const seg of APP.split('<Route').slice(1)) {
  const p = /^\s*path="([^"]+)"/.exec(seg);
  if (p) ROUTES.add(p[1]);
}
const pathOf = (to) => to.split('?')[0].split('#')[0];

/** The tab values, read out of ADMIN_SECTIONS. */
const TABS = (() => {
  const start = ADMIN_PAGE.indexOf('const ADMIN_SECTIONS = [');
  const end = ADMIN_PAGE.indexOf('];', start);
  return [...ADMIN_PAGE.slice(start, end).matchAll(/\{ value: '([\w-]+)'/g)].map((m) => m[1]);
})();

// H36, verbatim.
const PLATFORM = [
  ['Overview', '/admin/platform'], ['Switches', '/admin/platform/switches'], ['Topology', '/admin/platform/topology'],
  ['Integration keys', '/admin?tab=integration-keys'], ['GitHub Sync', '/admin?tab=github'], ['Payments', '/admin?tab=payments'],
  ['Promo codes', '/admin?tab=promos'], ['Monitoring', '/monitoring'], ['Telegram', '/admin/telegram'],
];
const CONTENT = [
  ['Overview', '/admin/content'], ['Content queue', '/admin/articles'], ['Publications', '/admin/publications'],
  ['Assessment Studio', '/admin/assessment'], ['Personas', '/admin?tab=personas'],
  ['Advisors & Partners', '/admin?tab=network-profiles'], ['Public team page', '/admin/team'],
];
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
  assert.deepEqual(Object.keys(HQ_STRIPS), ['Platform', 'Content']);
});

test('the shell renders both strips as literal links, in the same order, and only in the HQ shell', () => {
  assert.deepEqual(chromeStrip('Platform'), PLATFORM, 'the Platform strip in App.jsx is not H36\'s');
  assert.deepEqual(chromeStrip('Content'), CONTENT, 'the Content strip in App.jsx is not H36\'s');
  assert.match(CHROME, /const hqStrip = shellRole === 'super_admin' \? stripFor\(location\.pathname, location\.search\) : null;/,
    'the strip is no longer decided by the location, in the HQ shell only');
  assert.match(CHROME, /\{hqStrip === 'Platform' && \(\s*<HqSubNavStrip label="Platform">/);
  assert.match(CHROME, /\{hqStrip === 'Content' && \(\s*<HqSubNavStrip label="Content">/);
  // The door the reachability walk needs once D286 replaces the admin rows.
  assert.ok(CHROME.includes('<StripLink to="/admin/team">'), '/admin/team has no literal door in the chrome');
});

test('every strip route is registered, and every ?tab= is a section', () => {
  for (const [row, items] of Object.entries(HQ_STRIPS)) {
    for (const i of items) {
      assert.ok(ROUTES.has(pathOf(i.route)), `${row} strip: ${i.route} is not registered`);
      const tab = new URLSearchParams(i.route.split('?')[1] || '').get('tab');
      if (tab) assert.ok(TABS.includes(tab), `${row} strip: ?tab=${tab} is not a section`);
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

test('a ?tab= lights the HQ row the map places it on: Platform on integration-keys, not on users', () => {
  assert.equal(hqRowFor('/admin', '?tab=integration-keys'), HQ_ROW_ROUTE.Platform);
  assert.notEqual(hqRowFor('/admin', '?tab=users'), HQ_ROW_ROUTE.Platform);
  assert.equal(hqRowFor('/admin', '?tab=users'), HQ_ROW_ROUTE.Team, 'Team lights on ?tab=users');
  assert.equal(hqRowFor('/admin', '?tab=legal'), HQ_ROW_ROUTE.Contracts, 'Contracts lights on ?tab=legal');
  assert.equal(hqRowFor('/admin', '?tab=billing'), HQ_ROW_ROUTE.Revenue, 'Revenue lights on ?tab=billing');
  assert.equal(hqRowFor('/admin', '?tab=personas'), HQ_ROW_ROUTE.Content);
  assert.equal(hqRowFor('/admin', '?tab=github'), HQ_ROW_ROUTE.Platform);
  // The strip's own pages light its row too.
  assert.equal(hqRowFor('/admin/platform/switches', ''), HQ_ROW_ROUTE.Platform);
  assert.equal(hqRowFor('/monitoring', ''), HQ_ROW_ROUTE.Platform);
  assert.equal(hqRowFor('/admin/team', ''), HQ_ROW_ROUTE.Content);
  // Anything the map does not place on an HQ row is left to the path rules.
  assert.equal(hqRowFor('/admin', '?tab=wellbeing'), null);
  assert.equal(hqRowFor('/admin', ''), null);
  assert.equal(hqRowFor('/hq', ''), null);
  assert.equal(hqRowFor('/admin/analytics', ''), null, 'the analytics pin, not this, lights Home there');
  assert.deepEqual([stripFor('/admin', '?tab=promos'), stripFor('/admin/articles', ''), stripFor('/admin', '?tab=users')],
    ['Platform', 'Content', null]);
  assert.equal(hereFrom('/admin', '?tab=kyc&x=1'), '/admin?tab=kyc');
  // The row routes are read off the shell, not typed.
  assert.equal(HQ_ROW_ROUTE.Platform, '/admin/platform');
  assert.equal(HQ_ROW_ROUTE.Content, '/admin/content');
});

test('SidebarNav lights the derived row in the HQ shell and keeps the path rules elsewhere', () => {
  // The pin is the HQ arm — the HQ shell derives its row from the map — not
  // the whole line: D286 gave the Admin shell an arm of its own beside it.
  assert.match(SIDEBAR_NAV, /const derivedRow = role === 'super_admin' \? hqRowFor\(navLocation\.pathname, navLocation\.search\)/,
    'SidebarNav no longer derives the HQ row from the map');
  assert.match(SIDEBAR_NAV, /const active = derivedRow !== null\s*\? to === derivedRow\s*: \(manualActive === null \? isActive : manualActive\);/,
    'path-only matching is back: the derived row does not decide the active row');
  // The analytics pins (D210): the path rules still govern where the map is silent.
  const row = (group, to) => SIDEBAR_GROUPS[group].flatMap((g) => g.items).find((i) => i.to === to);
  assert.ok(row('super_admin', '/hq').match.includes('/admin/analytics'), 'H15 lights HQ Home');
  assert.ok(row('branch_admin', '/branch/insights').match.includes('/branch/insights'), 'S15 lights Insights');
});

/* ------------------------------------------------------------------ *
 * The tab that follows the URL
 * ------------------------------------------------------------------ */

test('the Admin Console tab follows location.search, writes back with replace, and section still wins', () => {
  // The first read is unchanged (hq_team_h20 pins it); this is the follow-up.
  assert.match(ADMIN_PAGE, /get\('tab'\);\s*return t && ADMIN_SECTION_VALUES\.has\(t\)/);
  assert.match(ADMIN_PAGE, /useEffect\(\(\) => \{\s*if \(section\) return;\s*const t = new URLSearchParams\(location\.search\)\.get\('tab'\);\s*if \(t && ADMIN_SECTION_VALUES\.has\(t\)\) setTab\(t\);\s*\}, \[location\.search, section\]\);/,
    'the tab no longer follows location.search, or the section override was dropped from it');
  assert.match(ADMIN_PAGE, /if \(!section\) navigate\(\{ search: `\?tab=\$\{value\}` \}, \{ replace: true \}\);/,
    'a pick no longer writes back to the URL with replace');
  assert.match(ADMIN_PAGE, /onChange=\{pickTab\}/, 'the section nav does not go through the write-back');
  assert.match(ADMIN_PAGE, /if \(section && ADMIN_SECTION_VALUES\.has\(section\)\) return section;/, 'the section override no longer wins the first read');
  assert.doesNotMatch(read('frontend/src/pages/AdminPage.jsx'), /row of 12 tab buttons/, 'the comment still says twelve');
  assert.match(read('frontend/src/pages/AdminPage.jsx'), /fourteen sections today/);
  assert.equal(TABS.length, 14);
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
