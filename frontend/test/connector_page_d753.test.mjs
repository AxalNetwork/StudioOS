/**
 * D753 (#1876, F1) — every connector has its own page at
 * `/account/connectors/<key>`: the route, the key rules, the page's states,
 * the sign-in return that lands on it, the `page` layout of today's panel,
 * every way into it, the hub's tab in the address, the phone bar, the title
 * and Details. No test calls a provider or the network: `fetch` is stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_page_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';

import { buildCatalogue, connectorPagePath, connectorsRedirect } from '../src/pages/account/connectorsModel.js';
import { accountPathFor, connectorKeyFor } from '../src/pages/account/accountPhone.js';
import {
  DETAIL_MISSING, PAGE_ALIAS, backHrefFor, detailsRows, hubSearchFor, hubTabFor, interimMode, pageEntry, pageReturn, pageTitle,
} from '../src/pages/account/connectorPageModel.js';
import { ConnectorsView } from '../src/pages/account/AccountConnectors.jsx';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { ConnectToolView } from '../src/pages/account/ConnectToolSheet.jsx';
import { BRANCH_MANAGED, NOT_OFFERED } from '../src/pages/account/mercuryModel.js';

const h = React.createElement;
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'oauth2',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: true, locked_for_user: false, connection_source: 'integrations', pulls: [], sends: [], feeds: [], ...extra,
});
const PROVIDERS = [
  P('stripe', 'Stripe', { category: 'Accounting and banking', pulls: [{ what: 'Charges', module: 'revenue' }] }),
  P('calendly', 'Calendly'),
  P('github', 'GitHub', { category: 'Code' }),
  P('crunchbase', 'Crunchbase', { auth_type: 'api_key', docs_url: 'http://example.test/crunchbase' }),
  P('salesforce', 'Salesforce', { status: 'coming_soon', has_implementation: false }),
  P('mercury', 'Mercury', { auth_type: 'api_key', has_implementation: false, category: 'Accounting and banking', connection_source: 'mercury_entity_connections' }),
];
const ITEMS = [
  { uid: 'u-stripe', provider_key: 'stripe', status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [] },
  { uid: 'u-gh', provider_key: 'github', status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [] },
];
const CAT = buildCatalogue({ providers: PROVIDERS, items: ITEMS, firstParty: { google: { configured: true, connected: false }, microsoft: { configured: false, connected: false }, linkedin: null } });
const NO_MERCURY = CAT.filter((p) => p.key !== 'mercury');
const ready = (catalogue = CAT, extra = {}) => ({ status: 'ready', catalogue, items: [], itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {}, ...extra });

// ---------------------------------------------------------------- harness

function mockFetch(routes = {}) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = init.method || 'GET';
    calls.push({ method, path });
    const hit = routes[`${method} ${path}`];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [200, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

let seen = null;
function Probe() { seen = useLocation(); return null; }

async function mount(element, url = '/account/connectors/stripe') {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const keyListeners = new Set();
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keyListeners.add(fn); };
  globalThis.removeEventListener = (type, fn) => { if (type === 'keydown') keyListeners.delete(fn); };
  globalThis.dispatchEvent = () => true;
  globalThis.window.location.assign = () => {};
  seen = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, element, h(Probe)) }))));
  });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    by, props, nodes, settle, listeners: () => keyListeners.size,
    text: () => textOf(container).replace(/\s+/g, ' '),
    all: (pred) => nodes().filter(pred),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}
const page = (key, extra = {}) => h(ConnectorPageView, { data: ready(), connectorKey: key, ...extra });

// ================================================================ the route

const declared = () => [...readRoutesSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const bestMatch = (url) => matchRoutes(declared().map((path) => ({ path })), url)?.at(-1);

test('the route: /account/connectors/:key beside /account/:section, for the same six roles', () => {
  const app = read('frontend/src/App.jsx');
  // The role list of the route declared for a path, read with one fixed pattern.
  const roles = (path) => [...app.matchAll(/<Route path="([^"]+)" element=\{guard\((\[[^\]]*\]), <SettingsPage \/>\)\} \/>/g)]
    .find((m) => m[1] === path)?.[2];
  assert.ok(roles('/account/connectors/:key'), 'the connector route');
  assert.equal(roles('/account/connectors/:key'), roles('/account/:section'));
  const github = bestMatch('/account/connectors/github');
  assert.equal(github.route.path, '/account/connectors/:key');
  assert.equal(github.params.key, 'github');
  assert.equal(bestMatch('/account/connectors').route.path, '/account/:section');
  assert.equal(bestMatch('/account/email/confirm').route.path, '/account/email/confirm');
  assert.equal(bestMatch('/account/connectors/github/extra').route.path, '*');
});

test('the key: a lowercased code word of 1 to 40 characters, kept by the canonicalising effect', () => {
  for (const p of ['/account/connectors/github', '/account/connectors/github/', '/account/connectors/GitHub']) assert.equal(connectorKeyFor(p), 'github', p);
  for (const p of ['/account/connectors', '/account/usage/github', '/account/connectors/%3Cx%3E', '/account/connectors/a.b', '/account/connectors/a-b', `/account/connectors/${'a'.repeat(41)}`]) {
    assert.equal(connectorKeyFor(p), null, p);
  }
  for (const phone of [true, false]) assert.equal(accountPathFor({ section: 'connectors', phone, key: 'github' }), '/account/connectors/github');
  assert.equal(accountPathFor({ section: 'usage', key: 'github' }), '/account/usage');
  assert.equal(accountPathFor({ section: 'connectors', key: 'a-b' }), '/account/connectors');
  const settings = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(settings, /const connectorKey = active === 'connectors' \? connectorKeyFor\(location\.pathname\) : null;/);
  assert.match(settings, /const want = accountPathFor\(\{ section: active, phone, key: connectorKey \}\);/);
  assert.equal(connectorPagePath('Stripe'), '/account/connectors/stripe');
  assert.equal(connectorPagePath('../x'), '/account/connectors');
});

// ================================================================ the page's states

test('an alias lands on its connector, keeping the query and hash; toString and __proto__ are not aliases', async () => {
  const f = mockFetch();
  const g = await mount(page('google_calendar'), '/account/connectors/google_calendar?google=connected#x');
  try {
    assert.equal(`${seen.pathname}${seen.search}${seen.hash}`, '/account/connectors/google?google=connected#x');
  } finally { await g.unmount(); }
  const m = await mount(page('microsoft_365'), '/account/connectors/microsoft_365');
  try { assert.equal(seen.pathname, '/account/connectors/microsoft'); } finally { await m.unmount(); f.restore(); }
  assert.deepEqual(Object.keys(PAGE_ALIAS).sort(), ['google_calendar', 'microsoft_365']);
  for (const k of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) assert.equal(pageEntry({ data: ready(), key: k }).state, 'unknown', k);
});

test('an unknown key: its sentence, Request it inline in the page frame, and no read', async () => {
  const f = mockFetch();
  const m = await mount(page('notion'), '/account/connectors/notion');
  try {
    assert.match(m.text(), /No connector called “\s*notion\s*”\. Request it\./);
    assert.equal(m.props(m.by('connector-page-back')).href, '/account/connectors');
    assert.equal(m.by('connector-page-connect'), undefined);
    assert.equal(f.calls.length, 0, 'no fetch');
    await m.click('connector-page-request');
    const form = m.all((n) => m.props(n)['data-layout'] === 'page');
    assert.ok(form.length, 'the request form is in the page frame');
    assert.ok(!m.all((n) => m.props(n).role === 'dialog').length, 'no dialog');
  } finally { await m.unmount(); f.restore(); }
  for (const k of ['__proto__', 'constructor']) {
    const out = flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: [`/account/connectors/${k}`] }, page(k))));
    assert.ok(out.includes(`No connector called “${k}”`), k);
  }
});

test('Mercury not offered: the profile\'s sentence, or the branch one, and never a request', () => {
  const html = (o) => flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/mercury'] }, page('mercury', { data: ready(NO_MERCURY), ...o }))));
  assert.ok(html({}).includes(NOT_OFFERED));
  assert.ok(html({ branchAdmin: true }).includes(BRANCH_MANAGED));
  assert.doesNotMatch(html({}), /Request it/);
  assert.equal(pageEntry({ data: ready(NO_MERCURY), key: 'mercury' }).state, 'not_offered');
});

test('loading, forbidden (no Retry) and unreadable (Retry calls reload)', async () => {
  const html = (data) => flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/stripe'] }, page('stripe', { data }))));
  assert.match(html({ status: 'loading', catalogue: [], reload() {} }), /Loading connector…/);
  const forbidden = html({ status: 'forbidden', message: 'Your role cannot manage integrations.', catalogue: [], reload() {} });
  assert.match(forbidden, /Your role cannot manage integrations\./);
  assert.doesNotMatch(forbidden, /Retry/);
  let reloads = 0;
  const m = await mount(page('stripe', { data: { status: 'unreadable', catalogue: [], reload() { reloads += 1; } } }));
  try {
    assert.match(m.text(), /Retry/);
    const btn = m.nodes().find((n) => n.tagName === 'BUTTON');
    await act(async () => { m.props(btn).onClick(); });
    assert.equal(reloads, 1);
  } finally { await m.unmount(); }
});

// ================================================================ the return

test('a Mercury return never reaches the Mercury page; the page\'s own mount is the one entity read', async () => {
  assert.deepEqual(connectorsRedirect({ search: '?oauth=ok&provider=mercury', hash: '' }), { pathname: '/account/connectors', search: '', hash: '' });
  assert.deepEqual(connectorsRedirect({ search: '?oauth=ok&provider=mercury&tab=discover', hash: '' }), { pathname: '/account/connectors', search: '?tab=discover', hash: '' });
  const f = mockFetch();
  const reads = () => f.calls.filter((c) => c.path === '/admin/mercury/connections').length;
  const hub = await mount(h(ConnectorsView, { data: ready() }), '/account/connectors?oauth=ok&provider=mercury');
  try {
    assert.equal(seen.pathname, '/account/connectors');
    assert.equal(seen.search, '');
    assert.equal(reads(), 0);
  } finally { await hub.unmount(); }
  const m = await mount(page('mercury'), '/account/connectors/mercury?oauth=ok&provider=mercury');
  try {
    assert.equal(reads(), 1, 'the page\'s mount');
    const sheet = m.by('mercury-entity-sheet');
    assert.ok(sheet && m.props(sheet)['data-layout'] === 'page', 'in the page layout');
    assert.equal(m.by('connector-sheet-connected'), undefined, 'no return view');
    assert.equal(seen.search, '', 'the query is stripped');
  } finally { await m.unmount(); f.restore(); }
});

test('a crafted return: another key\'s is ignored and stripped; Stripe\'s refusal is in Axal\'s words; an unknown key prints only its code word', async () => {
  const f = mockFetch();
  const other = await mount(page('stripe'), '/account/connectors/stripe?oauth=error&provider=hubspot&reason=x');
  try {
    // D753 F2 (#1908): a return is said in the notice region; another key's says nothing.
    assert.equal(other.by('connector-page-notice'), undefined);
    assert.ok(other.by('connector-page-action'));
    assert.equal(seen.search, '');
  } finally { await other.unmount(); }
  const own = await mount(page('stripe'), '/account/connectors/stripe?oauth=error&provider=stripe&reason=Your+account+is+suspended');
  try {
    assert.equal(own.props(own.by('connector-page-notice'))['data-kind'], 'refused');
    assert.match(own.text(), /Stripe refused access\. Ask your Stripe admin/);
    assert.doesNotMatch(own.text(), /suspended/);
  } finally { await own.unmount(); }
  const bad = await mount(page('notreal'), '/account/connectors/notreal?oauth=error&provider=notreal&reason=Call_us');
  try {
    assert.ok(bad.by('connector-page-unknown'));
    assert.doesNotMatch(bad.text(), /Call_us/);
  } finally { await bad.unmount(); f.restore(); }
  assert.deepEqual(pageReturn('?oauth=ok&provider=hubspot', 'stripe'), { ret: null, strip: ['oauth', 'provider', 'reason'] });
  assert.equal(pageReturn('?oauth=ok&provider=mercury', 'mercury').ret, null);
  assert.equal(pageReturn('?tab=discover', 'stripe'), null);
});

test('every return lands on its page; the hub sends a bookmarked one on; the page shows the outcome', async () => {
  for (const [search, key] of [['?oauth=ok&provider=stripe', 'stripe'], ['?google=connected', 'google'], ['?microsoft=connected', 'microsoft'],
    ['?linkedin=connected', 'linkedin'], ['?oauth=error&provider=github&reason=not_configured', 'github']]) {
    assert.deepEqual(connectorsRedirect({ search, hash: '#h' }), { pathname: `/account/connectors/${key}`, search, hash: '#h' }, search);
  }
  assert.deepEqual(connectorsRedirect({ search: '?tab=discover', hash: '' }), { pathname: '/account/connectors', search: '?tab=discover', hash: '' });
  const f = mockFetch({ 'GET /connectors/u-gh/repositories': [200, { repositories: [] }] });
  const hub = await mount(h(ConnectorsView, { data: ready() }), '/account/connectors?oauth=ok&provider=stripe');
  try { assert.equal(`${seen.pathname}${seen.search}`, '/account/connectors/stripe?oauth=ok&provider=stripe'); } finally { await hub.unmount(); }
  const stripe = await mount(page('stripe'), '/account/connectors/stripe?oauth=ok&provider=stripe');
  try { assert.equal(stripe.props(stripe.by('connector-page-notice'))['data-kind'], 'connected'); } finally { await stripe.unmount(); }
  const gh = await mount(page('github'), '/account/connectors/github?oauth=ok&provider=github');
  try { assert.ok(gh.by('connector-sheet-sync'), 'GitHub\'s sign-in lands on its repositories'); } finally { await gh.unmount(); f.restore(); }
});

// ================================================================ the page layout

test('the page layout: no ×, no dialog, no Escape of its own, the panel title an h2; Build\'s lightbox keeps its ×', async () => {
  const f = mockFetch();
  const m = await mount(page('stripe'));
  try {
    assert.equal(m.by('sheet-close'), undefined);
    assert.ok(!m.all((n) => m.props(n).role === 'dialog').length);
    assert.equal(m.listeners(), 0, 'no keydown listener');
    const panel = m.all((n) => m.props(n)['data-layout'] === 'page')[0];
    assert.ok(panel, 'the panel is in the page layout');
    const head = panel.childNodes[0];
    assert.ok(m.all((n) => n.tagName === 'H2').some((n) => isInside(n, head)), 'the panel\'s title is an h2');
    assert.equal(m.all((n) => n.tagName === 'H1').length, 1, 'the name is the one h1');
  } finally { await m.unmount(); }
  const build = await mount(h(ConnectToolView, { data: ready(), onClose() {}, deepLink: '?tool=stripe' }), '/build/connect?tool=stripe');
  try {
    assert.ok(build.all((n) => build.props(n)['data-layout'] === 'lightbox').length, 'Build\'s lightbox is untouched');
    assert.ok(build.by('sheet-close'), 'with its ×');
  } finally { await build.unmount(); f.restore(); }
});
const isInside = (n, root) => { for (let x = n; x; x = x.parentNode) if (x === root) return true; return false; };

// ================================================================ every way in

/** The href of the `<a>` carrying a testid, whatever its attribute order; null when it is not a link. */
const hrefOf = (html, testid) => {
  const tag = (html.match(/<a\b[^>]*>/g) || []).find((t) => t.includes(` data-testid="${testid}"`));
  return tag ? tag.match(/href="([^"]*)"/)?.[1] ?? null : null;
};

test('every card, row and phone row links its page; nothing on the hub opens a sheet', () => {
  const discover = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors'] }, h(ConnectorsView, { data: ready(), initialTab: 'discover' })));
  assert.equal(hrefOf(discover, 'connector-open-calendly'), '/account/connectors/calendly', 'the "+"');
  assert.equal(hrefOf(discover, 'connector-open-stripe'), '/account/connectors/stripe', 'the check');
  assert.equal(hrefOf(discover, 'connector-open-mercury'), '/account/connectors/mercury', 'the entity Open');
  // D753 F6 (#1877): one stretched link per card, `connector-open-<key>`, covers the whole card.
  for (const k of ['calendly', 'stripe', 'salesforce', 'crunchbase']) assert.equal(hrefOf(discover, `connector-open-${k}`), `/account/connectors/${k}`, k);
  assert.match(discover, /data-testid="connector-card-salesforce" data-action="notify"/);
  const yours = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors'] }, h(ConnectorsView, { data: ready() })));
  assert.equal(hrefOf(yours, 'connector-row-stripe'), '/account/connectors/stripe');
  const phone = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors'] }, h(ConnectorsView, { data: ready(), phone: true })));
  assert.equal(hrefOf(phone, 'connector-row-stripe'), '/account/connectors/stripe');
  for (const html of [discover, yours, phone]) assert.doesNotMatch(html, /data-testid="connector-sheet-/);
  const src = read('frontend/src/pages/account/AccountConnectors.jsx');
  assert.doesNotMatch(src, /setSheet|ConnectorPanel/);
  assert.match(src, /navigate\(connectorPagePath\(key\)\)/);
});

test('the hub\'s tab is in the address, and "← Connectors" returns to it', () => {
  assert.equal(hubTabFor('?tab=discover'), 'discover');
  assert.equal(hubTabFor('?tab=yours', 'discover'), 'yours');
  assert.equal(hubTabFor('', 'discover'), 'discover');
  assert.equal(hubTabFor('?tab=evil'), 'yours');
  assert.equal(hubSearchFor('?q=1', 'discover'), '?q=1&tab=discover');
  assert.equal(hubSearchFor('?tab=discover&q=1', 'yours'), '?q=1');
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors?tab=discover'] }, h(ConnectorsView, { data: ready() })));
  assert.match(html, /data-tab="discover"/);
  assert.equal(backHrefFor({ connectorsTab: 'discover' }), '/account/connectors?tab=discover');
  assert.equal(backHrefFor({ connectorsTab: 'https://evil.example' }), '/account/connectors');
  assert.equal(backHrefFor(null), '/account/connectors');
});

test('phone: the bar names the connector as the h1, a 48px tile, no "← Connectors"; desktop: the 56px tile and the h1 in the band', () => {
  const draw = (phone) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/stripe'] }, page('stripe', { phone })));
  const ph = draw(true);
  assert.match(ph, /<a[^>]*href="\/account\/connectors"[^>]*>‹ Connectors<\/a>/);
  assert.match(ph, /<h1[^>]*>Stripe<\/h1>/);
  assert.match(ph, /width:48px;height:48px/);
  assert.doesNotMatch(ph, /← Connectors/);
  const desk = draw(false);
  assert.match(desk, /← Connectors/);
  assert.match(desk, /width:56px;height:56px/);
  assert.match(desk, /<h1[^>]*>Stripe<\/h1>/);
  assert.doesNotMatch(desk, /‹ Back/);
  const src = read('frontend/src/pages/account/ConnectorPage.jsx');
  for (const m of src.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 390, m[0]);
  assert.doesNotMatch(src, /overflow-x/);
});

test('the title while mounted, restored after; Details from today\'s fields, a missing value Not recorded', async () => {
  const f = mockFetch();
  const m = await mount(page('stripe'));
  document.title = document.title || 'Before';
  try {
    assert.equal(document.title, 'Stripe · Connectors · Axal VC');
  } finally { await m.unmount(); f.restore(); }
  assert.equal(pageTitle({ state: 'unknown' }), 'Connectors · Axal VC');
  const rows = Object.fromEntries(detailsRows(CAT.find((p) => p.key === 'stripe')).map((r) => [r.label, r]));
  assert.equal(rows.Category.value, 'Accounting and banking');
  assert.equal(rows.Status.value, 'Live');
  assert.equal(rows.Plan.value, 'Free');
  assert.equal(rows['Sign-in'].value, 'Sign in with Stripe');
  assert.equal(rows.Documentation.href, 'https://example.test/stripe');
  const cb = Object.fromEntries(detailsRows(CAT.find((p) => p.key === 'crunchbase')).map((r) => [r.label, r]));
  assert.equal(cb.Documentation.value, null, 'an http: link is not linked');
  assert.equal(cb.Documentation.reason, DETAIL_MISSING);
  assert.equal(cb['Sign-in'].value, 'API key');
  const out = flat(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors/crunchbase'] }, page('crunchbase'))));
  assert.match(out, /Documentation Not recorded/);
  assert.equal(interimMode(CAT.find((p) => p.key === 'salesforce')), 'waitlist');
  assert.equal(interimMode(CAT.find((p) => p.key === 'stripe')), 'panel');
});
