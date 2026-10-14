/**
 * D651 (#1463), the follow-up after D650 (#1462) — the Connectors page on
 * `/api/connectors`, and S1's notes on #1479.
 *
 *   · every connectors call goes through `lib/api/connectors.js` to `/api/connectors`;
 *   · a plan refusal on connect is the sheet's own `pro` view, not the global modal too;
 *   · a 403 shows the Worker's sentence, with no retry;
 *   · companies, suggestions, requests, the teammate notice and "Now fed by" are read and written;
 *   · a crafted sign-in return opens nothing and prints no sentence of its own;
 *   · one search rule for the lists and for "No connector called…";
 *   · Escape closes the inner dialog, not the sheet with it;
 *   · replacing a Crunchbase key always takes a new key.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connectors_api_d651.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import {
  buildCatalogue, codeWord, companiesLabel, discoverSections, matchesQuery, oauthReturn, withCompanies,
} from '../src/pages/account/connectorsModel.js';
import ConnectorsSection, { ConnectorsView, RequestSheet } from '../src/pages/account/AccountConnectors.jsx';
import { ConnectorPanel, suggestionsNote } from '../src/pages/account/ConnectorSheet.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el, entry = '/account/connectors') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const flat = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const P = (key, display_name, integration_type, status, tier, auth_type, extra = {}) => ({
  key, display_name, integration_type, status, tier, auth_type,
  description: `${display_name} description.`, capabilities: [`${display_name} cap one`],
  has_implementation: status !== 'coming_soon', locked_for_user: false, ...extra,
});
const PROVIDERS = [
  P('hubspot', 'HubSpot', 'crm', 'live', 'growth', 'oauth2', { supports_pat: true, feeds: ['capital_relationships', 'network'], pulls: [{ what: 'Deals and contacts', module: 'capital_relationships' }], sends: [] }),
  P('calendly', 'Calendly', 'scheduling', 'live', 'free', 'oauth2'),
  P('crunchbase', 'Crunchbase', 'data_feed', 'beta', 'growth', 'api_key', { capabilities: ['Competitor lookup'] }),
  P('stripe', 'Stripe', 'data_feed', 'live', 'growth', 'oauth2'),
];
const COMPANIES = [{ id: 10, company_name: 'Acme' }, { id: 20, company_name: 'Beta' }];
const ITEMS = [
  { uid: 'u-stripe', provider_key: 'stripe', status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [10] },
  { uid: 'u-cb', provider_key: 'crunchbase', status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [], api_key_preview: 'ab12' },
];
const CAT = buildCatalogue({ providers: PROVIDERS, items: ITEMS, companies: COMPANIES, firstParty: { google: { configured: true, connected: true } } });
const byKey = (k) => CAT.find((p) => p.key === k);
const ready = (extra = {}) => ({ status: 'ready', catalogue: CAT, itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {}, ...extra });

// ------------------------------------------------------------------ a fetch the tests answer

function mockFetch(routes) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = init.method || 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = routes[`${method} ${path}`];
    const [status, body] = typeof hit === 'function' ? hit() : hit || [200, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

/** Mount with real effects; capture the window keydown listeners so Escape can be pressed. */
async function mount(element, url = '/account/connectors') {
  const restoreDoc = installDocument();
  const keyListeners = new Set();
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keyListeners.add(fn); };
  globalThis.removeEventListener = (type, fn) => { if (type === 'keydown') keyListeners.delete(fn); };
  globalThis.dispatchEvent = () => true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    byTestId: (id) => nodes().find((n) => props(n)['data-testid'] === id),
    byId: (id) => nodes().find((n) => props(n).id === id),
    props,
    async flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    async click(label) {
      const n = nodes().find((x) => x.tagName === 'BUTTON' && textOf(x).replace(/\s+/g, ' ').trim() === label);
      if (!n) throw new Error(`Missing button: ${label}`);
      await act(async () => { await props(n).onClick?.({ stopPropagation() {}, preventDefault() {} }); });
    },
    async escape() { await act(async () => { for (const fn of [...keyListeners]) fn({ key: 'Escape' }); }); },
    listeners: () => keyListeners.size,
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

// ------------------------------------------------------------------ the client

test('every connectors call goes to /api/connectors through one module, re-exported from api.js', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const f = mockFetch({});
  try {
    const { connectorsApi } = await import('../src/lib/api/connectors.js');
    await connectorsApi.available();
    await connectorsApi.list();
    await connectorsApi.waitlist();
    await connectorsApi.notifyMe('salesforce');
    await connectorsApi.stopNotify('salesforce');
    await connectorsApi.suggestions();
    await connectorsApi.teammate('hubspot');
    await connectorsApi.sendRequest('Notion', 'Docs');
    await connectorsApi.connect({ provider_key: 'crunchbase', api_key: 'k' });
    await connectorsApi.oauthStart('salesforce', { sandbox: '1', demo: '' });
    await connectorsApi.disconnect('u 1');
    await connectorsApi.sync('u1');
    await connectorsApi.logs('u1', { limit: 10 });
    await connectorsApi.setCompanies('u1', [10, 20]);
    await connectorsApi.fed('u1');
    await connectorsApi.action('u1', 'pipelines');
    await connectorsApi.action('u1', 'save', { a: 1 });
    await connectorsApi.patchConfig('u1', { sync_frequency: 'daily' });
  } finally { f.restore(); }
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
    'GET /connectors/available', 'GET /connectors', 'GET /connectors/waitlist',
    'POST /connectors/notify-me', 'DELETE /connectors/notify-me/salesforce',
    'GET /connectors/suggestions', 'GET /connectors/hubspot', 'POST /connectors/requests',
    'POST /connectors/connect', 'GET /connectors/oauth/salesforce/start?sandbox=1',
    'DELETE /connectors/u%201', 'POST /connectors/u1/sync', 'GET /connectors/u1/logs?limit=10',
    'PUT /connectors/u1/companies', 'GET /connectors/u1/fed',
    'GET /connectors/u1/action/pipelines', 'POST /connectors/u1/action/save', 'PATCH /connectors/u1/config',
  ]);
  assert.deepEqual(f.calls[3].body, { provider_key: 'salesforce' });
  assert.deepEqual(f.calls[7].body, { tool: 'Notion', use: 'Docs' });
  assert.deepEqual(f.calls[13].body, { company_ids: [10, 20] });
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/companyEin\.js';\nexport \* from '\.\/api\/connectors\.js';\nexport \* from '\.\/api\/contracts\.js';/);
  for (const f2 of ['AccountConnectors.jsx', 'ConnectorSheet.jsx', 'ConnectToolSheet.jsx', 'connectorTools.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/account/${f2}`), /api\.integrations\w+\(|['"`]\/integrations\//, `${f2} still calls /api/integrations`);
  }
});

test('a plan refusal on connect opens the sheet’s own view, not the global paywall as well', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const events = [];
  const prevWindow = globalThis.window;
  const prevLocation = globalThis.location;
  globalThis.window = globalThis;
  globalThis.location = { hostname: 'localhost', pathname: '/account/connectors', search: '', hash: '' };
  const prevDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };
  const f = mockFetch({
    'POST /connectors/connect': [402, { error: 'tier_required', required: 'growth', message: 'Growth plan required.' }],
    'GET /connectors/available': [402, { error: 'tier_required', required: 'growth' }],
  });
  try {
    const { connectorsApi } = await import('../src/lib/api/connectors.js');
    const { request } = await import('../src/lib/api.js');
    await assert.rejects(connectorsApi.connect({ provider_key: 'stripe' }), (e) => e.status === 402);
    assert.deepEqual(events, [], 'inlinePaywall: no modal on top of the sheet');
    await assert.rejects(request('/connectors/available'), (e) => e.status === 402);
    assert.deepEqual(events, ['studioos:tier_required'], 'every other 402 still opens it');
  } finally { f.restore(); globalThis.dispatchEvent = prevDispatch; globalThis.window = prevWindow; globalThis.location = prevLocation; }
});

// ------------------------------------------------------------------ the rules

test('companies: each of the member’s companies, ticked by the connection’s company_ids; unread companies are not a guess', () => {
  const stripe = byKey('stripe').connection;
  assert.deepEqual(stripe.companies, [{ company_id: 10, name: 'Acme', enabled: true }, { company_id: 20, name: 'Beta', enabled: false }]);
  assert.equal(companiesLabel(stripe), '1 of 2');
  assert.equal(companiesLabel(withCompanies({ company_ids: [10, 20] }, COMPANIES)), 'All');
  assert.equal(companiesLabel(byKey('crunchbase').connection), 'None');
  assert.equal(companiesLabel(withCompanies({ company_ids: [] }, [])), 'No company');
  assert.equal(companiesLabel(withCompanies({ company_ids: [10] }, null)), null, 'companies unread: null, drawn as Not recorded');
  assert.equal(byKey('google').connection.companies, undefined, 'a first-party connection serves the member, not a company');
});

test('one search rule: capabilities, what it pulls and the modules it feeds all match', () => {
  assert.ok(matchesQuery(byKey('crunchbase'), 'competitor'), 'Crunchbase lists "Competitor lookup"');
  assert.ok(matchesQuery(byKey('hubspot'), 'capital relationships'));
  assert.ok(matchesQuery(byKey('hubspot'), 'deals and'));
  assert.ok(!matchesQuery(byKey('stripe'), 'competitor'));
  assert.equal(discoverSections(CAT, 'All', { q: 'competitor' })[0].cards.map((p) => p.key).join(), 'crunchbase');
});

test('suggestions name their connector by provider_key, with the Worker’s reason', () => {
  const [s] = discoverSections(CAT, 'Suggested for you', { suggestions: [{ provider_key: 'calendly', module: 'customer_research', reason: 'No interviews yet.' }, { provider_key: 'nope' }] });
  assert.deepEqual(s.cards.map((p) => [p.key, p.why]), [['calendly', 'No interviews yet.']]);
  assert.match(suggestionsNote({ status: 400, code: 'active_company_required' }), /Choose a company/);
  assert.equal(suggestionsNote({ status: 503 }), 'Suggestions could not be read.');
});

test('a crafted sign-in return: only a code word is printed, and only a code-word provider is named', () => {
  assert.equal(codeWord('server_error'), 'server_error');
  assert.equal(codeWord('Call us at 555'), '');
  assert.equal(codeWord('constructor'), 'constructor', 'a word, but never looked up: oauthReturn reads it as text only');
  assert.deepEqual(oauthReturn('?oauth=error&provider=stripe&reason=Your+account+is+suspended.+Call+555').reason, '');
  assert.equal(oauthReturn('?oauth=error&provider=evil%20co&reason=x'), null);
  assert.equal(oauthReturn('?google=error&reason=Pay+now').reason, 'unknown');
  assert.equal(oauthReturn('?linkedin=error&linkedin_error=<b>hi</b>').reason, 'unknown');
  const r = oauthReturn('?google=connected&warn=google_email_mismatch&google_email=Visit+evil.example');
  assert.doesNotMatch(r.banner, /evil/, 'only an address-shaped value is printed');
  assert.match(oauthReturn('?google=connected&warn=google_email_mismatch&google_email=me%40example.test').banner, /me@example\.test/);
});

// ------------------------------------------------------------------ the screens

test('a 403 shows the Worker’s sentence and offers no retry', () => {
  const out = flat(html(h(ConnectorsView, { data: { status: 'forbidden', message: 'Your role cannot manage integrations.', catalogue: [], reload() {} } })));
  assert.match(out, /Connectors .* Your role cannot manage integrations\./);
  assert.doesNotMatch(out, /could not be read|Try again/);
});

test('Yours: a query matching only connectors you have not connected says "No connector called…"', () => {
  const out = flat(html(h(ConnectorsView, { data: ready(), initialQuery: 'Calendly' })));
  assert.match(out, /No connector called ‘Calendly’\. Request it\./);
  assert.doesNotMatch(out, /0 of 0/);
  assert.match(flat(html(h(ConnectorsView, { data: ready(), initialQuery: 'competitor' }))), /Crunchbase/, 'a capability match on a connected tool is a match');
  assert.match(flat(html(h(ConnectorsView, { data: ready(), initialTab: 'discover', initialQuery: 'Calendly' }))), /Calendly description/);
});

test('a sign-in return naming a connector the catalogue does not hold opens no sheet', async () => {
  const m = await mount(h(ConnectorsView, { data: ready() }), '/account/connectors?oauth=error&provider=notreal&reason=Call_us');
  try {
    await m.flush();
    assert.equal(m.byTestId('connector-sheet-refused'), undefined);
    assert.doesNotMatch(m.text(), /notreal|Call_us/);
  } finally { await m.unmount(); }
  const ok = await mount(h(ConnectorsView, { data: ready() }), '/account/connectors?oauth=error&provider=stripe&reason=Your+account+is+suspended');
  try {
    await ok.flush();
    assert.ok(ok.byTestId('connector-sheet-refused'));
    assert.match(ok.text(), /Stripe refused access\. Ask your Stripe admin/);
    assert.doesNotMatch(ok.text(), /suspended/);
  } finally { await ok.unmount(); }
});

test('the request form stores the request, and says so', async () => {
  const f = mockFetch({ 'POST /connectors/requests': [201, { ok: true, id: 4 }] });
  const m = await mount(h(RequestSheet, { onClose() {}, tool: 'Notion' }));
  try {
    await act(async () => { m.props(m.byId('request-use')).onChange({ target: { value: 'Board notes' } }); });
    await m.click('Send request');
    await m.flush();
    assert.deepEqual(f.calls.map((c) => [c.method, c.path, c.body]), [['POST', '/connectors/requests', { tool: 'Notion', use: 'Board notes' }]]);
    assert.match(m.text(), /Requested\. The studio reads every request/);
  } finally { await m.unmount(); f.restore(); }
});

test('the teammate notice: "Use theirs, or connect your own"; none for a first-party connector', async () => {
  const f = mockFetch({ 'GET /connectors/calendly': [200, { ok: true, provider_key: 'calendly', teammate: { name: 'Ana' } }] });
  let closed = 0;
  const m = await mount(h(ConnectorPanel, { p: byKey('calendly'), view: 'pre', setView() {}, onClose() { closed += 1; } }));
  try {
    await m.flush();
    assert.ok(m.byTestId('connector-sheet-teammate'));
    assert.match(m.text(), /Ana already connected Calendly for your active company\. Use theirs, or connect your own\. Connect my own Use theirs/);
    await m.click('Connect my own');
    assert.match(m.text(), /Before you sign in, here is what StudioOS will do\./);
    assert.doesNotMatch(m.text(), /Ana already/);
  } finally { await m.unmount(); }
  const again = await mount(h(ConnectorPanel, { p: byKey('calendly'), view: 'pre', setView() {}, onClose() { closed += 1; } }));
  try {
    await again.flush();
    await again.click('Use theirs');
    assert.equal(closed, 1, 'using theirs closes the flow');
  } finally { await again.unmount(); }
  const g = await mount(h(ConnectorPanel, { p: { ...byKey('google'), connection: null }, view: 'pre', setView() {}, onClose() {} }));
  try {
    await g.flush();
    assert.ok(!f.calls.some((c) => c.path === '/connectors/google'), 'a first-party connector is not looked up');
  } finally { await g.unmount(); f.restore(); }
  const none = mockFetch({ 'GET /connectors/calendly': [200, { ok: true, teammate: null }] });
  const n = await mount(h(ConnectorPanel, { p: byKey('calendly'), view: 'pre', setView() {}, onClose() {} }));
  try {
    await n.flush();
    assert.ok(n.byTestId('connector-sheet-pre'));
  } finally { await n.unmount(); none.restore(); }
});

test('companies are ticked from the sheet and the Worker’s answer is what the boxes show; "Now fed by" counts each module', async () => {
  let changed = 0;
  const f = mockFetch({
    'PUT /connectors/u-stripe/companies': [200, { ok: true, company_ids: [10, 20] }],
    'GET /connectors/u-stripe/fed': [200, { ok: true, modules: [
      { module: 'revenue', label: 'Revenue and traction', count: 3, linked: 3, unlanded: 0, reason: null },
      { module: 'network', label: 'Network', count: null, reason: 'Not recorded: this connector does not yet record what it delivers to each module.' },
    ] }],
    'GET /connectors/u-stripe/logs?limit=10': [200, { items: [] }],
  });
  const m = await mount(h(ConnectorPanel, { p: byKey('stripe'), view: 'detail', setView() {}, onClose() {}, onChanged() { changed += 1; } }));
  try {
    await m.flush();
    assert.match(m.text(), /Companies Acme Beta/);
    assert.equal(m.props(m.byTestId('connector-company-10')).checked, true);
    assert.equal(m.props(m.byTestId('connector-company-20')).checked, false);
    await act(async () => { await m.props(m.byTestId('connector-company-20')).onChange({ target: { checked: true } }); });
    await m.flush();
    assert.deepEqual(f.calls.find((c) => c.method === 'PUT').body, { company_ids: [10, 20] });
    assert.equal(m.props(m.byTestId('connector-company-20')).checked, true);
    assert.equal(changed, 1);
    assert.match(m.text(), /Now fed by Stripe Revenue and traction 3 items Network Not recorded/);
    assert.doesNotMatch(m.text(), /does not yet record what it delivers/, 'the reason is the Not recorded mark’s, not a second line');
  } finally { await m.unmount(); f.restore(); }
});

test('Escape closes the dialog inside the sheet, not the sheet with it', async () => {
  let closed = 0;
  const f = mockFetch({});
  const hub = { ...P('hubspot', 'HubSpot', 'crm', 'live', 'growth', 'oauth2', { supports_pat: true }), by: 'HubSpot', category: 'CRM', connection: { uid: 'u-hub', provider_key: 'hubspot', status: 'active', config: {} } };
  const m = await mount(h(ConnectorPanel, { p: hub, view: 'detail', setView() {}, onClose() { closed += 1; } }));
  try {
    await m.flush();
    await m.click('Change');
    await m.flush();
    assert.equal(m.listeners(), 1, 'only the top dialog acts on Escape (D686: one stack)');
    await m.escape();
    assert.equal(closed, 0, 'the sheet stays open');
    assert.equal(m.listeners(), 1, 'the sheet is the top dialog again once the dialog is gone');
    await m.escape();
    assert.equal(closed, 1);
  } finally { await m.unmount(); f.restore(); }
});

test('replacing a Crunchbase key always takes a new one', () => {
  const key = html(h(ConnectorPanel, { p: byKey('crunchbase'), view: 'key', setView() {}, onClose() {} }));
  assert.match(flat(key), /New Crunchbase user key/);
  assert.doesNotMatch(flat(key), /leave blank/);
  assert.match(key, /data-testid="crunchbase-user-key"/);
  assert.match(key, /<input id="connector-key" type="password"[^>]* required=""/);
  const stripeKey = html(h(ConnectorPanel, { p: { ...byKey('stripe'), auth_type: 'api_key' }, view: 'key', setView() {}, onClose() {} }));
  assert.doesNotMatch(stripeKey, /<input id="connector-key"[^>]* required=""/, 'another key may still be kept by leaving it blank');
});

test('nothing points a member at the old Integrations address any more', async () => {
  const cb = read('cloudflare-worker/src/routes/crunchbase.ts');
  assert.doesNotMatch(cb, /connect_path: '\/account\/integrations'/);
  assert.equal((cb.match(/connect_path: '\/account\/connectors'/g) || []).length, 2);
  assert.doesNotMatch(cb, /Settings → Integrations/);
  assert.doesNotMatch(read('cloudflare-worker/src/services/onboardingChecklist.ts'), /route: '\/(?:account\/)?integrations'/);
  const { HELP_SURFACES, GUIDE_PLACEMENT } = await import('../src/pages/docs/guidePlacement.js');
  assert.ok(HELP_SURFACES['/account/connectors']);
  assert.equal(HELP_SURFACES['/account/integrations'], undefined);
  assert.ok(!Object.values(GUIDE_PLACEMENT).some((g) => g.surface === '/account/integrations'));
  assert.doesNotMatch(read('documentation/architecture/GOTCHAS.md'), /IntegrationsPage/);
  assert.doesNotMatch(read('cloudflare-worker/src/routes/README.md'), /IntegrationsPage/);
});

test('the shared read: a 403 on the catalogue is "forbidden" with the Worker’s sentence', async () => {
  const f = mockFetch({ 'GET /connectors/available': [403, { error: 'forbidden', message: 'Your role cannot manage integrations.' }] });
  const m = await mount(h(ConnectorsSection));
  try {
    await m.flush();
    await m.flush();
    assert.ok(m.byTestId('connectors-forbidden'));
    assert.match(m.text(), /Your role cannot manage integrations\./);
    assert.equal(m.byTestId('connectors-unreadable'), undefined);
  } finally { await m.unmount(); f.restore(); }
});
