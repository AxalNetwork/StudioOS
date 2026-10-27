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
import { ADMIN_TAB_REDIRECTS, FORWARD_REDIRECTS, REDIRECT_ROUTES, ROLE_REDIRECTS, isRedirectKey } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
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
  // D1160 and D1109: a role's forward and a self-counting forward are not address-bar routes.
  assert.deepEqual([...new Set(routes)].sort(), REDIRECT_ROUTES.filter((r) => !r.path.includes('?') && !r.role && !r.forward).map((r) => r.path).sort(),
    'a redirect route added, removed or turned into a page: update cloudflare-worker/src/services/redirectRoutes.ts');
  // A route that redirects for some roles only is a page, and is not listed.
  for (const page of ['/raise/data-room', '/build', '/raise', '/profile']) assert.equal(routes.includes(page), false, page);
  // D938: the Admin Console is retired, so /admin only forwards now, and is kept for good (#2375).
  assert.ok(routes.includes('/admin'));
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
  assert.equal(redirectPatternFor('/admin/', '?tab=kyc'), '/admin?tab=kyc');
  assert.equal(redirectPatternFor('/ADMIN', '?tab=kyc'), '/admin?tab=kyc');
  for (const search of ['', '?tab=unknown', '?tab=private@example.test', '?tab=', '?other=kyc']) assert.equal(redirectPatternFor('/admin', search), '/admin', search);
});

test('mounted beacon counts tab switches, omits other query data and does not resend on unrelated query changes', async () => {
  const restore = installDocument(), sent = [], send = (key) => sent.push(key);
  function Probe({ search }) { useRedirectBeacon('/admin', search, send); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    for (const search of ['?tab=kyc&email=private@example.test', '?tab=promos', '?tab=promos&tracking=secret', '?tab=unknown', '?tab=kyc']) {
      await act(async () => { root.render(h(Probe, { search })); });
    }
    assert.deepEqual(sent, ['redirect:/admin?tab=kyc', 'redirect:/admin?tab=promos', 'redirect:/admin', 'redirect:/admin?tab=kyc']);
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
    assert.deepEqual(requests.map((r) => r.url), ['/api/public/analytics/pageview', '/api/public/analytics/pageview', '/api/public/analytics/pageview']);
    assert.deepEqual(requests.map((r) => r.body.path), ['redirect:/admin?tab=kyc', 'redirect:/admin?tab=promos', 'redirect:/admin']);
  } finally {
    await act(async () => root.unmount()); globalThis.fetch = previousFetch;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    restore();
  }
});

test('D1160: a role\'s forward is counted by the forward itself, never by the address bar, since the address is another role\'s page', async () => {
  assert.deepEqual(ROLE_REDIRECTS.map((r) => r.path), ['/funds', '/funds/performance', '/pipeline']);
  for (const { path } of ROLE_REDIRECTS) {
    assert.ok(isRedirectKey(`redirect:${path}`), `${path} is countable`);
    assert.equal(redirectPatternFor(path), null, `an investor at ${path} is not counted`);
  }
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const path of ['/funds', '/funds/performance']) {
    const line = app.split('\n').find((l) => l.includes(`<Route path="${path}" element=`));
    assert.match(line, /effectiveRole === 'investor' \? [\s\S]+ : <FundOpsRedirect \/>\)\} \/>$/, path);
  }
  const { default: FundOpsRedirect } = await import('../src/pages/admin/fundAdmin/FundOpsRedirect.jsx');
  const { MemoryRouter, Routes, Route } = await import('react-router-dom');
  const restore = installDocument();
  const sent = [];
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/funds/performance?x=1#h'] }, h(Routes, null,
      h(Route, { path: '/funds/performance', element: h(FundOpsRedirect, { send: (k) => sent.push(k) }) }),
      h(Route, { path: '*', element: null })))); });
    assert.deepEqual(sent, ['redirect:/funds/performance']);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('D1243: /deals/pipeline and an investor\'s /pipeline land on Deal flow\'s table, the query and hash kept; each is counted once', async () => {
  // /deals/pipeline is a redirect for everyone: the address bar counts it.
  assert.equal(redirectPatternFor('/deals/pipeline'), '/deals/pipeline');
  // /pipeline is still the partner's, the founder's and an admin's page: only the investor's forward counts it.
  assert.equal(redirectPatternFor('/pipeline'), null);
  assert.ok(isRedirectKey('redirect:/pipeline') && isRedirectKey('redirect:/deals/pipeline'));
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(app.includes('<Route path="/deals/pipeline" element={<DealsPipelineRedirect />} />'));
  const line = app.split('\n').find((l) => l.includes('<Route path="/pipeline" element='));
  assert.match(line, /effectiveRole === 'partner' \? <PartnerBucketRoutes \/> : effectiveRole === 'investor' \? <DealsPipelineRedirect countAs="\/pipeline" \/> : investorWorkspace\('deals', <PipelineWorkspace \/>\)/,
    'the partner keeps the bucket, the founder and an admin the board, and only an investor forwards');
  const { pipelineMovedHref } = await import('../src/pages/investor/dealflow/dealFlowModel.js');
  assert.equal(pipelineMovedHref(''), '/deals?view=table');
  assert.equal(pipelineMovedHref('?scope=all&q=solar', '#top'), '/deals?scope=all&q=solar&view=table#top');
  assert.equal(pipelineMovedHref('?view=board&stage=commit'), '/deals?view=table&stage=commit', 'the view is the table whatever the old query said');
  const { default: DealsPipelineRedirect } = await import('../src/pages/investor/dealflow/DealsPipelineRedirect.jsx');
  const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom');
  for (const [from, countAs, key] of [['/deals/pipeline?scope=all#h', null, null], ['/pipeline?q=x', '/pipeline', 'redirect:/pipeline']]) {
    const restore = installDocument();
    const sent = []; let at = null;
    function Where() { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; }
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => { root.render(h(MemoryRouter, { initialEntries: [from] }, h(Routes, null,
        h(Route, { path: '/deals/pipeline', element: h(DealsPipelineRedirect, { send: (k) => sent.push(k) }) }),
        h(Route, { path: '/pipeline', element: h(DealsPipelineRedirect, { countAs, send: (k) => sent.push(k) }) }),
        h(Route, { path: '/deals', element: h(Where) })))); });
      assert.equal(at, from.startsWith('/deals') ? '/deals?scope=all&view=table#h' : '/deals?q=x&view=table', from);
      assert.deepEqual(sent, key ? [key] : [], `${from} is counted once, by one side`);
    } finally { await act(async () => root.unmount()); restore(); }
  }
});

test('D1109: the Data room\'s old addresses are counted by their forward, never by the address bar, and land on the tool', async () => {
  // D1180 (#3107) adds the retired Capital workspace's default tab; its own test is below.
  assert.deepEqual(FORWARD_REDIRECTS.map((r) => r.path), ['/raise/data-room?mode=workspace', '/raise/data-room?mode=access', '/raise/data-room/:id', '/raise/capital?mode=workspace']);
  for (const { path } of FORWARD_REDIRECTS) assert.ok(isRedirectKey(`redirect:${path}`), `${path} is countable`);
  // The tool's own pages share these shapes, so the address bar counts none of them.
  for (const page of ['/raise/data-room', '/raise/data-room/files', '/raise/data-room/12']) assert.equal(redirectPatternFor(page, '?mode=workspace'), null, page);
  const { DataRoomMovedRedirect } = await import('../src/pages/raise/dataroom/DataRoomMoved.jsx');
  const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom');
  for (const [from, element, key, landed] of [
    ['/raise/data-room?mode=workspace&project_id=12#up', (send) => h(DataRoomMovedRedirect, { kind: 'workspace', send }), 'redirect:/raise/data-room?mode=workspace', '/raise/data-room/files?project_id=12&moved=workspace#up'],
    ['/raise/data-room?mode=access&project_id=12', (send) => h(DataRoomMovedRedirect, { kind: 'access', send }), 'redirect:/raise/data-room?mode=access', '/raise/data-room/access?project_id=12&moved=access'],
    ['/raise/data-room/7?project_id=12', (send) => h(DataRoomMovedRedirect, { kind: 'file', id: '7', send }), 'redirect:/raise/data-room/:id', '/raise/data-room/file/7?project_id=12&moved=file'],
  ]) {
    const restore = installDocument();
    const sent = []; let at = null;
    function Where() { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; }
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => { root.render(h(MemoryRouter, { initialEntries: [from] }, h(Routes, null,
        h(Route, { path: '/raise/data-room', element: element((k) => sent.push(k)) }),
        h(Route, { path: '/raise/data-room/7', element: element((k) => sent.push(k)) }),
        h(Route, { path: '*', element: h(Where) })))); });
      assert.deepEqual(sent, [key], from);
      assert.equal(at, landed, from);
    } finally { await act(async () => root.unmount()); restore(); }
  }
});
