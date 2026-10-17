/**
 * D425 — the phone's tab bar, founder first (Mobile canvas M1, with M5's
 * safe-area and 44pt rules).
 *
 * What fails quietly here, and so what this file pins:
 *
 *   - A tab that renames or drops a sidebar row. The canvas's rule is
 *     "nothing is renamed and nothing is dropped", and a hand-typed tab list
 *     is the version of this that drifts from the sidebar the first time
 *     Session 5 edits a row.
 *   - A tab lit on the wrong page. `/build/discovery` is Validate's and
 *     `/build/team` is Grow's; a prefix match would light Build for both.
 *   - A More door to a route the founder guard refuses — a row that bounces.
 *   - Targets under 44pt, a sheet that is not a dialog, and a bar that sits
 *     under the home indicator or over the page's last row.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mobile_tab_bar_d425.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { Briefcase, Check, DollarSign, TrendingUp } from 'lucide-react';
import { FOUNDER_BAND_PATHS, FOUNDER_MORE_DOORS, FOUNDER_TAB_PATHS, mobilePlan, rowActive } from '../src/lib/mobileTabs.js';
import * as TabBarModule from '../src/components/MobileTabBar.jsx';

const MobileTabBar = TabBarModule.default;

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const founderRows = () => SIDEBAR_GROUPS.founder.flatMap((g) => g.items);

// The role is taken as given — a default here would turn an `undefined` role
// into a founder and hide the case the licence test exists for.
const renderAs = (role, path) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(MobileTabBar, { role })),
);
const renderAt = (path) => renderAs('founder', path);

// ── The plan ─────────────────────────────────────────────────────────────────

test('the founder tabs are the canvas\'s four, in its order, under their sidebar names', () => {
  const plan = mobilePlan('founder');
  // D699 (CO:219): Validate, Build, Raise, Grow. Studio moved to the band's
  // glyph. Each tab says what its sidebar row says and lights where it lights;
  // only the icon is the canvas's own.
  assert.deepEqual(plan.tabs.map((r) => r.to), ['/validate', '/build', '/raise', '/grow']);
  assert.deepEqual(plan.tabs.map((r) => r.to), FOUNDER_TAB_PATHS);
  const icons = { '/validate': Check, '/build': Briefcase, '/raise': DollarSign, '/grow': TrendingUp };
  for (const tab of plan.tabs) {
    const row = founderRows().find((r) => r.to === tab.to);
    assert.equal(tab.label, row.label, `${tab.to} renames its sidebar row`);
    assert.equal(tab.match, row.match, `${tab.to} lights for other pages than its sidebar row`);
    assert.equal(tab.icon, icons[tab.to], `${tab.to} does not draw the canvas's icon`);
  }
});

test('every founder sidebar row lands exactly once, tab, band or More, in the sidebar\'s order', () => {
  const plan = mobilePlan('founder');
  // The band (D699) carries Studio; it is in neither the tabs nor More.
  assert.deepEqual(FOUNDER_BAND_PATHS, ['/studio']);
  const placed = [...plan.tabs, ...plan.more].map((r) => r.to).concat(FOUNDER_BAND_PATHS);
  for (const row of founderRows()) {
    assert.equal(placed.filter((to) => to === row.to).length, 1, `${row.to} (${row.label}) is dropped or doubled`);
  }
  // More keeps the sidebar's order for its rows, then the phone-only doors.
  const sidebarMore = founderRows()
    .filter((r) => !FOUNDER_TAB_PATHS.includes(r.to) && !FOUNDER_BAND_PATHS.includes(r.to)).map((r) => r.to);
  assert.deepEqual(plan.more.map((r) => r.to), [...sidebarMore, ...FOUNDER_MORE_DOORS.map((d) => d.to)]);
  assert.deepEqual(FOUNDER_MORE_DOORS.map((d) => d.to), ['/messages'], 'Trust and Company Settings moved to the band\'s sheets');
  // The gap map's two: Spin-Out Lab is a live sidebar row the canvas's plan
  // left out, and Messages had no door on a phone.
  assert.ok(plan.more.some((r) => r.to === '/spinout-lab'), 'Spin-Out Lab is not reachable from More');
  assert.ok(plan.more.some((r) => r.to === '/messages'), 'a phone still has no Messages door');
});

test('a row the sidebar gains reaches More without an edit here', () => {
  const groups = structuredClone({ founder: SIDEBAR_GROUPS.founder.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, icon: null })) })) });
  groups.founder[0].items.push({ to: '/new-thing', label: 'New thing', icon: null });
  const plan = mobilePlan('founder', groups);
  assert.ok(plan.more.some((r) => r.to === '/new-thing'), 'a new sidebar row was dropped from the phone');
});

test('every More door is a route the founder guard admits', () => {
  const app = read('frontend/src/App.jsx');
  for (const door of FOUNDER_MORE_DOORS) {
    const route = new RegExp(`<Route path="${door.to}" element=\\{guard\\(\\[([^\\]]*)\\]`).exec(app);
    assert.ok(route, `${door.to} has no route, so its More row would land nowhere`);
    assert.match(route[1], /'founder'/, `${door.to}'s guard refuses a founder, so its More row bounces`);
  }
});

test('the other licences get no bar until their allocation is built', () => {
  for (const role of ['investor', 'advisor', 'partner', 'admin', 'super_admin', 'exploring', undefined]) {
    assert.equal(mobilePlan(role), null, `${role} was handed a plan`);
    assert.equal(renderAs(role, '/studio'), '', `${role} was drawn a bar`);
  }
});

// ── Which tab is lit ─────────────────────────────────────────────────────────

test('a tab lights for exactly the pages its sidebar row lights for', () => {
  const rows = Object.fromEntries(founderRows().map((r) => [r.label, r]));
  const lit = (path) => founderRows().filter((r) => rowActive(r, path)).map((r) => r.label);
  assert.deepEqual(lit('/build'), ['Build']);
  assert.deepEqual(lit('/build/board'), ['Build']);
  assert.deepEqual(lit('/execution'), ['Build']);
  // The two a prefix match gets wrong.
  assert.deepEqual(lit('/build/discovery'), ['Validate']);
  assert.deepEqual(lit('/build/team'), ['Grow']);
  // A row with no `match` is the sidebar's `NavLink end`: exact, slash-tolerant.
  assert.equal(rowActive(rows.Studio, '/studio'), true);
  assert.equal(rowActive(rows.Studio, '/studio/'), true);
  assert.equal(rowActive(rows.Studio, '/studio/elsewhere'), false);
  assert.equal(rowActive(FOUNDER_MORE_DOORS[0], '/messages'), true);
});

test('the bar marks the current tab, and More when the page is one of its rows', () => {
  const onBoard = renderAt('/build/board');
  assert.match(onBoard, /aria-current="page"[^>]*data-testid="link-mobile-tab-build"/);
  assert.equal((onBoard.match(/aria-current="page"/g) || []).length, 1, 'more than one tab claims the page');
  assert.match(onBoard, /data-active="false" data-testid="link-mobile-tab-more"/);

  const onNetwork = renderAt('/network/relationships');
  assert.doesNotMatch(onNetwork, /aria-current="page"/, 'a tab claims a page that belongs to More');
  assert.match(onNetwork, /data-active="true" data-testid="link-mobile-tab-more"/);

  // D699: nothing is lit on /studio, which the band's glyph carries (CO:218).
  const onStudio = renderAt('/studio');
  assert.doesNotMatch(onStudio, /aria-current="page"/);
  assert.match(onStudio, /data-active="false" data-testid="link-mobile-tab-more"/);
});

// ── Targets, the sheet, safe areas ───────────────────────────────────────────

test('five targets, each at least 44pt, and the bar only below 1024px', () => {
  const html = renderAt('/studio');
  const targets = [...html.matchAll(/<(a|button)\b[^>]*class="([^"]*)"/g)];
  assert.equal(targets.length, 5, 'the bar is four tabs and More');
  for (const [, , cls] of targets) {
    assert.match(cls, /min-h-\[56px\]/, 'a tab is shorter than the canvas allows');
    assert.match(cls, /text-\[9\.5px\] font-bold/, 'a tab label is not the canvas\'s 9.5px/700');
  }
  assert.match(html, /<nav aria-label="Primary" class="mtb [^"]*lg:hidden/, 'the bar shows on desktop, or lost its safe-area class');
  // D699: More is a page, so nothing in the bar opens a dialog.
  assert.doesNotMatch(html, /aria-haspopup="dialog"/, 'More still opens a sheet');
});

test('More is a link to the /more page, current there, and the sheet is gone (D699)', () => {
  const onMore = renderAt('/more');
  assert.match(onMore, /<a aria-current="page"[^>]*data-testid="link-mobile-tab-more" href="\/more"/);
  assert.equal((onMore.match(/aria-current="page"/g) || []).length, 1, 'a tab claims /more too');
  assert.match(onMore, /data-active="true" data-testid="link-mobile-tab-more"/);
  assert.doesNotMatch(onMore, /<button/, 'More is still a button');
  assert.equal(TabBarModule.MoreSheet, undefined, 'the More sheet is still exported');
  const src = codeOnly(read('frontend/src/components/MobileTabBar.jsx'));
  assert.doesNotMatch(src, /role="dialog"|aria-modal/, 'the bar still draws a dialog');
  // The sheet's frame now lives in `ui/phone/PhoneSheet.jsx` (phone_shell_d699, test 9).
  assert.doesNotMatch(read('frontend/src/components/mobileTabBar.css'), /\.mtb-sheet/);
  // /more is a route the founder guard admits.
  assert.match(read('frontend/src/App.jsx'), /<Route path="\/more" element=\{guard\(\['admin', 'founder'\]/);
});

test('the bar clears the home indicator and the notch, and never covers the page', () => {
  assert.match(read('frontend/index.html'), /<meta name="viewport" content="[^"]*viewport-fit=cover/,
    'without viewport-fit=cover the safe-area insets read 0 on every phone');
  const css = read('frontend/src/components/mobileTabBar.css');
  assert.match(css, /\.mtb \{\s*padding-bottom: env\(safe-area-inset-bottom, 0px\);/);
  assert.match(css, /--mobile-tabbar-h: calc\(56px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  // The clearance is on the scroll container (`<main data-app-scroll>`, D504),
  // not on the content block inside it: the footer follows that block, so
  // padding the block left the footer under the bar at the end of the scroll.
  assert.match(css, /:root\[data-mobile-tabbar="on"\] \[data-app-scroll\] \{\s*padding-bottom: var\(--mobile-tabbar-h\);/,
    'the last row of a page sits under the bar');
  assert.doesNotMatch(css, /\[data-app-main\] \{/, 'padding the content block leaves the footer after it under the bar');
  assert.match(css, /@media \(max-width: 1023\.98px\)/, 'the page is padded for a bar on desktop, where none shows');
  // The attribute that padding keys off is set only while a bar is drawn.
  const src = codeOnly(read('frontend/src/components/MobileTabBar.jsx'));
  assert.match(src, /if \(!drawn \|\| typeof document === 'undefined'\) return undefined;/);
  assert.match(src, /return \(\) => root\.removeAttribute\('data-mobile-tabbar'\);/);
  // cover lets content under the landscape notch; the body keeps clear of it.
  assert.match(read('frontend/src/index.css'),
    /padding-left: env\(safe-area-inset-left, 0px\);\s*padding-right: env\(safe-area-inset-right, 0px\);\s*\}/);
});
