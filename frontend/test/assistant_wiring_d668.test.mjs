/**
 * D668 (#1498) part 3 — the AI assistant pages wired to #1496's routes (D666):
 * the consent page answers its request and follows only a safe redirect;
 * Connectors' AI assistants group reads and revokes grants, and says "Not
 * available yet" while the Worker's flag is off; the Record a session sheet
 * offers "From an AI assistant"; `/connect/assistant` is mounted.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/assistant_wiring_d668.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ConnectAssistantPage from '../src/pages/connect/ConnectAssistantPage.jsx';
import { AssistantsSection } from '../src/pages/account/AssistantsGroup.jsx';
import RecordSessionSheet from '../src/pages/founder/RecordSessionSheet.jsx';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';

const h = React.createElement;

async function mount(element, url = '/') {
  const restoreDoc = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, element)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(container);
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    text: () => textOf(container).replace(/\s+/g, ' '),
    byTestId,
    async flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); },
    async clickTestId(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await props(n).onClick?.({ stopPropagation() {}, preventDefault() {} }); }); },
    async tick(id) { const n = byTestId(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { props(n).onChange?.({ target: { checked: true } }); }); },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
}

const REQUEST = { client_name: 'Claude', redirect_host: 'claude.ai', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scopes: ['validate:read', 'validate:write'], companies: [{ id: 7, name: 'Acme' }, { id: 9, name: 'Second' }] };
const fail = (status) => Promise.reject(Object.assign(new Error('x'), { status }));

test('consent: reads the request, sends exactly the ticked company, and follows the https redirect', async () => {
  const calls = []; const went = [];
  const api = { consent: async (id) => { calls.push(['consent', id]); return REQUEST; }, approve: async (id, companies) => { calls.push(['approve', id, companies]); return { redirectTo: 'https://claude.ai/cb?code=abc&state=s' }; }, deny: async () => ({}) };
  const m = await mount(h(ConnectAssistantPage, { api, go: (u) => went.push(u) }), '/connect/assistant?request=req123');
  try {
    await m.flush();
    assert.match(m.text(), /It returns to https:\/\/claude\.ai\/api\/mcp\/auth_callback/);
    await m.tick('consent-company-9');
    await m.clickTestId('button-consent-approve');
    assert.deepEqual(calls, [['consent', 'req123'], ['approve', 'req123', [9]]]);
    assert.deepEqual(went, ['https://claude.ai/cb?code=abc&state=s']);
  } finally { await m.unmount(); }
});

test('consent: an unsafe redirect is not followed; deny follows its own; a request used meanwhile reads as used', async () => {
  const went = [];
  const unsafe = { consent: async () => REQUEST, approve: async () => ({ redirectTo: 'javascript:alert(1)' }), deny: async () => ({ redirectTo: 'https://claude.ai/cb?error=access_denied' }) };
  const m = await mount(h(ConnectAssistantPage, { api: unsafe, go: (u) => went.push(u) }), '/connect/assistant?request=r');
  try {
    await m.flush();
    await m.tick('consent-company-7');
    await m.clickTestId('button-consent-approve');
    assert.deepEqual(went, []);
    assert.match(m.text(), /will not send you to/);
    await m.clickTestId('button-consent-deny');
    assert.deepEqual(went, ['https://claude.ai/cb?error=access_denied']);
  } finally { await m.unmount(); }
  const used = { consent: async () => REQUEST, approve: () => fail(409), deny: async () => ({}) };
  const u = await mount(h(ConnectAssistantPage, { api: used, go: () => {} }), '/connect/assistant?request=r');
  try {
    await u.flush(); await u.tick('consent-company-7'); await u.clickTestId('button-consent-approve');
    assert.match(u.text(), /already used/);
  } finally { await u.unmount(); }
});

test('consent: the Worker\'s 404 (flag off) reads "Not available yet"; 410 reads expired', async () => {
  for (const [status, re] of [[404, /Not available yet/], [410, /has expired/]]) {
    const m = await mount(h(ConnectAssistantPage, { api: { consent: () => fail(status) }, go: () => {} }), '/connect/assistant?request=r');
    try { await m.flush(); assert.match(m.text(), re); } finally { await m.unmount(); }
  }
});

test('Connectors: the group reads grants, revokes after asking, and with the flag off shows no setup cards', async () => {
  const revoked = [];
  const api = { grants: async () => ({ grants: [{ id: 'g1', client_name: 'Claude', redirect_host: 'claude.ai', companies: [{ id: 7, name: 'Acme' }], connected_at: '2026-10-01T00:00:00Z', last_used_at: null }] }), revoke: async (id) => { revoked.push(id); } };
  const m = await mount(h(AssistantsSection, { api }));
  try {
    await m.flush();
    assert.match(m.text(), /Claude claude\.ai/);
    await m.clickTestId('button-revoke-g1');
    assert.deepEqual(revoked, [], 'the first press only asks');
    await m.clickTestId('button-revoke-yes-g1');
    assert.deepEqual(revoked, ['g1']);
    assert.match(m.text(), /No assistant is connected yet/);
  } finally { await m.unmount(); }
  const off = await mount(h(AssistantsSection, { api: { grants: () => fail(404) } }));
  try {
    await off.flush();
    assert.match(off.text(), /Not available yet/);
    assert.equal(off.byTestId('assistant-card-chatgpt'), undefined, 'no setup cards for a server that is off');
  } finally { await off.unmount(); }
  const bad = await mount(h(AssistantsSection, { api: { grants: () => fail(500) } }));
  try { await bad.flush(); assert.ok(bad.byTestId('assistant-grants-unreadable')); } finally { await bad.unmount(); }
});

test('the Record a session sheet offers "From an AI assistant": the entry with the company named, and no Start', async () => {
  const models = { live: [], final: [], defaults: { live: null, final: null } };
  const el = h(ActiveCompanyContext.Provider, { value: { company: { company_name: 'Acme Robotics' } } },
    h(RecordSessionSheet, { interview: { id: 1, interviewee_name: 'Ana' }, initialModels: models, onClose() {}, onCreated() {} }));
  const m = await mount(el);
  try {
    assert.ok(m.byTestId('button-start-recording'));
    await m.clickTestId('channel-assistant');
    assert.ok(m.byTestId('assistant-entry'));
    assert.equal(m.byTestId('button-start-recording'), undefined, 'the assistant sends it; nothing to start here');
    assert.match(m.text(), /consent must cover your AI assistant processing the interview/);
    assert.match(m.text(), /Your assistant sends the interview/);
  } finally { await m.unmount(); }
  const prompt = readFileSync('frontend/src/pages/founder/RecordSessionSheet.jsx', 'utf8');
  assert.match(prompt, /<AssistantEntry companyName=\{company\?\.company_name \|\| ''\} \/>/);
});

test('/connect/assistant is mounted, signed in, with sign-in and back for a visitor', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/connect\/assistant" element=\{user \? <ConnectAssistantPage \/> : <Navigate to=\{assistantSignInPath\(location\)\} replace \/>\} \/>/);
  assert.match(readFileSync('frontend/src/pages/account/AccountConnectors.jsx', 'utf8'), /<AssistantsSection \/>/);
  assert.match(readFileSync('frontend/src/lib/api.js', 'utf8'), /export \* from '\.\/api\/assistants\.js';/);
});
