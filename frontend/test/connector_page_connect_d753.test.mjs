/**
 * D753 (#1908, F2) — connect from the connector's page: the band's one action
 * (`pageAction`, one case per row of decision 6's table), the split chevron
 * (`pageChoices`), the inline key form, the notice region (`pageNotice`), and
 * the hook the page shares with the side sheet and Build's lightbox
 * (`useConnectFlow`). No test calls a provider or the network: `fetch` and
 * `window.location.assign` are stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_page_connect_d753.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { TIER_LABEL, buildCatalogue } from '../src/pages/account/connectorsModel.js';
import { keyHelpOf, keyPath, pageAction, pageChoices, pageNotice } from '../src/pages/account/connectorPageModel.js';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';

const h = React.createElement;

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'live', tier: 'free', auth_type: 'oauth2',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: true, locked_for_user: false, connection_source: 'integrations', pulls: [], sends: [], feeds: [], ...extra,
});
const PROVIDERS = [
  P('stripe', 'Stripe'),
  P('calendly', 'Calendly', { supports_pat: true }),
  P('hubspot', 'HubSpot', { supports_pat: true }),
  P('salesforce', 'Salesforce'),
  P('docusign', 'DocuSign'),
  P('crunchbase', 'Crunchbase', { auth_type: 'api_key' }),
  P('mercury', 'Mercury', { auth_type: 'api_key' }),
  P('carta', 'Carta', { tier: 'studio', locked_for_user: true }),
  P('affinity', 'Affinity', { status: 'coming_soon', has_implementation: false }),
  P('attio', 'Attio', { status: 'coming_soon', has_implementation: false }),
  P('github', 'GitHub', { configured: false }),
  P('slack', 'Slack'),
  P('zoom', 'Zoom', { auth_type: 'api_key' }),
  P('entity', 'Mercury entities', { auth_type: 'api_key', connection_source: 'mercury_entity_connections' }),
];
const ITEMS = [
  { uid: 'u-slack', provider_key: 'slack', status: 'active', last_synced_at: null, last_error: null, config: {}, company_ids: [] },
  { uid: 'u-zoom', provider_key: 'zoom', status: 'error', last_synced_at: null, last_error: 'invalid_grant: token expired', config: {}, company_ids: [] },
];
const CAT = buildCatalogue({ providers: PROVIDERS, items: ITEMS, waitlist: [{ provider_key: 'attio' }], firstParty: { google: { configured: true, connected: false }, linkedin: null } });
const row = (key) => CAT.find((p) => p.key === key);
const ready = (catalogue = CAT) => ({ status: 'ready', catalogue, items: [], itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {} });

// ---------------------------------------------------------------- pure rules

test('pageAction: one action per row of decision 6\'s table', () => {
  const stripe = pageAction(row('stripe'));
  assert.deepEqual([stripe.kind, stripe.label, stripe.aria], ['oauth', 'Connect to Axal VC', 'Connect Stripe to Axal VC']);
  assert.equal(pageAction(row('google')).kind, 'oauth', 'a first-party sign-in is a sign-in');
  for (const key of ['crunchbase', 'mercury', 'hubspot']) assert.equal(pageAction(row(key)).kind, 'key', key);
  const calendlyOff = buildCatalogue({ providers: [P('calendly', 'Calendly', { supports_pat: true, configured: false })], items: [], firstParty: {} })[0];
  assert.equal(pageAction(calendlyOff).kind, 'key', 'Calendly with no OAuth client connects with its token (D751)');
  assert.equal(pageAction(row('calendly')).kind, 'oauth', 'Calendly signs in; its token is on the chevron');
  const opening = pageAction(row('stripe'), { view: 'signin' });
  assert.deepEqual([opening.kind, opening.label, opening.busy], ['starting', 'Opening Stripe…', true]);
  const slack = pageAction(row('slack'));
  assert.equal(slack.kind, 'status');
  assert.equal(slack.pill.label, 'Connected', 'its status pill; F3 adds Manage beside it');
  const zoom = pageAction(row('zoom'));
  assert.deepEqual([zoom.kind, zoom.label, zoom.via, zoom.pill.label], ['reconnect', 'Reconnect', 'key', 'Needs attention']);
  const stripeBad = pageAction({ ...row('stripe'), connection: { uid: 'u', status: 'error', last_error: 'invalid_grant: expired' } });
  assert.equal(stripeBad.via, 'oauth');
  assert.deepEqual([pageAction(row('affinity')).kind, pageAction(row('affinity')).label], ['waitlist', 'Notify me']);
  assert.deepEqual([pageAction(row('attio')).kind, pageAction(row('attio')).label], ['waitlist', 'We’ll tell you']);
  const carta = pageAction(row('carta'));
  assert.deepEqual([carta.kind, carta.pill, carta.label, carta.to], ['plan', TIER_LABEL.studio, 'See plans', '/account/billing']);
  const gh = pageAction(row('github'));
  assert.deepEqual([gh.kind, gh.label], ['unavailable', 'Not set up here']);
  assert.equal(gh.note, "GitHub isn't set up on Axal yet, so it can't be connected.");
  assert.equal(pageAction(row('linkedin')).label, 'Status unreadable');
  assert.equal(pageAction(row('entity')).kind, 'none', 'the Axal entities\' Mercury has no header action (F5)');
  assert.equal(pageAction(null).kind, 'none');
  assert.equal(keyPath(row('hubspot')), true);
  assert.equal(keyPath(row('stripe')), false);
});

test('pageChoices: the chevron offers the account kind and the other way in', () => {
  assert.deepEqual(pageChoices(row('salesforce')).env.options.map((o) => o.value), ['production', 'sandbox']);
  assert.deepEqual(pageChoices(row('docusign')).env.options.map((o) => o.value), ['production', 'demo']);
  assert.deepEqual(pageChoices(row('calendly')).alt, [{ id: 'pat', label: 'Use a personal access token' }]);
  assert.deepEqual(pageChoices(row('hubspot')).alt, [{ id: 'oauth', label: 'Sign in with HubSpot instead' }]);
  const hubOff = buildCatalogue({ providers: [P('hubspot', 'HubSpot', { supports_pat: true, configured: false })], items: [], firstParty: {} })[0];
  assert.deepEqual(pageChoices(hubOff).alt, [], 'no sign-in to offer when Axal holds no client');
  const calOff = buildCatalogue({ providers: [P('calendly', 'Calendly', { supports_pat: true, configured: false })], items: [], firstParty: {} })[0];
  assert.deepEqual(pageChoices(calOff).alt, [], 'a token-only Calendly connects with its token already: no second way to offer');
  assert.deepEqual(pageChoices(row('stripe')), { env: null, alt: [] });
});

test('pageNotice: one notice at a time, the flow\'s first; keyHelpOf keeps only an https link', () => {
  assert.deepEqual(pageNotice({ view: 'refused', name: 'Stripe', moved: true }).kind, 'refused', 'the flow\'s notice before the moved one');
  assert.equal(pageNotice({ view: 'refused', name: 'Stripe' }).tone, 'danger');
  assert.equal(pageNotice({ view: 'unconfigured', name: 'GitHub', ret: { reason: 'not_configured' } }).text, "GitHub isn't set up on Axal yet, so it can't be connected. Nothing was connected.");
  assert.equal(pageNotice({ view: 'setup_unreadable', name: 'GitHub', message: 'Axal’s own words.' }).text, 'Axal’s own words.');
  assert.deepEqual(pageNotice({ view: 'connected', name: 'Stripe' }), { kind: 'connected', tone: 'ok', text: 'Stripe is connected to Axal VC.' });
  assert.equal(pageNotice({ view: 'connected', name: 'Google', ret: { banner: 'Connected, but…' } }).tone, 'warn');
  assert.equal(pageNotice({ view: 'idle', moved: true }).kind, 'moved');
  assert.equal(pageNotice({ view: 'idle' }), null);
  assert.equal(pageNotice({ view: 'key' }), null, 'the key form is not a notice');
  assert.deepEqual(keyHelpOf({ display_name: 'Mercury', sign_in: { key_help_href: 'https://docs.mercury.com/x' } }), { href: 'https://docs.mercury.com/x', label: 'Get one at Mercury' });
  assert.equal(keyHelpOf({ sign_in: { key_help_href: 'http://example.test' } }), null);
  assert.equal(keyHelpOf({ sign_in: { key_help_href: 'javascript:alert(1)' } }), null);
  assert.equal(keyHelpOf(null), null);
});

// ---------------------------------------------------------------- the page

/** A fetch whose answers are chosen by path prefix; `GET /connectors/oauth/…` can be held open. */
function stubFetch(answer = () => [200, {}]) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api/, '');
    const method = init.method || 'GET';
    const call = { method, path, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = await answer(call);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore() { globalThis.fetch = orig; } };
}

async function mount(element, url) {
  const restoreDoc = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  const assigned = [];
  globalThis.window.location.assign = (u) => { assigned.push(u); };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element })))); });
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const fire = async (id, prop, arg) => {
    const n = by(id);
    if (!n) throw new Error(`Missing ${id}`);
    await act(async () => { await props(n)[prop]?.(arg); });
    await settle();
  };
  return {
    by, props, assigned, settle,
    text: () => textOf(container).replace(/\s+/g, ' '),
    click: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    change: (id, value) => fire(id, 'onChange', { target: { value, checked: value } }),
    submit: (id) => fire(id, 'onSubmit', { preventDefault() {} }),
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}
const page = (key, extra = {}) => h(ConnectorPageView, { data: ready(), connectorKey: key, ...extra });
const startPath = (f, key) => f.calls.find((c) => c.path.startsWith(`/connectors/oauth/${key}/start`))?.path || null;

test('Connect on a sign-in connector calls oauthStart, then sends the browser to authorize_url, never before', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const f = stubFetch(async (c) => (c.path.startsWith('/connectors/oauth/stripe/start') ? (await held, [200, { authorize_url: 'https://connect.stripe.test/authorize?state=s' }]) : [200, {}]));
  const m = await mount(page('stripe'), '/account/connectors/stripe');
  try {
    const btn = m.by('connector-page-connect-button');
    assert.equal(m.props(btn)['aria-label'], 'Connect Stripe to Axal VC');
    assert.match(m.text(), /Connect to Axal VC/);
    // Pressed without awaiting, so the held start can be looked at while it is open.
    const press = m.props(btn).onClick();
    await m.settle();
    assert.ok(startPath(f, 'stripe'), 'oauthStart was called');
    assert.deepEqual(m.assigned, [], 'nothing is assigned before oauthStart resolves');
    const busy = m.by('connector-page-connect-button');
    assert.equal(m.props(busy)['aria-busy'], 'true');
    assert.equal(m.props(busy).disabled, true);
    assert.match(m.text(), /Opening Stripe…/);
    release();
    await act(async () => { await press; });
    await m.settle();
    assert.deepEqual(m.assigned, ['https://connect.stripe.test/authorize?state=s']);
  } finally { await m.unmount(); f.restore(); }
});

test('the chevron\'s choices reach the start: Salesforce sandbox=1, DocuSign demo=1 by default and demo=0 for Production', async () => {
  const answer = (c) => [200, c.path.includes('/oauth/') ? { authorize_url: 'https://example.test/authorize' } : {}];
  let f = stubFetch(answer);
  let m = await mount(page('salesforce'), '/account/connectors/salesforce');
  try {
    await m.click('connector-page-choices');
    assert.ok(m.by('connector-page-choices-menu'), 'a menu on desktop');
    await m.click('connector-page-env-sandbox');
    await m.click('connector-page-connect-button');
    assert.match(startPath(f, 'salesforce'), /[?&]sandbox=1\b/);
  } finally { await m.unmount(); f.restore(); }

  f = stubFetch(answer);
  m = await mount(page('docusign'), '/account/connectors/docusign');
  try {
    await m.click('connector-page-connect-button');
    assert.match(startPath(f, 'docusign'), /[?&]demo=1\b/, 'Demo by default, as the sheet');
  } finally { await m.unmount(); f.restore(); }

  f = stubFetch(answer);
  m = await mount(page('docusign'), '/account/connectors/docusign');
  try {
    await m.click('connector-page-choices');
    await m.click('connector-page-env-production');
    await m.click('connector-page-connect-button');
    assert.match(startPath(f, 'docusign'), /[?&]demo=0\b/, 'demo=0 is always sent for Production');
  } finally { await m.unmount(); f.restore(); }
});

test('on a phone the chevron\'s choices are radios and links under the action', async () => {
  const f = stubFetch((c) => [200, c.path.includes('/oauth/') ? { authorize_url: 'https://example.test/authorize' } : {}]);
  const m = await mount(page('docusign', { phone: true }), '/account/connectors/docusign');
  try {
    assert.equal(m.by('connector-page-choices'), undefined, 'no menu button on a phone');
    assert.ok(m.by('connector-page-choices-inline'));
    await m.change('connector-page-env-production', true);
    await m.click('connector-page-connect-button');
    assert.match(startPath(f, 'docusign'), /[?&]demo=0\b/);
  } finally { await m.unmount(); f.restore(); }
});

test('the PAT path: the chevron opens the key form inline, and no sign-in starts', async () => {
  const f = stubFetch(() => [200, {}]);
  const m = await mount(page('calendly'), '/account/connectors/calendly');
  try {
    await m.click('connector-page-choices');
    await m.click('connector-page-alt-pat');
    assert.ok(m.by('connector-page-key-form'), 'the key form, inline under the band');
    assert.equal(m.props(m.by('connector-page-connect'))['data-mode'], 'key');
    assert.equal(f.calls.filter((c) => c.path.includes('/oauth/')).length, 0);
  } finally { await m.unmount(); f.restore(); }
});

test('a key connector opens its form inline, and the form posts through submitKey', async () => {
  const f = stubFetch((c) => [c.path === '/connectors/connect' ? 201 : 200, {}]);
  const m = await mount(page('crunchbase'), '/account/connectors/crunchbase');
  try {
    assert.equal(m.by('connector-page-key-form'), undefined, 'closed until Connect is pressed');
    await m.click('connector-page-connect-button');
    assert.ok(m.by('connector-page-key-form'));
    await m.change('crunchbase-user-key', 'invented-user-key-0000');
    await m.submit('connector-page-key-form');
    const post = f.calls.find((c) => c.method === 'POST' && c.path === '/connectors/connect');
    assert.ok(post, 'posted');
    assert.equal(post.body.provider_key, 'crunchbase');
    assert.equal(post.body.api_key, 'invented-user-key-0000');
    assert.equal(m.props(m.by('connector-page-notice'))['data-kind'], 'connected', 'a success notice after a connect');
    assert.equal(f.calls.filter((c) => c.path.includes('/oauth/')).length, 0, 'no redirect for a key');
  } finally { await m.unmount(); f.restore(); }
});

test('Mercury\'s Read Only confirm is required, and a refused token clears the field', async () => {
  const f = stubFetch((c) => (c.path === '/connectors/connect' ? [400, { error: 'mercury_token_refused', message: 'Mercury refused that token.' }] : [200, {}]));
  const m = await mount(page('mercury'), '/account/connectors/mercury');
  try {
    await m.click('connector-page-connect-button');
    await m.change('connector-key', 'invented-mercury-token');
    await m.submit('connector-page-key-form');
    assert.equal(f.calls.filter((c) => c.path === '/connectors/connect').length, 0, 'nothing is posted without the confirm');
    assert.match(m.text(), /Confirm this is a Read Only token\./);
    // Tick the confirm: the checkbox is the form's only checkbox.
    const form = m.by('connector-page-key-form');
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const checkbox = walk(form).find((n) => m.props(n).type === 'checkbox');
    await act(async () => { m.props(checkbox).onChange({ target: { checked: true } }); });
    await m.settle();
    await m.submit('connector-page-key-form');
    const post = f.calls.find((c) => c.path === '/connectors/connect');
    assert.deepEqual(post.body.config, { confirm_read_only: true });
    assert.equal(m.props(m.by('connector-key')).value, '', 'the refused token is cleared');
    assert.match(m.text(), /Mercury refused that token\./);
  } finally { await m.unmount(); f.restore(); }
});

test('coming soon, locked, not set up and the entity Mercury each read as decision 6 says', async () => {
  const f = stubFetch(() => [200, {}]);
  try {
    let m = await mount(page('affinity'), '/account/connectors/affinity');
    try {
      assert.match(m.text(), /Coming soon Notify me/);
      const btn = m.by('connector-page-waitlist').childNodes.find((n) => n.tagName === 'BUTTON');
      await act(async () => { await m.props(btn).onClick(); });
      assert.ok(f.calls.find((c) => c.method === 'POST' && c.path === '/connectors/notify-me'), 'the waitlist call');
    } finally { await m.unmount(); }
    m = await mount(page('attio'), '/account/connectors/attio');
    try { assert.match(m.text(), /We’ll tell you/); } finally { await m.unmount(); }
    m = await mount(page('carta'), '/account/connectors/carta');
    try {
      assert.match(m.text(), new RegExp(`${TIER_LABEL.studio} See plans`));
      assert.equal(m.props(m.by('connector-page-plans')).href, '/account/billing');
      assert.equal(m.by('connector-page-connect-button'), undefined);
    } finally { await m.unmount(); }
    m = await mount(page('github'), '/account/connectors/github');
    try {
      assert.equal(m.props(m.by('connector-page-unavailable')).disabled, true);
      assert.match(m.text(), /Not set up here GitHub isn't set up on Axal yet, so it can't be connected\./);
      assert.equal(f.calls.filter((c) => c.path.includes('/oauth/')).length, 0);
    } finally { await m.unmount(); }
    m = await mount(page('entity'), '/account/connectors/entity');
    try { assert.equal(m.by('connector-page-action'), undefined, 'no header action'); } finally { await m.unmount(); }
  } finally { f.restore(); }
});

test('a return names its own key or opens nothing; a refusal at the press is a notice, and the button comes back', async () => {
  const f = stubFetch((c) => (c.path.includes('/oauth/') ? [503, { error: 'oauth_unconfigured', provider: 'stripe', message: 'Not configured.' }] : [200, {}]));
  let m = await mount(page('stripe'), '/account/connectors/stripe?oauth=error&provider=hubspot&reason=access_denied');
  try { assert.equal(m.by('connector-page-notice'), undefined, 'another key\'s return opens nothing'); } finally { await m.unmount(); }
  m = await mount(page('stripe'), '/account/connectors/stripe?oauth=error&provider=stripe&reason=access_denied');
  try { assert.equal(m.props(m.by('connector-page-notice'))['data-kind'], 'cancelled'); } finally { await m.unmount(); }
  m = await mount(page('stripe'), '/account/connectors/stripe');
  try {
    await m.click('connector-page-connect-button');
    assert.equal(m.props(m.by('connector-page-notice'))['data-kind'], 'unconfigured', 'D751\'s view, as a notice');
    assert.doesNotMatch(m.text(), /refused|Not configured\./);
    assert.match(m.text(), /Connect to Axal VC/, 'the action is back, not stuck on Opening');
    assert.deepEqual(m.assigned, []);
  } finally { await m.unmount(); f.restore(); }
});

test('the key form draws "Get one at <Service>" from the Worker\'s sign_in.key_help_href', async () => {
  const f = stubFetch(() => [200, {}]);
  const body = { state: 'ready', connector: { display_name: 'Mercury', sign_in: { kind: 'key', label: 'Read Only API token', key_help_href: 'https://docs.mercury.test/tokens' } } };
  const m = await mount(page('mercury', { body }), '/account/connectors/mercury');
  try {
    await m.click('connector-page-connect-button');
    const link = m.by('connector-key-help');
    assert.equal(m.props(link).href, 'https://docs.mercury.test/tokens');
    assert.match(m.text(), /Get one at Mercury/);
  } finally { await m.unmount(); f.restore(); }
});
