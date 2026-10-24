/**
 * #2301 — the redirect list is exactly App.jsx's redirect-only routes, an
 * address resolves to its pattern (never its ids or query), and the router
 * shell sends one beacon per opening of a listed address.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/redirect_hits_2301.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { ADMIN_TAB_REDIRECTS, REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor, useRedirectBeacon } from '../src/lib/redirectBeacon.js';

const h = React.createElement;

/**
 * Every `<Route path>` whose element only ever forwards: each component in it is
 * `Navigate` or a `*Redirect`, and no ternary chooses between elements (a route
 * that renders a page for some roles is a page). Guards and `authOnly` wrap it.
 */
function redirectOnlyRoutes(src) {
  const out = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (depth && i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const el = src.slice(m.index + m[0].length, i - 1);
    const tags = [...el.matchAll(/<([A-Z]\w*)/g)].map((t) => t[1]);
    if (!tags.length || !tags.every((t) => t === 'Navigate' || t.endsWith('Redirect'))) continue;
    if (/\?\s*<|:\s*<[A-Z]/.test(el)) continue;
    out.push(m[1]);
  }
  return out;
}

test('the list is App.jsx\'s redirect-only routes, no more and no fewer', () => {
  const files = [new URL('../src/App.jsx', import.meta.url),
    ...readdirSync(new URL('../src/routes/', import.meta.url)).filter((f) => f.endsWith('.jsx')).map((f) => new URL(`../src/routes/${f}`, import.meta.url))];
  const routes = files.flatMap((f) => redirectOnlyRoutes(readFileSync(f, 'utf8')));
  assert.deepEqual([...new Set(routes)].sort(), REDIRECT_ROUTES.filter((r) => !r.path.includes('?')).map((r) => r.path).sort(),
    'a redirect route added, removed or turned into a page: update cloudflare-worker/src/services/redirectRoutes.ts');
  // A route that redirects for some roles only is a page, and is not listed.
  for (const page of ['/raise/data-room', '/build', '/raise', '/profile', '/admin']) assert.equal(routes.includes(page), false, page);
  // #2337, #2338, #2342: the pages removed on 2026-10-21 forward everyone now,
  // so they are counted until #2319 retires them. `/needs` stood in the list
  // above while it still rendered the board for a partner.
  for (const gone of ['/portfolio/coverage', '/needs', '/services', '/founder/post-need', '/partner/needs', '/partners/portal', '/partner-portal']) {
    assert.ok(routes.includes(gone), `${gone} renders a page again`);
  }
});

test('an address resolves to its pattern, exact before splat, never its ids', () => {
  assert.equal(redirectPatternFor('/dashboard'), '/dashboard');
  assert.equal(redirectPatternFor('/tickets/42'), '/tickets/:id');
  assert.equal(redirectPatternFor('/notifications'), '/notifications');
  assert.equal(redirectPatternFor('/notifications/abc/def'), '/notifications/*');
  assert.equal(redirectPatternFor('/settings/email'), '/settings/:section');
  assert.equal(redirectPatternFor('/partner/operations/portfolio'), '/partner/operations/portfolio');
  for (const page of ['/studio', '/research', '/help/tickets/7', '/dashboard/x', '', null]) assert.equal(redirectPatternFor(page), null, String(page));
});

test('the shell sends one beacon per opening of a listed address, and none for a page', async () => {
  const restore = installDocument();
  const sent = [];
  const send = (k) => sent.push(k);
  function Probe({ path }) { useRedirectBeacon(path, '', send); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(h(Probe, { path: '/dashboard' })); });
    await act(async () => { root.render(h(Probe, { path: '/studio' })); });
    await act(async () => { root.render(h(Probe, { path: '/tickets/42' })); });
    await act(async () => { root.render(h(Probe, { path: '/tickets/42' })); });
    assert.deepEqual(sent, ['redirect:/dashboard', 'redirect:/tickets/:id']);
  } finally { await act(async () => root.unmount()); restore(); }
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const lensLocation = useLensLocation\(\);\n\s*\/\/ #2301[^\n]*\n\s*useRedirectBeacon\(location\.pathname, location\.search\);/,
    'the shell reports the address bar\'s path, above the routes');
});


test('the fixed tab keys cover the legacy section list and retired moved tabs, never arbitrary query text', () => {
  // These are historical keys: retiring a console section must not retire its counter.
  const tabs = ['users', 'profiles', 'kyc', 'lab-applications', 'legal', 'personas', 'directory', 'promos',
    'payments', 'bank-accounts', 'product-testing', 'billing', 'wellbeing', 'network-profiles', 'integration-keys', 'github'];
  assert.deepEqual(ADMIN_TAB_REDIRECTS.map((r) => r.path).sort(), tabs.map((t) => `/admin?tab=${t}`).sort());
  for (const { path } of ADMIN_TAB_REDIRECTS) assert.equal(redirectPatternFor('/admin', path.slice('/admin'.length)), path);
  assert.equal(redirectPatternFor('/admin', '?tab=k%79c&email=private@example.test'), '/admin?tab=kyc');
  for (const search of ['', '?tab=unknown', '?tab=private@example.test', '?tab=', '?other=kyc']) assert.equal(redirectPatternFor('/admin', search), null, search);
});

test('mounted beacon counts tab switches, omits other query data and does not resend on unrelated query changes', async () => {
  const restore = installDocument(), sent = [], send = (key) => sent.push(key);
  function Probe({ search }) { useRedirectBeacon('/admin', search, send); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    for (const search of ['?tab=kyc&email=private@example.test', '?tab=promos', '?tab=promos&tracking=secret', '?tab=unknown', '?tab=kyc']) {
      await act(async () => { root.render(h(Probe, { search })); });
    }
    assert.deepEqual(sent, ['redirect:/admin?tab=kyc', 'redirect:/admin?tab=promos', 'redirect:/admin?tab=kyc']);
  } finally { await act(async () => root.unmount()); restore(); }
});


test('the mounted default beacon sends canonical tab keys through fetch and tolerates an unreadable counter', async () => {
  const restore = installDocument(), previousFetch = globalThis.fetch;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    if (requests.length === 2) throw new Error('counter unavailable');
    return new Response(null, { status: 204 });
  };
  function Probe({ search }) { useRedirectBeacon('/admin', search); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    for (const search of ['?tab=kyc&person=private', '?tab=promos', '?tab=unknown']) {
      await act(async () => { root.render(h(Probe, { search })); });
    }
    assert.deepEqual(requests.map((r) => r.url), ['/api/public/analytics/pageview', '/api/public/analytics/pageview']);
    assert.deepEqual(requests.map((r) => r.body.path), ['redirect:/admin?tab=kyc', 'redirect:/admin?tab=promos']);
  } finally {
    await act(async () => root.unmount()); globalThis.fetch = previousFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    restore();
  }
});
