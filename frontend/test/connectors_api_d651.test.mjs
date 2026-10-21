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
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import {
  buildCatalogue, codeWord, companiesLabel, discoverSections, matchesQuery, oauthReturn, withCompanies,
} from '../src/pages/account/connectorsModel.js';
import ConnectorsSection, { ConnectorsView, RequestSheet } from '../src/pages/account/AccountConnectors.jsx';
import { ConnectorPanel, suggestionsNote } from '../src/pages/account/ConnectorSheet.jsx';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';

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

/** Mount with real effects; capture the window keydown listeners so Escape can be pressed. `user` is the signed-in user `AuthProvider` reads. */
async function mount(element, url = '/account/connectors', { user = null } = {}) {
  const restoreDoc = installDocument();
  if (user) localStorage.setItem('user', JSON.stringify(user));
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
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/companyEin\.js';\nexport \* from '\.\/api\/companySheet\.js';\nexport \* from '\.\/api\/connectors\.js';\nexport \* from '\.\/api\/contracts\.js';/);
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

// D753 (#1876): a sign-in return no longer opens a sheet on the hub; the hub
// sends it on to its connector's page. Both cases this test held (a crafted
// return naming a connector the catalogue lacks, and Stripe's refusal in the
// Worker's words, never the provider's) now run on `ConnectorPageView` in
// `connector_page_d753.test.mjs`.
test('a sign-in return on the hub opens no sheet there: it goes on to its page (D753)', async () => {
  const m = await mount(h(ConnectorsView, { data: ready() }), '/account/connectors?oauth=error&provider=stripe&reason=Your+account+is+suspended');
  try {
    await m.flush();
    assert.equal(m.byTestId('connector-sheet-refused'), undefined);
    assert.doesNotMatch(m.text(), /suspended/);
  } finally { await m.unmount(); }
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

test('a sheet with no frame is a Lightbox, and the dialog inside it is another layer on the one Escape stack', async () => {
  // D686 §5.4 (#1597), D753 F8 (#1992): the right-hand side sheet is gone. A
  // panel drawn with no frame opens a centred Lightbox, and a tool's settings
  // dialog is a nested Lightbox: both join the one Escape stack
  // (`ui/lightboxFocus.js`), so one key press closes one layer. The sheet keeps
  // no Escape listener of its own; this stub DOM mounts no Lightbox listener.
  const f = mockFetch({});
  const hub = { ...P('hubspot', 'HubSpot', 'crm', 'live', 'growth', 'oauth2', { supports_pat: true }), by: 'HubSpot', category: 'CRM', connection: { uid: 'u-hub', provider_key: 'hubspot', status: 'active', config: {} } };
  const m = await mount(h(ConnectorPanel, { p: hub, view: 'detail', setView() {}, onClose() {} }));
  try {
    await m.flush();
    const frame = m.byTestId('sheet-dialog');
    assert.ok(frame, 'the sheet opens a Lightbox around itself');
    assert.equal(m.props(frame).role, 'dialog');
    assert.equal(m.props(frame)['aria-modal'], 'true');
    assert.equal(m.props(m.byTestId('connector-sheet-detail'))['data-layout'], 'lightbox');
    await m.click('Change');
    await m.flush();
    const modal = m.byTestId('hubspot-config-modal');
    assert.ok(modal, 'the HubSpot dialog is open');
    assert.equal(m.props(modal).role, 'dialog');
    assert.equal(m.props(modal)['aria-modal'], 'true');
    assert.equal(m.props(modal)['aria-label'], 'HubSpot pipeline');
    assert.equal(m.listeners(), 0, 'the sheet adds no Escape listener beside the stack');
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
  // D753 (#1878): both 412s link to Crunchbase's own page.
  assert.equal((cb.match(/connect_path: connectorPagePath\('crunchbase'\)/g) || []).length, 2);
  assert.doesNotMatch(cb, /connect_path: '\/account\/connectors'/);
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

// ============================================================== D751 (#1879)
// A sign-in that fails on Axal's side says so, never "refused". GitHub joins
// the catalogue for these tests only, so the shared PROVIDERS keep their counts.

const GH_CAT = buildCatalogue({ providers: [...PROVIDERS, P('github', 'GitHub', 'code', 'beta', 'free', 'oauth2')], items: ITEMS, companies: COMPANIES, firstParty: {} });
const gh = () => GH_CAT.find((p) => p.key === 'github');
// The Worker's exact 503 (integrations.ts, `oauth_unconfigured`).
const UNCONFIGURED_503 = { error: 'oauth_unconfigured', provider: 'github', message: 'This integration is not yet configured on the server. Please contact your administrator.' };

for (const reason of ['github_oauth_unconfigured', 'not_configured']) {
  test(`D751: a return with reason=${reason} lands on "not set up on Axal yet", with no Try again`, async () => {
    const m = await mount(h(ConnectorPageView, { data: ready({ catalogue: GH_CAT }), connectorKey: 'github' }), `/account/connectors/github?oauth=error&provider=github&reason=${reason}`);
    try {
      await m.flush();
      // D753 F2 (#1908): the page says a return in its notice region.
      assert.equal(m.props(m.byTestId('connector-page-notice'))['data-kind'], 'unconfigured', 'the unconfigured notice');
      assert.match(m.text(), /GitHub isn't set up on Axal yet, so it can't be connected\. Nothing was connected\./);
      assert.doesNotMatch(m.text(), /refused|Try again|Ask your/);
    } finally { await m.unmount(); }
  });
}

test('D751: a return with reason=company_not_linked says to choose a company', async () => {
  const m = await mount(h(ConnectorPageView, { data: ready({ catalogue: GH_CAT }), connectorKey: 'stripe' }), '/account/connectors/stripe?oauth=error&provider=stripe&reason=company_not_linked');
  try {
    await m.flush();
    assert.equal(m.props(m.byTestId('connector-page-notice'))['data-kind'], 'company');
    assert.doesNotMatch(m.text(), /refused|Try again/);
  } finally { await m.unmount(); }
});

/** GitHub's panel on `pre`, its start answering `startAnswer`, after a click on Continue. */
async function pressGithub(startAnswer, user = null) {
  const f = mockFetch({ 'GET /connectors/oauth/github/start': startAnswer });
  let view = 'pre';
  let m;
  const draw = () => h(ConnectorPanel, { p: gh(), view, setView(v) { view = v; m?.rerender(); }, onClose() {} });
  const Host = () => { const [, tick] = useState(0); host.tick = tick; return draw(); };
  const host = {};
  m = await mount(user ? h(AuthProvider, null, h(Host)) : h(Host), '/account/connectors/github', { user });
  m.rerender = () => host.tick((n) => n + 1);
  await m.click('Continue to GitHub');
  await m.flush();
  return { m, f };
}

test('D751: pressing Continue on an unset GitHub says it is not set up, never "refused" or the Worker\'s sentence', async () => {
  const { m, f } = await pressGithub([503, UNCONFIGURED_503]);
  try {
    assert.ok(m.byTestId('connector-sheet-unconfigured'), 'the unconfigured view');
    assert.match(m.text(), /GitHub isn't set up on Axal yet, so it can't be connected\. Nothing was sent to GitHub\./);
    assert.doesNotMatch(m.text(), /not yet configured on the server|refused|Try again/);
    assert.equal(m.byTestId('connector-unconfigured-admin-link'), undefined, 'no link for a member who cannot save a key');
  } finally { await m.unmount(); f.restore(); }
});

test('D751: a Super Admin also gets the Integration keys link, and a crafted admin_href never becomes it', async () => {
  const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
  for (const [body, want] of [
    [UNCONFIGURED_503, '/admin/integration-keys'],
    [{ ...UNCONFIGURED_503, admin_href: '/admin/integration-keys' }, '/admin/integration-keys'],
    [{ ...UNCONFIGURED_503, admin_href: '/admin?tab=keys-github' }, '/admin?tab=keys-github'],
    [{ ...UNCONFIGURED_503, admin_href: 'https://evil.test/' }, '/admin/integration-keys'],
  ]) {
    const { m, f } = await pressGithub([503, body], SUPER);
    try {
      const link = m.byTestId('connector-unconfigured-admin-link');
      assert.ok(link, `the link (${body.admin_href || 'no admin_href'})`);
      assert.equal(m.props(link).href, want);
      assert.match(m.text(), /Set up GitHub in Integration keys/);
    } finally { await m.unmount(); f.restore(); }
  }
  const { m, f } = await pressGithub([503, UNCONFIGURED_503], { id: 2, role: 'admin', is_super_admin: 0 });
  try {
    assert.ok(m.byTestId('connector-sheet-unconfigured'));
    assert.equal(m.byTestId('connector-unconfigured-admin-link'), undefined, 'a plain Admin cannot save a key, so gets no link');
  } finally { await m.unmount(); f.restore(); }
});

test('D751: Axal unable to read its own setup offers Try again, in its own words', async () => {
  const { m, f } = await pressGithub([503, { error: 'oauth_setup_unreadable', message: "Axal couldn't check whether GitHub is set up. Nothing was sent to GitHub. Try again in a minute." }]);
  try {
    assert.ok(m.byTestId('connector-sheet-setup_unreadable'));
    assert.match(m.text(), /Axal couldn't check whether GitHub is set up/);
    assert.ok([...m.text().matchAll(/Try again/g)].length >= 2, 'the sentence and the button');
    assert.doesNotMatch(m.text(), /refused/);
  } finally { await m.unmount(); f.restore(); }
});

test('D751: HubSpot\'s token with no company chosen says to choose one, not that the key is invalid', async () => {
  const f = mockFetch({ 'POST /connectors/connect': [400, { error: 'active_company_required' }] });
  let view = 'key';
  const host = {};
  const Host = () => { const [, tick] = useState(0); host.tick = tick; return h(ConnectorPanel, { p: byKey('hubspot'), view, setView(v) { view = v; host.tick((n) => n + 1); }, onClose() {} }); };
  const m = await mount(h(Host));
  try {
    // The Worker refuses before reading any key, so the form is submitted as it stands.
    const form = m.byId('connector-key-form');
    assert.ok(form, 'the key form');
    await act(async () => { await m.props(form).onSubmit({ preventDefault() {} }); });
    await m.flush();
    assert.ok(m.byTestId('connector-sheet-company'), 'the company view');
    assert.equal(m.byTestId('connector-sheet-badkey'), undefined);
    assert.doesNotMatch(m.text(), /That key is not valid/);
  } finally { await m.unmount(); f.restore(); }
});

// ============================================================== D751 (#1881)

const OFF = (extra = {}) => ({ ...P('github', 'GitHub', 'code', 'beta', 'free', 'oauth2'), configured: false, ...extra });

for (const [who, user, link] of [
  ['a Super Admin', { id: 1, role: 'admin', is_super_admin: 1 }, true],
  ['a plain Admin', { id: 2, role: 'admin', is_super_admin: 0 }, false],
  ['a founder', { id: 3, role: 'founder' }, false],
]) {
  test(`D751: an unset GitHub reads Not set up here, and ${who} ${link ? 'gets' : 'gets no'} way to its keys`, async () => {
    const f = mockFetch({ 'GET /connectors/available': [200, { providers: [OFF()] }], 'GET /auth/me': [200, user] });
    const m = await mount(h(AuthProvider, null, h(ConnectorsSection)), '/account/connectors?tab=discover', { user });
    try {
      await m.flush();
      assert.match(m.text(), /Not set up here/);
      assert.equal(!!m.byTestId('connector-keys-link-github'), link);
    } finally { await m.unmount(); f.restore(); }
  });
}

test('D751: with no OAuth client, Calendly\'s Continue opens the token form and never starts a sign-in', async () => {
  const [cal] = buildCatalogue({ providers: [{ ...P('calendly', 'Calendly', 'scheduling', 'live', 'free', 'oauth2', { supports_pat: true }), configured: false }], items: [], firstParty: {} });
  const f = mockFetch({});
  let view = 'pre';
  const host = {};
  const Host = () => { const [, tick] = useState(0); host.tick = tick; return h(ConnectorPanel, { p: cal, view, setView(v) { view = v; host.tick((n) => n + 1); }, onClose() {} }); };
  const m = await mount(h(Host));
  try {
    await m.click('Continue');
    await m.flush();
    assert.ok(m.byId('connector-key-form'), 'the token form');
    assert.equal(f.calls.filter((c) => c.path.startsWith('/connectors/oauth/')).length, 0, 'no sign-in was started');
  } finally { await m.unmount(); f.restore(); }
});

test('D751: a rejected token from the key form is badkey, never refused', async () => {
  const [cal] = buildCatalogue({ providers: [{ ...P('calendly', 'Calendly', 'scheduling', 'live', 'free', 'oauth2', { supports_pat: true }), configured: false }], items: [], firstParty: {} });
  const f = mockFetch({ 'POST /connectors/connect': [400, { error: 'connect_failed' }] });
  let view = 'key';
  const host = {};
  const Host = () => { const [, tick] = useState(0); host.tick = tick; return h(ConnectorPanel, { p: cal, view, setView(v) { view = v; host.tick((n) => n + 1); }, onClose() {} }); };
  const m = await mount(h(Host));
  try {
    await act(async () => { await m.props(m.byId('connector-key-form')).onSubmit({ preventDefault() {} }); });
    await m.flush();
    assert.ok(m.byTestId('connector-sheet-badkey'), 'badkey');
    assert.equal(m.byTestId('connector-sheet-refused'), undefined);
    assert.match(m.text(), /That key is not valid\. Check it at Calendly and paste it again\./);
  } finally { await m.unmount(); f.restore(); }
});
