/**
 * D575 (#1188) — on a phone, a workspace shows one lens at a time and switches
 * lenses without changing the route (mobile canvas M2). Desktop pills still
 * navigate.
 *
 * This repository renders without a DOM, so a switch is shown two ways: the
 * click decision is driven through `pillClick`, the one function a pill's
 * click goes through, and the result of a switch is rendered by seeding the
 * provider with that lens (`initial`) and reading the markup. A probe outside
 * `<Routes>` reads the router's real location, which is the URL.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_lens_d575.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import {
  LensProvider, useLensLocation, pillClick, switchesInPlace, openLens, activeLens, PHONE_QUERY,
} from '../src/workspaces/lens.jsx';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { bucketsFor } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DEALS = bucketsFor('investor').find((b) => b.prefix === '/deals');

function UrlProbe() {
  return h('output', { 'data-url': useLocation().pathname + useLocation().search });
}

// App's shape: one <Routes> rendering the lens when there is one, a probe
// outside it reading the URL.
function Shell() {
  const location = useLocation();
  const lens = useLensLocation();
  const lensPage = (slug) => h('main', { 'data-lens': slug }, h(ZoneNav, { bucket: DEALS, role: 'investor' }));
  return h(React.Fragment, null,
    h(UrlProbe),
    h(Routes, { location: lens || location },
      h(Route, { path: '/deals/pipeline', element: lensPage('pipeline') }),
      h(Route, { path: '/deals/screening', element: lensPage('screening') }),
      h(Route, { path: '/deals/commit', element: lensPage('commit') }),
      h(Route, { path: '/deals/closing', element: lensPage('closing') }),
    ));
}

const render = (url, initial) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [url] }, h(LensProvider, { initial }, h(Shell))),
);
const lensesShown = (html) => [...html.matchAll(/data-lens="([^"]+)"/g)].map((m) => m[1]);
const urlOf = (html) => /data-url="([^"]*)"/.exec(html)?.[1];
// The current pill twice over: the link's aria-current, and ZoneNav's own
// accent (weight 700), which it decides from the location separately.
const currentPill = (html) => {
  const pills = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  const slug = (a) => /data-testid="link-zone-([^"]+)"/.exec(a)?.[1];
  const byAria = pills.filter((a) => /aria-current="page"/.test(a)).map(slug).join(',');
  const byAccent = pills.filter((a) => /font-weight:700/.test(a)).map(slug).join(',');
  return byAria === byAccent ? byAria : `aria=${byAria} accent=${byAccent}`;
};

function fakeClick(over = {}) {
  const ev = {
    button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false,
    defaultPrevented: false, currentTarget: { getAttribute: () => null },
    preventDefault() { this.defaultPrevented = true; },
    ...over,
  };
  return ev;
}
function fakeLens() {
  const calls = [];
  return { calls, switchLens: (to, state) => calls.push([to, state]) };
}

// ───────────────────────────────────────────────────────────── phone ──

test('phone: a switched lens renders that one lens, and the URL is unchanged', () => {
  const html = render('/deals/pipeline', '/deals/commit');
  assert.deepEqual(lensesShown(html), ['commit'], 'the switch did not render the lens it opened, alone');
  assert.equal(urlOf(html), '/deals/pipeline', 'switching a lens changed the URL');
  assert.equal(currentPill(html), 'commit', 'the current pill does not follow the lens');
});

test('phone: a plain tap on a pill switches the lens and cancels the navigation', () => {
  const lens = fakeLens();
  const ev = fakeClick();
  pillClick(ev, { phone: true, ctx: lens, to: '/deals/commit', state: { from: 'x' } });
  assert.equal(ev.defaultPrevented, true, 'the NavLink would still navigate and push a history entry');
  assert.deepEqual(lens.calls, [['/deals/commit', { from: 'x' }]]);
});

test('phone: a modified, middle or new-target click keeps the link\'s own behaviour', () => {
  for (const over of [
    { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
    { currentTarget: { getAttribute: () => '_blank' } },
  ]) {
    assert.equal(switchesInPlace(fakeClick(over), true), false, `switched on ${JSON.stringify(Object.keys(over))}`);
  }
  assert.equal(switchesInPlace(fakeClick({ defaultPrevented: true }), true), false);
  assert.equal(switchesInPlace(fakeClick({ currentTarget: { getAttribute: () => '_self' } }), true), true);
});

test('phone: the lens belongs to the history entry it opened on, so Back or a link clears it', () => {
  const here = { pathname: '/deals/pipeline', search: '?x=1', hash: '', key: 'k1' };
  const lens = openLens(here, '/deals/commit?x=1');
  assert.equal(activeLens(lens, here).pathname, '/deals/commit');
  assert.equal(activeLens(lens, here).search, '?x=1');
  assert.equal(activeLens(lens, { ...here, key: 'k2' }), null, 'a lens survived a real navigation');
  // Tapping the pill the URL already names is no lens: the route renders as is.
  assert.equal(openLens(here, '/deals/pipeline?x=1'), null);
  assert.notEqual(openLens(here, '/deals/pipeline?x=2'), null);
});

test('the phone breakpoint is the tab bar\'s (D425): below 1024px', () => {
  assert.equal(PHONE_QUERY, '(max-width: 1023px)');
  assert.match(read('frontend/src/components/MobileTabBar.jsx'), /lg:hidden/);
});

// ─────────────────────────────────────────────────────────── desktop ──

test('desktop: a pill click is left to the NavLink, which navigates', () => {
  const lens = fakeLens();
  const ev = fakeClick();
  let seen = false;
  pillClick(ev, { phone: false, ctx: lens, to: '/deals/commit', onClick: () => { seen = true; } });
  assert.equal(ev.defaultPrevented, false, 'a desktop pill no longer navigates');
  assert.deepEqual(lens.calls, []);
  assert.equal(seen, true, 'the pill swallowed its own onClick');
});

test('every pill is still a real link to its zone route', () => {
  const html = render('/deals/pipeline');
  const hrefs = Object.fromEntries([...html.matchAll(/<a [^>]*>/g)].map((m) => [
    /data-testid="link-zone-([^"]+)"/.exec(m[0])?.[1], /href="([^"]*)"/.exec(m[0])?.[1],
  ]));
  for (const z of DEALS.zones) {
    assert.equal(hrefs[z.slug], `/deals/${z.slug}`,
      `the ${z.slug} pill is not a link to its route, so it cannot be shared or opened on a desktop`);
  }
});

// ───────────────────────────────────────────────────────── deep links ──

test('deep link: a lens\'s route opens that lens on a phone', () => {
  const html = render('/deals/closing');
  assert.deepEqual(lensesShown(html), ['closing']);
  assert.equal(urlOf(html), '/deals/closing');
  assert.equal(currentPill(html), 'closing');
});

// ──────────────────────────────────────────────────────────── wiring ──

test('App renders the lens through its one <Routes>, inside the provider', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /\n<Routes location=\{lensLocation \|\| location\}>\n/, 'App\'s <Routes> ignores the lens');
  assert.match(app, /const lensLocation = useLensLocation\(\);/);
  assert.match(app, /<LensProvider><AppInner \/><\/LensProvider>/, 'AppInner is not inside the LensProvider');
});

test('the shared zone row is the lens switcher', () => {
  const nav = read('frontend/src/workspaces/ZoneNav.jsx');
  assert.match(nav, /^import \{ LensNavLink \} from '\.\/lens';$/m, 'ZoneNav\'s pill is not the lens link');
  assert.match(nav, /<LensNavLink\b/);
  assert.doesNotMatch(nav, /<NavLink\b/, 'ZoneNav renders a pill that only navigates');
});
