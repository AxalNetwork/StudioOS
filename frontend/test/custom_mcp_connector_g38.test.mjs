/**
 * #9113 (g38, board C26) — "Add a custom connector" on the Connectors page,
 * behind the Worker's CUSTOM_MCP_ENABLED (D852): the client's paths and
 * methods, the Add entry in each state of `list()` (404 off, 402 upsell,
 * 200 form), the form showing the Worker's refusal, the `?custom=` return
 * lines, the Custom servers group and the Tools view, whose descriptions are
 * the server's untrusted words drawn as text.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/custom_mcp_connector_g38.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { connectorsCustomApi } from '../src/lib/api/connectorsCustom.js';
import { AddMenu, ConnectorsView } from '../src/pages/account/AccountConnectors.jsx';
import {
  CustomConnectorLightbox, CustomServersGroup, CustomToolsList, CustomUpsellLightbox, startCustom,
} from '../src/pages/account/CustomConnectors.jsx';
import {
  CUSTOM_OFF_TITLE, customEntry, customReturn, customState, healthLine, safeAuthorizeUrl, serverStatus, showCustomGroup, toolRow,
} from '../src/pages/account/customConnectorsModel.js';

const html = (el, entry = '/account/connectors') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const refusal = (status, message = '', code = null, data = null) => Object.assign(new Error(message), { status, code, data });

const SERVER = { uid: 'a'.repeat(32), host: 'mcp.example.test', url: 'https://mcp.example.test/mcp', status: 'active', last_error: null, last_synced_at: null, approved: ['search'], drift: [], checked_at: null };
const READY = customState({ servers: [SERVER], limits: { servers: 10, approved: 25 } });
const OFF = customState(null, { error: refusal(404, 'custom_connectors_off', 'custom_connectors_off') });
const UPSELL = customState(null, { error: refusal(402, 'Growth unlocks this.', null, { error: 'tier_required', required: 'growth', message: 'Growth unlocks this.' }) });

// ---------- the client ----------------------------------------------------------

test('client: one method per route, each path and method as the Worker mounts it, uid and name encoded, no global paywall', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push([String(url), opts?.method || 'GET', opts?.body ?? null]); return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await connectorsCustomApi.list();
    await connectorsCustomApi.start('https://mcp.example.test');
    await connectorsCustomApi.tools('u/1');
    await connectorsCustomApi.approveTool('u1', 'read file');
    await connectorsCustomApi.withdrawTool('u1', 'a/b');
    await connectorsCustomApi.health('u1');
    await connectorsCustomApi.revoke('u?1');
  } finally { globalThis.fetch = realFetch; }
  const got = calls.map(([u, m, b]) => [u.replace(/^.*\/api/, ''), m, b]);
  assert.deepEqual(got, [
    ['/connectors/custom', 'GET', null],
    ['/connectors/custom/start', 'POST', '{"url":"https://mcp.example.test"}'],
    ['/connectors/custom/u%2F1/tools', 'GET', null],
    ['/connectors/custom/u1/tools/read%20file/approve', 'POST', null],
    ['/connectors/custom/u1/tools/a%2Fb/approve', 'DELETE', null],
    ['/connectors/custom/u1/health', 'POST', null],
    ['/connectors/custom/u%3F1', 'DELETE', null],
  ]);
  assert.deepEqual(Object.keys(connectorsCustomApi).sort(), ['approveTool', 'health', 'list', 'revoke', 'start', 'tools', 'withdrawTool']);
});

test('client: a 402 from list() does not open the global PaywallModal', async () => {
  const realFetch = globalThis.fetch;
  const realWindow = globalThis.window;
  const fired = [];
  globalThis.window = { dispatchEvent: (e) => fired.push(e.type), location: { pathname: '/account/connectors' } };
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'tier_required', required: 'growth', message: 'Growth unlocks this.' }), { status: 402, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(connectorsCustomApi.list(), (e) => e.status === 402);
  } finally { globalThis.fetch = realFetch; globalThis.window = realWindow; }
  assert.deepEqual(fired.filter((t) => t === 'studioos:tier_required'), []);
});

// ---------- the Add entry -------------------------------------------------------

test('Add entry, flag off (404): disabled, PRO and Coming soon, titled "not available yet", and no Custom servers group', () => {
  const menu = html(h(AddMenu, { onBrowse() {}, onRequest() {}, custom: OFF, initialOpen: true }));
  assert.match(text(menu), /Browse connectors Request a connector Add a custom connector PRO Coming soon/);
  assert.match(menu, /<button type="button" role="menuitem" class="[^"]*" disabled="" title="Custom connectors are not available yet\." data-testid="button-connectors-add-custom">Add a custom connector/);
  assert.equal(OFF.state, 'off');
  assert.equal(showCustomGroup(OFF), false);
  assert.equal(html(h(CustomServersGroup, { custom: OFF })), '');
  // A 404 without the code (a dev backend with no such route) reads the same.
  assert.equal(customState(null, { error: refusal(404, 'Not Found') }).state, 'off');
});

test('Add entry, loading: disabled until list() settles', () => {
  const menu = html(h(AddMenu, { onBrowse() {}, onRequest() {}, initialOpen: true }));
  assert.match(menu, /disabled="" title="Checking whether you can add a custom connector…" data-testid="button-connectors-add-custom"/);
  assert.equal(customEntry(customState(undefined)).enabled, false);
});

test('Add entry, below the plan (402): enabled, opens the upsell, not the form', () => {
  assert.equal(UPSELL.state, 'upsell');
  assert.deepEqual(customEntry(UPSELL), { enabled: true, opens: 'upsell', title: undefined, comingSoon: false });
  const menu = html(h(AddMenu, { onBrowse() {}, onRequest() {}, custom: UPSELL, initialOpen: true }));
  assert.match(menu, /<button type="button" role="menuitem" class="[^"]*" data-testid="button-connectors-add-custom" data-opens="upsell">Add a custom connector/);
  assert.doesNotMatch(text(menu), /Coming soon/);
  const pro = text(html(h(CustomUpsellLightbox, { message: UPSELL.message, onClose() {} })));
  assert.match(pro, /Custom connectors are part of the [^.]+ plan\. Free keeps every connector you already have\. Growth unlocks this\./);
  assert.match(pro, /See plans/);
  assert.doesNotMatch(pro, /Server URL/);
});

test('Add entry, eligible (200): enabled, opens the C26 form', () => {
  assert.deepEqual(customEntry(READY), { enabled: true, opens: 'form', title: undefined, comingSoon: false });
  const menu = html(h(AddMenu, { onBrowse() {}, onRequest() {}, custom: READY, initialOpen: true }));
  assert.match(menu, /data-testid="button-connectors-add-custom" data-opens="form">Add a custom connector/);
  assert.doesNotMatch(menu, /disabled="" title="[^"]*" data-testid="button-connectors-add-custom"/);
});

test('Add entry, support session (403): disabled, titled with the Worker’s sentence', () => {
  const refused = customState(null, { error: refusal(403, 'A support session cannot connect a member\'s MCP server.', 'support_session_refused') });
  assert.equal(customEntry(refused).enabled, false);
  assert.equal(customEntry(refused).title, 'A support session cannot connect a member\'s MCP server.');
  assert.equal(customEntry({ state: 'refused', message: '' }).title, CUSTOM_OFF_TITLE);
});

// ---------- the C26 form ----------------------------------------------------------

test('C26 form: one Server URL field, the canvas’s subtitle and foot note, Add connector waits for an https address', () => {
  const form = html(h(CustomConnectorLightbox, { onClose() {} }));
  assert.match(text(form), /Add a custom connector For teams with their own tools\. Pro\./);
  assert.match(text(form), /Server URL/);
  assert.match(text(form), /Eadwyn only uses it in a conversation when you switch it on\./);
  assert.match(form, /disabled="" data-testid="button-add-custom">Add connector/);
  assert.doesNotMatch(text(form), /Webhook|Authentication|API key/);
  const filled = html(h(CustomConnectorLightbox, { onClose() {}, initialUrl: 'https://mcp.example.test' }));
  assert.doesNotMatch(filled, /disabled="" data-testid="button-add-custom"/);
  const plain = html(h(CustomConnectorLightbox, { onClose() {}, initialUrl: 'http://mcp.example.test' }));
  assert.match(plain, /disabled="" data-testid="button-add-custom"/);
});

test('C26 form: a refused URL shows the Worker’s sentence inline, in a danger banner', async () => {
  const sentence = 'That server\'s name points at a private address, so it cannot be connected.';
  const api = { start: async () => { throw refusal(400, sentence, 'custom_mcp_host_private'); } };
  const opened = [];
  const out = await startCustom('https://10.0.0.1.example.test', { api, assign: (u) => opened.push(u) });
  assert.deepEqual(out, { error: sentence, code: 'custom_mcp_host_private' });
  assert.deepEqual(opened, []);
  const form = html(h(CustomConnectorLightbox, { onClose() {}, initialError: out.error }));
  assert.match(form, /role="alert" data-testid="custom-error" class="[^"]*border-red-200[^"]*">That server&#x27;s name points at a private address, so it cannot be connected\.</);
});

test('C26 form: a valid URL goes to the server’s sign-in, and only to an https address', async () => {
  const sent = [];
  const opened = [];
  const api = { start: async (url) => { sent.push(url); return { ok: true, uid: 'u1', authorize_url: 'https://auth.example.test/authorize?state=x' }; } };
  assert.deepEqual(await startCustom('  https://mcp.example.test  ', { api, assign: (u) => opened.push(u) }), { error: '' });
  assert.deepEqual(sent, ['https://mcp.example.test']);
  assert.deepEqual(opened, ['https://auth.example.test/authorize?state=x']);
  const bad = { start: async () => ({ ok: true, uid: 'u1', authorize_url: 'javascript:alert(1)' }) };
  const out = await startCustom('https://mcp.example.test', { api: bad, assign: (u) => opened.push(u) });
  assert.match(out.error, /did not describe how to sign in/);
  assert.equal(opened.length, 1);
  assert.equal(safeAuthorizeUrl('http://auth.example.test'), null);
});

// ---------- the return from a server's sign-in -------------------------------------

test('?custom= return: ok names the server once listed, each error reason is one plain line, and the keys are stripped', () => {
  const ok = customReturn(`?custom=ok&uid=${SERVER.uid}&tab=yours`, READY);
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.text, 'mcp.example.test is connected. Choose which of its read-only tools Eadwyn may use.');
  assert.deepEqual(ok.strip, ['custom', 'uid', 'reason']);
  assert.equal(customReturn('?custom=ok&uid=bbbb', OFF).text, 'Your server is connected. Choose which of its read-only tools Eadwyn may use.');
  const many = customReturn('?custom=error&reason=too_many', READY);
  assert.deepEqual([many.tone, many.text], ['danger', 'At most 10 servers can be connected, so nothing was connected. Remove one first.']);
  for (const reason of ['access_denied', 'invalid_state', 'csrf_mismatch', 'missing_code', 'not_allowed', 'sign_in_failed', 'something_new', 'constructor', 'toString']) {
    const line = customReturn(`?custom=error&reason=${reason}`);
    assert.equal(line.tone, 'danger', reason);
    assert.match(line.text, /nothing was connected/, reason);
  }
  assert.equal(customReturn('?custom=error&reason=access_denied').text, 'The sign-in to that server was cancelled, so nothing was connected.');
  assert.equal(customReturn('?oauth=ok&provider=stripe'), null);
  assert.equal(customReturn('?custom=maybe'), null);
});

test('?custom= return: the page shows the line, and the new server under Custom servers', () => {
  const page = html(h(ConnectorsView, { data: { status: 'ready', catalogue: [], reload() {} }, customRead: { custom: READY, reload() {} } }), `/account/connectors?custom=ok&uid=${SERVER.uid}`);
  assert.match(page, /role="status"[^>]*data-testid="custom-return">mcp\.example\.test is connected\./);
  assert.match(page, /data-testid="custom-servers"/);
  assert.match(page, new RegExp(`data-testid="custom-server-${SERVER.uid}"`));
  const err = html(h(ConnectorsView, { data: { status: 'ready', catalogue: [], reload() {} }, customRead: { custom: READY, reload() {} } }), '/account/connectors?custom=error&reason=too_many');
  assert.match(err, /role="alert"[^>]*data-testid="custom-return">At most 10 servers can be connected/);
  const plain = html(h(ConnectorsView, { data: { status: 'ready', catalogue: [], reload() {} }, customRead: { custom: OFF, reload() {} } }));
  assert.doesNotMatch(plain, /custom-return|custom-servers/);
});

// ---------- the Custom servers group ------------------------------------------------

test('Custom servers: host, status, last error and approved count, with Check, Tools and Remove', () => {
  const group = html(h(CustomServersGroup, { custom: customState({ servers: [SERVER, { ...SERVER, uid: 'b'.repeat(32), host: 'tools.example.test', status: 'error', last_error: 'token_rejected', approved: [] }] }) }));
  const t = text(group);
  assert.match(t, /Custom servers mcp\.example\.test Connected 1 approved tool Check Tools Remove/);
  assert.match(t, /tools\.example\.test Needs attention 0 approved tools · The sign-in to this server has expired\. Remove it and connect it again\./);
  assert.equal(serverStatus({ status: 'error', last_error: 'something_else' }).why, 'Last error: something_else');
  assert.equal(html(h(CustomServersGroup, { custom: customState({ servers: [] }) })), '', 'no servers: no group');
});

test('Custom servers: a 5xx says Unavailable and keeps the servers last read on screen', () => {
  const failed = customState(null, { error: refusal(503, 'Service unavailable'), previous: READY });
  assert.equal(failed.state, 'unreadable');
  const group = html(h(CustomServersGroup, { custom: failed }));
  assert.match(group, /data-testid="custom-servers-unreadable"/);
  assert.match(text(group), /The servers below are the last ones read\./);
  assert.match(group, new RegExp(`data-testid="button-custom-remove-${SERVER.uid}"`), 'Remove stays when the list cannot be read');
  const first = html(h(CustomServersGroup, { custom: customState(null, { error: refusal(500, 'boom') }) }));
  assert.match(text(first), /This is not a claim that you have none\./);
  assert.equal(customState(null, { error: new Error('timeout') }).state, 'unreadable');
});

test('Check: one line for each health answer', () => {
  assert.equal(healthLine({ status: 'ok', drift: [] }).tone, 'ok');
  assert.equal(healthLine({ status: 'drift', drift: [{ tool: 'search', why: 'changed' }] }).text, 'Reachable, but one approved tool changed since you approved it: search.');
  assert.equal(healthLine({ status: 'unauthorized', drift: [] }).text, 'The sign-in to this server has expired. Remove it and connect it again.');
  assert.equal(healthLine({ status: 'unreachable', drift: [] }).tone, 'danger');
});

// ---------- the Tools view ------------------------------------------------------------

test('Tools: loading row, empty sentence, and an untrusted description drawn as text, never HTML', () => {
  assert.match(html(h(CustomToolsList, { read: { state: 'loading', tools: [] } })), /data-testid="custom-tools-loading">Loading its tools…/);
  assert.match(html(h(CustomToolsList, { read: { state: 'ready', tools: [] } })), /data-testid="custom-tools-empty">This server lists no tools\./);
  const evil = '<img src=x onerror="alert(1)"><b>bold</b>';
  const list = html(h(CustomToolsList, { read: { state: 'ready', tools: [{ name: 'search', description: evil, read_only: true, approved: false, changed: false }] } }));
  assert.doesNotMatch(list, /<img|<b>/);
  assert.match(list, /The server’s own words: <\/span><span data-testid="custom-tool-description">&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&lt;b&gt;bold&lt;\/b&gt;<\/span>/);
});

test('Tools: read-only tools get Approve or Withdraw, writing tools cannot be approved, a changed one is flagged', () => {
  const tools = [
    { name: 'search', description: 'Finds things.', read_only: true, approved: false, changed: false },
    { name: 'fetch', description: 'Reads a page.', read_only: true, approved: true, changed: false },
    { name: 'delete_all', description: 'Deletes.', read_only: false, approved: false, changed: false },
    { name: 'lookup', description: 'Looks up.', read_only: true, approved: true, changed: true },
  ];
  const list = html(h(CustomToolsList, { read: { state: 'ready', tools } }));
  assert.match(list, /role="switch" aria-checked="false" aria-label="Approve search"[^>]*>Approve</);
  assert.match(list, /role="switch" aria-checked="true" aria-label="Withdraw fetch"[^>]*>Withdraw</);
  assert.doesNotMatch(list, /custom-tool-toggle-delete_all/);
  assert.match(text(list), /delete_all Writes .*Writes, so it cannot be approved\./);
  assert.match(text(list), /lookup Changed since you approved it/);
  assert.match(list, /aria-checked="false" aria-label="Approve lookup"[^>]*>Approve again</);
  assert.deepEqual(toolRow(tools[2]), { can: false, approved: false, changed: false, note: 'Writes, so it cannot be approved.' });
  assert.equal(toolRow({ ...tools[0], changed: true }).changed, false, 'changed counts only for an approved tool');
});
