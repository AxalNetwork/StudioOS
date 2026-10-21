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
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
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
  assert.deepEqual([...new Set(routes)].sort(), REDIRECT_ROUTES.map((r) => r.path).sort(),
    'a redirect route added, removed or turned into a page: update cloudflare-worker/src/services/redirectRoutes.ts');
  // A route that redirects for some roles only is a page, and is not listed.
  for (const page of ['/raise/data-room', '/needs', '/build', '/raise', '/profile', '/admin']) assert.equal(routes.includes(page), false, page);
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
  function Probe({ path }) { useRedirectBeacon(path, send); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(h(Probe, { path: '/dashboard' })); });
    await act(async () => { root.render(h(Probe, { path: '/studio' })); });
    await act(async () => { root.render(h(Probe, { path: '/tickets/42' })); });
    await act(async () => { root.render(h(Probe, { path: '/tickets/42' })); });
    assert.deepEqual(sent, ['redirect:/dashboard', 'redirect:/tickets/:id']);
  } finally { await act(async () => root.unmount()); restore(); }
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const lensLocation = useLensLocation\(\);\n\s*\/\/ #2301[^\n]*\n\s*useRedirectBeacon\(location\.pathname\);/,
    'the shell reports the address bar\'s path, above the routes');
});
