/**
 * D1080 (#2945, #2404 part 2) — the `mcp` sign-in kind in the SPA: a
 * connector whose MCP server signs members in (by the registry's
 * `oauth_mcp`, or the directory's `sign_in.kind: 'mcp'`), other than Mercury.
 *
 *  1. The words: "Sign in with <Provider>" on the band, on Details' Sign-in
 *     row and as the button's label; Manage's "Sign in again"; the tooltip
 *     on the button and on the Discover card's "+". Mercury keeps its own.
 *  2. The start: `GET /api/integrations/mcp/<key>/start` (the client in
 *     `lib/api/mcpOauth.js`, D527), then the browser goes to authorize_url;
 *     a refusal assigns nothing.
 *  3. The return: `?oauth=ok|error&provider=<key>&reason=<word>` says what
 *     happened on the connector's page.
 *
 * No test calls a provider or the network: `fetch` and
 * `window.location.assign` are stubbed. Every name here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connector_mcp_sign_in_d1080.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { buildCatalogue, isMcpSignIn, mcpSignInLabel, mcpSignInTooltip } from '../src/pages/account/connectorsModel.js';
import { manageItems, pageAction, pageChoices, signInLabel } from '../src/pages/account/connectorPageModel.js';
import { signInKind } from '../src/pages/account/discoverModel.js';
import { ConnectorPageView } from '../src/pages/account/ConnectorPage.jsx';
import { ConnectorCard } from '../src/pages/account/AccountConnectors.jsx';
import { mcpOauthApi } from '../src/lib/api/mcpOauth.js';
import * as api from '../src/lib/api.js';

const h = React.createElement;

const P = (key, display_name, extra = {}) => ({
  key, display_name, integration_type: 'data_feed', status: 'beta', tier: 'free', auth_type: 'oauth_mcp',
  description: `${display_name} description.`, capabilities: [], docs_url: `https://example.test/${key}`,
  has_implementation: true, locked_for_user: false, connection_source: 'integrations', pulls: [], sends: [], feeds: [], ...extra,
});
const PROVIDERS = [
  P('notes_fake', 'Notes', { supports_pat: true }),
  P('mercury', 'Mercury', { auth_type: 'api_key' }),
  P('stripe', 'Stripe', { auth_type: 'oauth2' }),
];
const CONNECTED = [{ uid: 'u-notes', provider_key: 'notes_fake', status: 'active', auth_type: 'oauth_mcp', last_synced_at: null, last_error: null, config: {}, company_ids: [] }];
const cat = (items = []) => buildCatalogue({ providers: PROVIDERS, items, firstParty: {} });
const row = (key, items = []) => cat(items).find((p) => p.key === key);
const ready = (catalogue = cat()) => ({ status: 'ready', catalogue, items: [], itemsFailed: false, suggestions: [], suggestionsNote: '', reload() {} });

test('1. the mcp kind\'s words: the label, Manage, the tooltip, the Sign-in row; Mercury keeps its own', () => {
  const notes = row('notes_fake');
  assert.equal(isMcpSignIn(notes), true);
  assert.equal(isMcpSignIn({ key: 'other', sign_in: { kind: 'mcp' } }), true, 'the directory\'s kind is enough');
  assert.equal(isMcpSignIn(row('mercury')), false, 'Mercury keeps D840\'s route and words');
  assert.equal(isMcpSignIn({ key: 'mercury', auth_type: 'oauth_mcp' }), false);
  assert.equal(isMcpSignIn(row('stripe')), false);
  const action = pageAction(notes);
  assert.deepEqual([action.kind, action.label, action.aria], ['oauth', 'Sign in with Notes', 'Sign in with Notes to connect it to Axal VC']);
  assert.equal(action.title, 'Opens Notes’s own sign-in page. Axal VC never sees your password there.');
  assert.equal(pageAction(row('stripe')).title, undefined, 'no tooltip for another sign-in');
  assert.equal(signInLabel(notes), 'Sign in with Notes');
  assert.equal(signInLabel(row('mercury')), 'Sign in with Mercury');
  assert.equal(signInKind({ ...notes, sign_in: { kind: 'mcp' } }), 'mcp');
  assert.deepEqual(pageChoices(notes).alt, [], 'no token path beside an MCP sign-in');
  assert.deepEqual(manageItems(row('notes_fake', CONNECTED)).map((i) => i.label), ['Sync now', 'Sign in again', 'Disconnect']);
  assert.equal(mcpSignInLabel({}), 'Sign in with the service');
  assert.match(mcpSignInTooltip(notes), /^Opens Notes’s own sign-in page\./);
  // The Discover card's "+" carries the same tooltip; Stripe's carries none.
  const card = (p) => renderToStaticMarkup(h(MemoryRouter, null, h(ConnectorCard, { p, onNotify() {}, onUnnotify() {}, busy: false })));
  assert.ok(card(notes).includes(`<span aria-hidden="true" title="${mcpSignInTooltip(notes)}"`), 'the card\'s tooltip');
  assert.doesNotMatch(card(row('stripe')), /title="Opens/);
});

test('2. the client: one module, one line in api.js, the generic start', () => {
  assert.equal(api.mcpOauthApi, mcpOauthApi);
  const lines = readFileSync('frontend/src/lib/api.js', 'utf8').split('\n').filter((l) => l.includes('mcpOauth'));
  assert.deepEqual(lines, ["export * from './api/mcpOauth.js';"]);
});

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
const page = (key, data = ready()) => h(ConnectorPageView, { data, connectorKey: key });

test('3. Sign in with Notes calls the generic start, then sends the browser to authorize_url', async () => {
  const f = stubFetch((c) => (c.path === '/integrations/mcp/notes_fake/start' ? [200, { ok: true, authorize_url: 'https://auth.notes.test/authorize?state=s' }] : [200, {}]));
  const m = await mount(page('notes_fake'), '/account/connectors/notes_fake');
  try {
    const btn = m.by('connector-page-connect-button');
    assert.match(m.text(), /Sign in with Notes/);
    assert.equal(m.props(btn)['aria-label'], 'Sign in with Notes to connect it to Axal VC');
    assert.equal(m.props(btn).title, mcpSignInTooltip(row('notes_fake')));
    await m.click('connector-page-connect-button');
    assert.deepEqual(f.calls.filter((c) => c.path.includes('/start')).map((c) => c.path), ['/integrations/mcp/notes_fake/start']);
    assert.deepEqual(m.assigned, ['https://auth.notes.test/authorize?state=s']);
    assert.equal(f.calls.filter((c) => c.path.startsWith('/connectors/oauth/') || c.path === '/connectors/connect').length, 0, 'neither the registry\'s start nor a key');
  } finally { await m.unmount(); f.restore(); }
  // A return path is sent only when it is a path on this site.
  const restoreDoc = installDocument();
  const g = stubFetch(() => [200, { authorize_url: 'https://auth.notes.test/a' }]);
  try {
    await mcpOauthApi.start('notes_fake', '/build/connect');
    await mcpOauthApi.start('notes_fake', '//evil.example');
    await mcpOauthApi.start('notes/../x');
    assert.deepEqual(g.calls.map((c) => c.path), ['/integrations/mcp/notes_fake/start?return_to=%2Fbuild%2Fconnect', '/integrations/mcp/notes_fake/start', '/integrations/mcp/notes%2F..%2Fx/start']);
  } finally { g.restore(); restoreDoc(); }
});

test('3b. a refused start says so on the page and assigns nothing', async () => {
  const f = stubFetch((c) => (c.path === '/integrations/mcp/notes_fake/start'
    ? [503, { error: 'oauth_unconfigured', message: 'Notes isn\'t set up on Axal yet, so it can\'t be connected. Nothing was sent to Notes.' }] : [200, {}]));
  const m = await mount(page('notes_fake'), '/account/connectors/notes_fake');
  try {
    await m.click('connector-page-connect-button');
    assert.deepEqual(m.assigned, []);
    assert.ok(m.by('connector-page-notice'), 'a notice');
  } finally { await m.unmount(); f.restore(); }
});

test('4. the return says what happened, by its outcome word only', async () => {
  const f = stubFetch(() => [200, {}]);
  try {
    let m = await mount(page('notes_fake', ready(cat(CONNECTED))), '/account/connectors/notes_fake?oauth=ok&provider=notes_fake');
    try { assert.equal(m.props(m.by('connector-page-notice'))['data-kind'], 'connected'); } finally { await m.unmount(); }
    m = await mount(page('notes_fake'), '/account/connectors/notes_fake?oauth=error&provider=notes_fake&reason=scope_refused');
    try { assert.equal(m.props(m.by('connector-page-notice'))['data-kind'], 'refused'); } finally { await m.unmount(); }
  } finally { f.restore(); }
});
