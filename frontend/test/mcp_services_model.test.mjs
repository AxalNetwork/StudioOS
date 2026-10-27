/**
 * #2479 — Account › Builder › MCP and services (MCPX1–MCPX13): the model's
 * words and rules, and the page mounted over stand-in reads. No test reaches
 * the Worker; every venture, host and address is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mcp_services_model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  EXPLORER_SERVICES, MCP_SERVER_URL, NOTHING_TO_APPROVE, NOT_YOURS, NO_CALLERS, SERVER_WORDS, SERVICES_EMPTY, SUPER_ADMIN_KEYS,
  assistantRow, audienceOf, checkStrip, checkedLine, filterServices, healthPill, keysSummary, limitRows, readOf, serverState, serviceRows,
} from '../src/pages/account/builder/mcpServicesModel.js';
import McpServicesPage from '../src/pages/account/builder/McpServicesPage.jsx';
import { connectorsApi } from '../src/lib/api/connectors.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const ready = (data) => ({ status: 'ready', data });
const NOW = Date.parse('2026-10-27T12:00:00Z');

// ---------------------------------------------------------------- the model

test('reads: a 404 is switched off, a 403 refused, anything else unreadable; the server state follows the grants read', () => {
  assert.deepEqual(readOf({ ok: true, value: { a: 1 } }), { status: 'ready', data: { a: 1 } });
  assert.equal(readOf({ ok: false, error: { status: 404 } }).status, 'off');
  assert.equal(readOf({ ok: false, error: { status: 403 } }).status, 'refused');
  assert.equal(readOf({ ok: false, error: { status: 503 } }).status, 'unreadable');
  assert.equal(readOf(null).status, 'loading');
  assert.deepEqual([serverState({ status: 'off' }), serverState({ status: 'ready' }), serverState({ status: 'unreadable' }), serverState({ status: 'loading' })], ['off', 'on', 'on', 'loading']);
  assert.equal(MCP_SERVER_URL, 'https://axal.vc/mcp', 'one constant');
});

test('who reads: a Founder or a Lab member owns; Investor, Advisor, Operating Partner and Admin approve nothing; an Explorer has no services', () => {
  assert.equal(audienceOf('founder').kind, 'owner');
  assert.deepEqual(audienceOf('investor', { spinout_lab_active: 1, founder_id: 9 }), { kind: 'owner', superAdmin: false, lab: true });
  for (const r of ['investor', 'advisor', 'partner', 'admin']) assert.equal(audienceOf(r).kind, 'none', r);
  assert.equal(audienceOf('exploring').kind, 'explorer');
  assert.equal(audienceOf('super_admin').superAdmin, true);
  assert.equal(audienceOf('admin', { is_super_admin: 1 }).superAdmin, true);
  assert.equal(audienceOf('admin').superAdmin, false);
});

test('keys: live keys counted, the soonest expiry named; switched off and unread are said, never 0', () => {
  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  const keys = ready({ enabled: true, keys: [
    { uid: 'a', expires_at: null, revoked_at: null },
    { uid: 'b', expires_at: iso(NOW + 6 * day), revoked_at: null },
    { uid: 'c', expires_at: null, revoked_at: '2026-10-01 00:00:00' },
    { uid: 'd', expires_at: '2026-10-01 00:00:00', revoked_at: null },
  ] });
  assert.deepEqual(keysSummary(keys, NOW), { state: 'ready', active: 2, expiring: 1, days: 6, line: '2 active · 1 expires in 6 days' });
  assert.equal(keysSummary(ready({ enabled: true, keys: [] }), NOW).line, '0 active', 'a measured zero is fine');
  assert.deepEqual(keysSummary({ status: 'off' }), { state: 'off', line: 'API keys are not available yet.' });
  assert.equal(keysSummary({ status: 'unreadable' }).state, 'unreadable');
  assert.equal(keysSummary({ status: 'loading' }).state, 'loading');
});

test('an assistant row: the host leads, it is unrecognised until the read says otherwise, and a null last call is "No call recorded"', () => {
  const r = assistantRow({ id: 7, client_name: 'Assistant A', redirect_host: 'assistant-a.example', companies: [{ id: 1, name: 'Northwind Labs' }], connected_at: '2026-10-09T10:00:00Z', last_used_at: null });
  assert.deepEqual([r.id, r.host, r.calledItself, r.recognition, r.companiesLine, r.connected, r.lastCallLine, r.permissions],
    ['7', 'assistant-a.example', 'Assistant A', 'Unrecognised assistant', 'Northwind Labs', '2026-10-09', 'No call recorded', null]);
  assert.equal(assistantRow({ id: 1, last_used_at: '2026-10-21 14:32:00' }).lastCallLine, 'Last call 2026-10-21');
  assert.doesNotMatch(JSON.stringify(assistantRow({ id: 1 })), /Never used/);
});

test('health: Healthy, Slow, Failing with its reason, Not checked yet, Health unreadable; the strip counts only checks that ran', () => {
  assert.deepEqual(healthPill({ state: 'ok' }), { label: 'Healthy', tone: 'positive', key: 'ok' });
  assert.equal(healthPill({ state: 'degraded' }).label, 'Slow');
  assert.equal(healthPill({ state: 'expired' }).label, 'Failing: sign-in expired');
  assert.equal(healthPill({ state: 'disconnected' }).label, 'Failing: disconnected');
  assert.equal(healthPill({ state: 'error', error_category: 'provider_down' }).label, 'Failing: service down');
  assert.equal(healthPill({ state: 'error', error_category: 'something_new' }).label, 'Failing: unknown error');
  assert.equal(healthPill(null).label, 'Not checked yet');
  assert.equal(healthPill({ state: null }).label, 'Not checked yet');
  assert.equal(healthPill({ state: 'ok' }, { unreadable: true }).label, 'Health unreadable');
  assert.equal(checkedLine({ checked_at: new Date(NOW - 12 * 60_000).toISOString() }, NOW), 'checked 12 min ago');
  assert.equal(checkedLine({ checked_at: null }, NOW), null);
  const newestFirst = [{ state: 'error', error_category: 'auth' }, { state: 'degraded' }, { state: 'ok' }, { state: 'ok' }];
  const s = checkStrip(newestFirst);
  assert.equal(s.cells.length, 10);
  assert.deepEqual(s.cells.map((c) => c.key), ['unchecked', 'unchecked', 'unchecked', 'unchecked', 'unchecked', 'unchecked', 'ok', 'ok', 'degraded', 'failing'], 'oldest left, unrun slots outlined');
  assert.equal(s.line, '2 of the last 4 checks passed.');
  assert.equal(checkStrip([]).line, 'No check has run yet.');
});

test('services: the catalogue’s name, Connectors’ own state words, D848’s health, the drawer address; search and filters', () => {
  const connections = ready({ items: [
    { uid: 'u1', provider_key: 'hubspot', status: 'active', last_error: 'invalid_grant: token expired', company_ids: [1], scopes: ['crm.read'], last_synced_at: '2026-10-20 09:12:00' },
    { uid: 'u2', provider_key: 'notion', status: 'active', last_error: null, company_ids: [1, 2] },
    { uid: 'u3', provider_key: 'gone', status: 'disconnected' },
  ] });
  const catalogue = ready({ items: [{ key: 'hubspot', display_name: 'HubSpot', category: 'CRM' }, { key: 'notion', display_name: 'Notion', category: 'Docs' }] });
  const health = ready({ connections: [{ uid: 'u1', health: { state: 'expired', checked_at: new Date(NOW - 3 * 60_000).toISOString() }, checks: [{ state: 'expired' }] }] });
  const rows = serviceRows({ connections, catalogue, health }, NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.state.label, r.state.why, r.health.label, r.checked, r.companies, r.drawer, r.page]), [
    ['HubSpot', 'Needs attention', 'Sign-in expired', 'Failing: sign-in expired', 'checked 3 min ago', 1, '/account/builder/services/hubspot', '/account/connectors/hubspot'],
    ['Notion', 'Connected', '', 'Not checked yet', null, 2, '/account/builder/services/notion', '/account/connectors/notion'],
  ]);
  assert.equal(serviceRows({ connections, catalogue, health: { status: 'unreadable' } }, NOW)[1].health.label, 'Health unreadable', 'the state pills still show');
  assert.deepEqual(filterServices(rows, { filter: 'attention' }).map((r) => r.key), ['hubspot']);
  assert.deepEqual(filterServices(rows, { filter: 'connected' }).map((r) => r.key), ['notion']);
  assert.deepEqual(filterServices(rows, { q: 'docs' }).map((r) => r.key), ['notion']);
  assert.deepEqual(serviceRows({ connections: { status: 'unreadable' }, catalogue, health }), []);
});

test('limits: the Worker’s own numbers; a key limit with keys off or no live key is said, never invented', () => {
  const rows = limitRows(ready({ window_seconds: 60, member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled: true, keys: [{ rate_per_minute: 60 }] }));
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ['Calls per assistant connection', '60 a minute'], ['Calls per API key', '60 a minute'], ['All your callers together', '120 a minute'], ['Spend', 'Your AI token limits apply'],
  ]);
  const off = limitRows(ready({ member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled: false, keys: [] }));
  assert.deepEqual([off[1].value, off[1].reason], [null, 'API keys are not available yet.']);
  assert.equal(limitRows(ready({ keys_enabled: true, keys: [] }))[1].reason, 'No live key, so no key limit is in force.');
  assert.equal(limitRows(ready({}))[0].value, null, 'a limit not sent is never a number');
  assert.equal(limitRows({ status: 'unreadable' }), null);
});

// ---------------------------------------------------------------- mounted

function stubApi(over = {}) {
  const calls = [];
  const ok = (name, v) => async () => { calls.push(name); const x = typeof v === 'function' ? v() : v; if (x instanceof Error) throw x; return x; };
  const err = (status) => Object.assign(new Error('refused'), { status });
  const api = {
    grants: ok('grants', over.grants ?? { grants: [{ id: 'g1', client_name: 'Assistant A', redirect_host: 'assistant-a.example', companies: [{ id: 1, name: 'Northwind Labs' }], connected_at: '2026-10-09', last_used_at: null }] }),
    revoke: async (id) => { calls.push(['revoke', id]); },
    keys: ok('keys', over.keys ?? { enabled: true, keys: [{ uid: 'k1', revoked_at: null, expires_at: null }] }),
    limits: ok('limits', over.limits ?? { member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled: true, keys: [{ rate_per_minute: 60 }] }),
    connections: ok('connections', over.connections ?? { items: [{ uid: 'u1', provider_key: 'notion', status: 'active', company_ids: [1], scopes: ['read_content'] }] }),
    catalogue: ok('catalogue', over.catalogue ?? { items: [{ key: 'notion', display_name: 'Notion', category: 'Docs' }] }),
    health: ok('health', over.health ?? { connections: [{ uid: 'u1', health: { state: 'ok', checked_at: '2026-10-27T11:48:00Z' }, checks: [{ state: 'ok' }, { state: 'degraded' }] }] }),
  };
  return { api, calls, err };
}

async function mount(props) {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(McpServicesPage, props))));
  await settle();
  return {
    byId, has: (id) => !!byId(id), text: (id) => text(id ? byId(id) : container), props: (id) => pr(byId(id)), settle,
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => pr(n).href),
    async click(id) { await act(async () => { await pr(byId(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('MCPX1, a Founder: the endpoint with its sign-in rows, who can call, the services with their health, the limits; tools wait', async () => {
  const { api } = stubApi();
  const v = await mount({ view: { page: 'services', drawer: null }, role: 'founder', api, tools: h('section', { 'data-testid': 'tools-wait' }, 'waiting') });
  try {
    assert.equal(v.text('mcp-server-state'), 'On');
    assert.match(v.text('mcp-endpoint'), /https:\/\/axal\.vc\/mcp.*Assistant sign-in: your assistant opens StudioOS.*API key: a script sends Authorization: Bearer axk_… with a key you create\. 1 active · Manage API keys →.*Every call is checked again on the server/s);
    assert.match(v.text('mcp-assistant-g1'), /assistant-a\.exampleUnrecognised assistant.*Calls itself “Assistant A” · Northwind Labs.*Connected 2026-10-09 · No call recorded/s);
    assert.match(v.text('mcp-keys-line'), /API keys · 1 activeOpen API keys →/);
    assert.ok(v.has('tools-wait'), 'the tools card waits for D846');
    assert.match(v.text('mcp-service-notion'), /NotionConnectedHealthy/);
    assert.match(v.text('mcp-limits'), /Calls per assistant connection60 a minute.*Calls per API key60 a minute.*All your callers together120 a minute.*SpendYour AI token limits apply · See AI tokens.*These are StudioOS’s limits\. Your assistant may set its own\./s);
    assert.ok(v.hrefs().includes('/account/builder/keys') && v.hrefs().includes('/account/builder/services/notion') && v.hrefs().includes('/account/usage/ai-tokens'));
    assert.doesNotMatch(v.text(), /credits|Never used/i);
  } finally { await v.close(); }
});

test('Revoke asks in the page’s own dialog, revokes once, and the row goes', async () => {
  const { api, calls } = stubApi();
  const v = await mount({ view: { page: 'services', drawer: null }, role: 'founder', api });
  try {
    await v.click('mcp-revoke-g1');
    assert.match(v.text('mcp-revoke-dialog'), /Revoke assistant-a\.example\?Revoke now\? It stops at once\. The assistant can no longer call StudioOS for Northwind Labs\./);
    assert.ok(!calls.some((c) => Array.isArray(c)), 'opening the dialog changes nothing');
    await v.click('mcp-revoke-yes');
    assert.deepEqual(calls.filter((c) => Array.isArray(c)), [['revoke', 'g1']]);
    assert.ok(!v.has('mcp-assistant-g1') && !v.has('mcp-revoke-dialog'));
  } finally { await v.close(); }
});

test('MCPX6 and MCPX7: an Investor has nothing to approve; an Explorer has no services; a Super Admin sees the platform keys line', async () => {
  const s = stubApi({ grants: { grants: [] } });
  const inv = await mount({ view: { page: 'services', drawer: null }, role: 'investor', api: s.api });
  try {
    assert.equal(inv.text('mcp-nothing-to-approve'), `Nothing to approve yet${NOTHING_TO_APPROVE}`);
    assert.ok(inv.has('mcp-services'), 'the member’s own services still show');
  } finally { await inv.close(); }
  const e = stubApi({ grants: { grants: [] }, connections: Object.assign(new Error('forbidden'), { status: 403 }) });
  const exp = await mount({ view: { page: 'services', drawer: null }, role: 'exploring', api: e.api });
  try {
    assert.match(exp.text('mcp-services-explorer'), new RegExp(`${EXPLORER_SERVICES}Set up your profile`));
    assert.ok(exp.has('mcp-nothing-to-approve'));
  } finally { await exp.close(); }
  const sa = await mount({ view: { page: 'services', drawer: null }, role: 'super_admin', api: stubApi({ grants: { grants: [] } }).api });
  try { assert.match(sa.text('mcp-super-admin-keys'), new RegExp(SUPER_ADMIN_KEYS.replace(/[.›]/g, '.'))); } finally { await sa.close(); }
});

test('MCPX8 and MCPX10: empty, switched off, unreadable — one failed read costs its card only', async () => {
  const empty = stubApi({ grants: { grants: [] }, keys: { enabled: true, keys: [] }, connections: { items: [] } });
  const v = await mount({ view: { page: 'services', drawer: null }, role: 'founder', api: empty.api });
  try {
    assert.match(v.text('mcp-callers-empty'), new RegExp(NO_CALLERS.replace('.', '\\.')));
    assert.match(v.text('mcp-services-empty'), /No service connected\. StudioOS’s own tools still work\. Browse connectors ›/);
    assert.equal(SERVICES_EMPTY, 'No service connected. StudioOS’s own tools still work.');
  } finally { await v.close(); }
  const off = stubApi({ grants: Object.assign(new Error('off'), { status: 404 }), keys: Object.assign(new Error('off'), { status: 404 }) });
  const o = await mount({ view: { page: 'services', drawer: null }, role: 'founder', api: off.api, tools: h('section', { 'data-testid': 'tools-wait' }) });
  try {
    assert.equal(o.text('mcp-server-state'), SERVER_WORDS.off);
    assert.equal(o.text('mcp-server-off'), 'Connecting to StudioOS is switched off for now.');
    assert.ok(!o.has('mcp-callers') && !o.has('tools-wait'), 'no one is sent to a server that is off');
    assert.ok(o.has('mcp-services') && o.has('mcp-limits'));
  } finally { await o.close(); }
  const bad = stubApi({ grants: Object.assign(new Error('x'), { status: 503 }), health: Object.assign(new Error('x'), { status: 503 }), limits: Object.assign(new Error('x'), { status: 503 }) });
  const b = await mount({ view: { page: 'services', drawer: null }, role: 'founder', api: bad.api });
  try {
    assert.match(b.text('mcp-callers-unreadable'), /Your connections could not be read\. That is not the same as having none\.Try again/);
    assert.equal(b.text('mcp-service-health-notion'), 'Health unreadable');
    assert.match(b.text('mcp-service-notion'), /Connected/, 'the state pill still shows');
    assert.ok(b.has('mcp-limits-unreadable') && b.has('mcp-endpoint'));
  } finally { await b.close(); }
});

test('MCPX3: the service drawer — health, the ten-check strip, permissions, Fix on its page; another member’s key says only that', async () => {
  const { api } = stubApi();
  const v = await mount({ view: { page: 'services', drawer: { kind: 'service', id: 'notion' } }, role: 'founder', api });
  try {
    assert.equal(v.text('mcp-drawer-health'), 'Healthy');
    const strip = v.byId('mcp-check-strip');
    assert.equal(strip.childNodes.length, 10);
    assert.equal(v.text('mcp-check-line'), '1 of the last 2 checks passed.');
    assert.match(v.text('mcp-service-drawer'), /Permissions it holds at Notionread_content.*Switched on for 1 company/s);
    assert.equal(v.props('mcp-fix-on-page').href, '/account/connectors/notion');
    assert.doesNotMatch(v.text(), /Disconnect/, 'disconnecting lives on the connector page');
  } finally { await v.close(); }
  const n = await mount({ view: { page: 'services', drawer: { kind: 'service', id: 'salesforce' } }, role: 'founder', api: stubApi().api });
  try { assert.equal(n.text('mcp-service-not-yours'), NOT_YOURS.service); } finally { await n.close(); }
});

test('MCPX5: the assistant drawer from the grants read, with Revoke; another member’s connection says only that', async () => {
  const { api, calls } = stubApi();
  const v = await mount({ view: { page: 'services', drawer: { kind: 'assistant', id: 'g1' } }, role: 'founder', api });
  try {
    assert.match(v.text('mcp-assistant-drawer'), /Signs in from assistant-a\.example · calls itself “Assistant A”.*Northwind Labs.*It cannot change a module, delete anything, or see other companies\..*No call recorded/s);
    assert.ok(v.has('mcp-assistant-permissions-wait'));
    await v.click('mcp-drawer-revoke');
    await v.click('mcp-revoke-yes');
    assert.deepEqual(calls.filter((c) => Array.isArray(c)), [['revoke', 'g1']]);
  } finally { await v.close(); }
  const n = await mount({ view: { page: 'services', drawer: { kind: 'assistant', id: 'g9' } }, role: 'founder', api: stubApi().api });
  try { assert.equal(n.text('mcp-assistant-not-yours'), NOT_YOURS.assistant); } finally { await n.close(); }
});

test('the wiring: the health client calls its landed route; no connect, disconnect or key action on the page; no secret drawn', async () => {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push([String(url), init.method || 'GET']); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try { await connectorsApi.health(); assert.deepEqual(seen, [['/api/connectors/health', 'GET']]); } finally { globalThis.fetch = prev; restore(); }
  const src = read('frontend/src/pages/account/builder/McpServicesPage.jsx');
  assert.doesNotMatch(src, /\.(connect|disconnect|oauthStart|create|rotate)\(/, 'connecting and key actions stay on their own pages');
  assert.doesNotMatch(src, /secret/i);
  assert.doesNotMatch(src + read('frontend/src/pages/account/builder/mcpServicesModel.js'), /credits|Never used/);
});
