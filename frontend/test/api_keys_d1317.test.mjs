/**
 * D1317 (#2480) — Account › Builder › API keys: the model, the page mounted
 * against D841's shapes (`routes/developer_keys.ts`) and D845's per-key month,
 * and the one-time reveal: the secret is drawn once, masked after Copy, gone
 * after Done, close and unmount, and never reaches a log, a report, storage or
 * an address. Every key, company and secret here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/api_keys_d1317.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ApiKeysPage from '../src/pages/account/builder/ApiKeysPage.jsx';
import {
  EXPIRY_OPTIONS, REFUSALS, REFUSED_CALLS, SECRET_RE, WORDS, canCreate, cardFor, companiesCell, createBody, createErrors, dayOf,
  filterCounts, keyState, limitFrom, monthOf, previewOf, refusalWords, replacementForm, rowsOf, summaryOf, usd,
} from '../src/pages/account/builder/apiKeysModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = new Date('2026-10-24T12:00:00Z');

const SCOPES = [
  { name: 'validate:read', label: 'Read Validate data', write: false },
  { name: 'validate:write', label: 'Add interviews and propose placements in Validate', write: true },
];
const COMPANIES = [{ id: 7, name: 'Example Labs' }, { id: 9, name: 'Sample Health' }];
const KEY = (extra = {}) => ({
  uid: 'u-deploy', name: 'Deploy bot', key_id: 'k7f3m2q9x4p1', prefix: 'axk_k7f3m2q9x4p1', scopes: ['validate:read'],
  companies: [{ id: 7, name: 'Example Labs', still_owned: true }], created_at: '2026-10-02 09:00:00', last_used_at: '2026-10-21 14:32:10',
  expires_at: '2026-12-31 09:00:00', revoked_at: null, revoked_reason: null, monthly_limit_microusd: 20_000_000, rate_per_minute: 60, ...extra,
});
const KEYS = () => [
  KEY(),
  KEY({ uid: 'u-sync', name: 'Nightly sync', key_id: 'r2d8w5n1c6v3', prefix: 'axk_r2d8w5n1c6v3', scopes: ['validate:read', 'validate:write'], companies: [{ id: 7, name: 'Example Labs', still_owned: true }, { id: 9, name: 'Sample Health', still_owned: false }], created_at: '2026-09-12 08:00:00', last_used_at: null, expires_at: '2026-10-30 08:00:00', monthly_limit_microusd: null }),
  KEY({ uid: 'u-old', name: 'Old laptop script', key_id: 'h9j4t7b2m5x8', prefix: 'axk_h9j4t7b2m5x8', created_at: '2026-08-04 08:00:00', revoked_at: '2026-10-18 10:00:00', revoked_reason: 'revoked' }),
  KEY({ uid: 'u-trial', name: 'Trial import', key_id: 'p3s6v9y2b5e8', prefix: 'axk_p3s6v9y2b5e8', created_at: '2026-09-01 08:00:00', expires_at: '2026-10-01 08:00:00' }),
];
const LIST = (extra = {}) => ({ enabled: true, keys: KEYS(), scopes_available: SCOPES, companies_available: COMPANIES, max_live_keys: 25, ...extra });
// A secret of the real shape, invented here: never one a Worker minted.
const SECRET = `axk_n3wk3y0000aa_${'A'.repeat(20)}${'b'.repeat(20)}-_9`;
const ROTATED = `axk_n3wk3y0000bb_${'C'.repeat(40)}x_1`;
const status = (s, code) => Object.assign(new Error('refused'), { status: s, code });

function stubs(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  let list = LIST();
  const api = {
    list: rec('list', () => over.list?.() ?? list),
    limits: rec('limits', () => over.limits?.() ?? { window_seconds: 60, member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled: true, keys: [{ uid: 'u-deploy', rate_per_minute: 60 }] }),
    create: rec('create', (b) => over.create?.(b) ?? (list = { ...list, keys: [KEY({ uid: 'u-new', name: b.name, key_id: 'n3wk3y0000aa', prefix: 'axk_n3wk3y0000aa', created_at: '2026-10-24 12:00:00', last_used_at: null }), ...list.keys] }, { key: list.keys[0], secret: SECRET })),
    update: rec('update', (uid, b) => over.update?.(uid, b) ?? { key: KEY({ ...b }) }),
    revoke: rec('revoke', (uid) => over.revoke?.(uid) ?? (list = { ...list, keys: list.keys.map((k) => (k.uid === uid ? { ...k, revoked_at: '2026-10-24 12:00:00' } : k)) }, { key: list.keys.find((k) => k.uid === uid) })),
    rotate: rec('rotate', (uid) => over.rotate?.(uid) ?? { key: KEY({ uid: 'u-rot', key_id: 'n3wk3y0000bb', prefix: 'axk_n3wk3y0000bb' }), secret: ROTATED, replaced: { uid, revoked_at: '2026-10-24 14:40:00' } }),
  };
  const usageApi = {
    keys: rec('usage.keys', () => over.usage?.() ?? { month: '2026-10', near_limit_percent: 80, keys: [{ uid: 'u-deploy', calls: 40, charged_microusd: 4_100_000, metered_calls: 40, used_percent: 20, alert: null }] }),
    events: rec('usage.events', () => over.events?.() ?? { range: {}, events: [{ execution_id: 'e1', created_at: '2026-10-21 14:32:00', operation: 'get_validate_context', outcome: 'ok' }, { execution_id: 'e2', created_at: '2026-10-21 14:28:00', operation: 'submit_interview', outcome: 'refused' }] }),
  };
  return { api, usageApi, calls };
}

let where = null;
function Where() { where = useLocation().pathname; return null; }

async function mounted(props = {}, { url = '/account/builder/keys', over = {} } = {}) {
  const restore = installDocument();
  const { api, usageApi, calls } = stubs(over);
  const previous = { open: globalThis.open, alert: globalThis.alert, confirm: globalThis.confirm, fetch: globalThis.fetch };
  const sink = [];
  const consoles = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { consoles[k] = console[k]; console[k] = (...a) => sink.push(['console', ...a]); }
  globalThis.fetch = async (u, o = {}) => { sink.push(['fetch', String(u), o.body ?? '']); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }; };
  const store = (name) => ({ getItem: () => null, setItem: (k, v) => sink.push([name, k, v]), removeItem() {} });
  Object.defineProperty(globalThis, 'localStorage', { value: store('localStorage'), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: store('sessionStorage'), configurable: true, writable: true });
  const clip = [];
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { ...(nav || {}), userAgent: 'test', clipboard: { writeText: async (t) => { clip.push(t); } } }, configurable: true, writable: true });
  const popups = [];
  globalThis.open = (...a) => { popups.push(['open', ...a]); return null; };
  globalThis.alert = (...a) => popups.push(['alert', ...a]);
  globalThis.confirm = (...a) => { popups.push(['confirm', ...a]); return true; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const element = (uid) => h(ApiKeysPage, { api, usageApi, now: NOW, drawerUid: uid, ...props });
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Where), h(Routes, null,
    h(Route, { path: '/account/builder/keys', element: element(null) }),
    h(Route, { path: '/account/builder/keys/:uid', element: h(DrawerRoute, { element }) }),
    h(Route, { path: '*', element: h('div', { 'data-testid': 'elsewhere' }) })))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const values = () => nodes().map((n) => props_(n).value).filter((v) => typeof v === 'string');
  return {
    calls, sink, clip, popups, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(document.body), values,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props_(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    unmount: async () => { await act(async () => root.unmount()); },
    async close() {
      try { await act(async () => root.unmount()); } catch { /* already */ }
      Object.assign(globalThis, previous);
      Object.assign(console, consoles);
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
      restore();
    },
  };
}
function DrawerRoute({ element }) {
  const { pathname } = useLocation();
  return element(decodeURIComponent(pathname.split('/').pop()));
}
const leaks = (m) => m.sink.filter((e) => e.some((x) => typeof x === 'string' && SECRET_RE.test(x)) || e.slice(1).some((x) => x && typeof x === 'object' && SECRET_RE.test(JSON.stringify(x))));

// ---------------------------------------------------------------- model

test('a key\'s state: revoked, expired, expiring soon or active, each with an icon and a word', () => {
  assert.deepEqual(keyState(KEY(), NOW), { id: 'active', icon: '✓', word: 'Active', live: true });
  assert.equal(keyState(KEY({ expires_at: '2026-10-30 08:00:00' }), NOW).word, 'Expires in 6 days');
  assert.equal(keyState(KEY({ expires_at: '2026-10-25 11:00:00' }), NOW).word, 'Expires in 1 day');
  assert.equal(keyState(KEY({ expires_at: '2026-10-31 13:00:00' }), NOW).id, 'active', 'eight days out is not soon');
  assert.equal(keyState(KEY({ expires_at: '2026-10-24 12:00:00' }), NOW).id, 'expired', 'expiry at this instant is expired, as the Worker reads it');
  assert.equal(keyState(KEY({ expires_at: '2026-10-01 08:00:00' }), NOW).word, 'Expired');
  assert.equal(keyState(KEY({ revoked_at: '2026-10-18 10:00:00', expires_at: '2026-10-01 08:00:00' }), NOW).word, 'Revoked', 'revoked wins over expired');
  assert.equal(keyState(KEY({ expires_at: null }), NOW).id, 'active');
});

test('the preview never holds more than the public prefix', () => {
  assert.equal(previewOf(KEY()), 'axk_k7f3m2q9x4p1_••••');
  assert.equal(previewOf({ prefix: SECRET }), 'axk_••••', 'a secret handed as a prefix is never drawn');
  assert.equal(previewOf({ prefix: 'axk_short' }), 'axk_••••');
  assert.equal(previewOf({}), 'axk_••••');
  assert.ok(!SECRET_RE.test(previewOf(KEY())));
  assert.ok(SECRET_RE.test(SECRET) && SECRET_RE.test(ROTATED), 'the test secrets have the real shape');
});

test('the create body: exactly the ticked companies and permissions the read offered, and the limit in micro-USD', () => {
  const r = LIST();
  const body = createBody({ name: '  Deploy bot ', companies: ['7', '99'], scopes: ['validate:read', 'admin:all'], expiry: '90', limit: '$20.50' }, r);
  assert.deepEqual(body, { name: 'Deploy bot', scopes: ['validate:read'], companies: [7], expires_in_days: 90, monthly_limit_microusd: 20_500_000 });
  assert.equal(createBody({ expiry: 'never' }, r).expires_in_days, null);
  assert.equal(createBody({ expiry: 'nope' }, r).expires_in_days, 90, 'an unknown choice falls back to 90 days');
  assert.deepEqual(EXPIRY_OPTIONS.map((o) => o.days), [30, 90, 365, null]);
  assert.deepEqual(limitFrom(''), { ok: true, micro: null });
  assert.deepEqual(limitFrom('20'), { ok: true, micro: 20_000_000 });
  assert.deepEqual(limitFrom('0'), { ok: false, micro: null });
  assert.deepEqual(limitFrom('twenty'), { ok: false, micro: null });
  assert.deepEqual(limitFrom('1.234'), { ok: false, micro: null });
  const errs = createErrors({ name: '', companies: [], scopes: [], limit: 'x' }, r);
  assert.deepEqual(Object.keys(errs).sort(), ['companies', 'limit', 'name', 'scopes']);
  assert.equal(errs.companies, 'Tick at least one company.');
  assert.deepEqual(createErrors({ name: 'a', companies: ['7'], scopes: ['validate:read'], limit: '' }, r), {});
  assert.match(createErrors({ name: 'x'.repeat(61), companies: ['7'], scopes: ['validate:read'] }, r).name, /at most 60/);
});

test('the summary sentence, the money, the dates and the cells', () => {
  const r = LIST();
  assert.equal(summaryOf({ name: 'Deploy bot', companies: ['7'], scopes: ['validate:read'], expiry: '90', limit: '20' }, r, NOW),
    'Deploy bot can read Validate data for Example Labs, until 22 Jan, up to $20.00 of AI tokens a month.');
  assert.equal(summaryOf({ name: '', companies: ['7', '9'], scopes: [], expiry: 'never', limit: '' }, r, NOW),
    'This key can do nothing yet for Example Labs and Sample Health, with no expiry, with no AI token limit of its own.');
  assert.equal(usd(4_100_000), '$4.10');
  assert.equal(usd(null), null, 'not recorded is never $0.00');
  assert.equal(usd(0), '$0.00');
  assert.equal(dayOf('2026-10-02 09:00:00'), '2 Oct');
  assert.equal(dayOf(null), null);
  assert.equal(companiesCell(KEYS()[1]), 'Both companies');
  assert.equal(companiesCell(KEY()), 'Example Labs');
  assert.equal(companiesCell({ companies: [] }), '—');
});

test('this month per key: used against the limit, and nothing drawn as zero when it was not read', () => {
  const usage = { keys: [{ uid: 'u-deploy', calls: 40, charged_microusd: 4_100_000, used_percent: 20 }, { uid: 'u-sync', calls: 0, charged_microusd: null, used_percent: null }] };
  assert.deepEqual(monthOf(KEY(), usage), { used: '$4.10', limit: '$20.00', pct: 20, read: true, calls: 40 });
  assert.deepEqual(monthOf(KEYS()[1], usage), { used: null, limit: null, pct: null, read: true, calls: 0 });
  assert.equal(monthOf(KEY(), null).read, false);
  assert.equal(monthOf(KEY(), { keys: [{ uid: 'u-deploy', charged_microusd: 1, used_percent: 140 }] }).pct, 100);
});

test('search, filters, sort and counts', () => {
  const keys = KEYS();
  assert.deepEqual(filterCounts(keys, NOW), { active: 2, expired: 1, revoked: 1 });
  assert.deepEqual(rowsOf(keys, { filter: 'active' }, NOW).map((k) => k.uid), ['u-deploy', 'u-sync'], 'last used first; never used last');
  assert.deepEqual(rowsOf(keys, { filter: 'revoked' }, NOW).map((k) => k.uid), ['u-old']);
  assert.deepEqual(rowsOf(keys, { q: 'r2d8' }, NOW).map((k) => k.uid), ['u-sync'], 'searched by key id');
  assert.deepEqual(rowsOf(keys, { q: 'TRIAL' }, NOW).map((k) => k.uid), ['u-trial']);
  assert.deepEqual(rowsOf(keys, { sort: 'name' }, NOW).map((k) => k.name), ['Deploy bot', 'Nightly sync', 'Old laptop script', 'Trial import']);
  assert.deepEqual(rowsOf(keys, { sort: 'created' }, NOW).map((k) => k.uid), ['u-deploy', 'u-sync', 'u-trial', 'u-old']);
  assert.deepEqual(rowsOf(keys, { sort: 'expires' }, NOW).map((k) => k.uid)[0], 'u-trial');
});

test('which card: off on 404, the Explorer\'s, nothing to reach, empty, or the list; Create needs a company and no support session', () => {
  assert.equal(cardFor({ httpStatus: 404 }), 'off');
  assert.equal(cardFor({ read: LIST({ keys: [] }), role: 'explorer' }), 'explorer');
  assert.equal(cardFor({ read: LIST({ keys: [], companies_available: [] }) }), 'nothing');
  assert.equal(cardFor({ read: LIST({ keys: [] }) }), 'empty');
  assert.equal(cardFor({ read: LIST({ companies_available: [] }) }), 'list', 'existing keys still list, with Revoke, when nothing is grantable');
  assert.equal(canCreate(LIST()), true);
  assert.equal(canCreate(LIST(), { support: true }), false);
  assert.equal(canCreate(LIST({ companies_available: [] })), false);
});

test('every write refusal code has its words; a status without a code never shows server text', () => {
  for (const code of ['invalid_name', 'invalid_scopes', 'invalid_companies', 'invalid_expiry', 'invalid_limit', 'too_many_keys', 'not_live', 'session_required']) {
    assert.equal(refusalWords(status(400, code)), REFUSALS[code], code);
  }
  assert.equal(refusalWords(status(403)), 'A support session cannot create, rotate or revoke keys.');
  assert.equal(refusalWords(Object.assign(status(429), { retryAfter: 29.2 })), 'Too many changes. Try again in 30 seconds.');
  assert.equal(refusalWords(status(500), { name: 'Deploy bot' }), 'Deploy bot was not changed. Try again.');
  assert.equal(refusalWords(Object.assign(new Error('SQLITE_BUSY: database is locked'), { status: 500 })), 'The key was not changed. Try again.');
  assert.deepEqual(REFUSED_CALLS.map(([c, k]) => `${c} ${k}`), ['401 invalid_key', '401 revoked_key', '401 expired_key', '403 insufficient_scope', '402 insufficient_tokens', '429 rate_limited']);
  // The Worker's own codes are the ones mapped: none it can send is left as raw text.
  const route = read('cloudflare-worker/src/routes/developer_keys.ts') + read('cloudflare-worker/src/services/apiKeys.ts');
  for (const code of new Set([...route.matchAll(/code: '([a-z_]+)'|KeyInputError\('([a-z_]+)'/g)].map((m) => m[1] || m[2]))) assert.ok(REFUSALS[code], `unmapped Worker code ${code}`);
});

test('a replacement copies the settings, never a secret, and drops a company no longer owned', () => {
  const f = replacementForm(KEYS()[1]);
  assert.deepEqual(f, { name: 'Nightly sync', companies: ['7'], scopes: ['validate:read', 'validate:write'], expiry: '90', limit: '' });
  assert.equal(replacementForm(KEY()).limit, '20.00');
  assert.ok(!JSON.stringify(f).includes('axk_'));
});

// ---------------------------------------------------------------- page

test('APIK1: the list, each key as its preview, its state, its month, and the rule; card 2 with the limits', async () => {
  const m = await mounted();
  try {
    assert.ok(m.has('apik-list'));
    const t = m.all();
    for (const s of ['Deploy bot', 'axk_k7f3m2q9x4p1_••••', 'Expires in 6 days', 'Revoked', 'Expired', 'Both companies', '$4.10 of $20.00', 'No limit · No call recorded', WORDS.rule]) assert.ok(t.includes(s), s);
    assert.match(m.textOf('apik-limits'), /Limits: 60 calls a minute per key, 120 across all your keys and assistants\./);
    assert.match(t, /Active 2.*Expired 1.*Revoked 1/s);
    assert.match(m.textOf('apik-row-u-old'), /—/, 'a revoked key draws no meter');
    assert.equal(m.has('apik-rotate-u-old'), false, 'no Rotate on a revoked key');
    assert.ok(m.has('apik-replace-u-trial'), 'an expired key offers a replacement');
    assert.equal(m.has('apik-refusals'), false);
    await m.click('apik-refusals-toggle');
    assert.match(m.textOf('apik-refusals'), /402 insufficient_tokens.*Add tokens in Usage › AI tokens\..*A refusal never says whether a key exists\./s);
    assert.doesNotMatch(t, /credits/i);
  } finally { await m.close(); }
});

test('APIK2 → APIK3 → APIK4: create sends the ticked choices; the secret shows once, masks on Copy, and is gone after Done', async () => {
  const m = await mounted();
  try {
    await m.click('apik-create-open');
    assert.ok(m.has('apik-create'));
    await m.click('apik-create-submit');
    assert.equal(m.calls.filter((c) => c[0] === 'create').length, 0, 'nothing sent with no choice');
    assert.equal(m.textOf('apik-err-companies'), 'Tick at least one company.');
    await m.change('apik-name', 'Deploy bot');
    await m.change('apik-company-7', true);
    await m.change('apik-scope-validate:read', true);
    await m.click('apik-expiry-never');
    assert.equal(m.textOf('apik-never'), WORDS.never);
    await m.click('apik-expiry-30');
    await m.change('apik-limit', '20');
    assert.match(m.textOf('apik-summary'), /^Deploy bot can read Validate data for Example Labs, until 23 Nov, up to \$20\.00 of AI tokens a month\.$/);
    await m.click('apik-create-submit');
    assert.deepEqual(m.calls.find((c) => c[0] === 'create')[1], { name: 'Deploy bot', scopes: ['validate:read'], companies: [7], expires_in_days: 30, monthly_limit_microusd: 20_000_000 });

    // The reveal: the secret is in the field, once.
    assert.ok(m.has('apik-reveal'));
    assert.equal(m.props('apik-secret').value, SECRET);
    assert.equal(m.props('apik-secret').autoComplete, 'off');
    assert.equal(m.props('apik-secret').spellCheck, false);
    assert.equal(m.props('apik-secret')['data-private'], 'true');
    assert.equal(m.props('apik-secret')['aria-label'], 'API key, shown once');
    assert.ok(!m.all().includes(SECRET), 'the secret is a field value, never page text');
    assert.equal(m.props('apik-reveal-done').disabled, true, 'Done waits for the tick');

    await m.click('apik-copy');
    assert.deepEqual(m.clip, [SECRET]);
    assert.equal(m.props('apik-secret').value, 'axk_n3wk3y0000aa_••••', 'masked after Copy');
    assert.equal(m.textOf('apik-copy'), 'Copied');
    assert.ok(m.has('apik-copied-line'));
    assert.ok(!m.values().includes(SECRET), 'nothing on the page holds it any more');
    assert.equal(m.props('apik-copy').disabled, true, 'a second Copy cannot read a secret that is gone');

    await m.change('apik-stored', true);
    await m.click('apik-reveal-done');
    assert.equal(m.has('apik-reveal'), false);
    assert.ok(!m.values().includes(SECRET));
    assert.match(m.textOf('apik-notice'), /^Deploy bot is ready\. Its secret is no longer shown anywhere\.$/);
    assert.ok(m.has('apik-row-u-new'));
    assert.match(m.textOf('apik-row-u-new'), /axk_n3wk3y0000aa_••••/);
    assert.deepEqual(leaks(m), [], 'no log, report, storage write or request carried the secret');
    assert.equal(where, '/account/builder/keys', 'the secret never had an address');
    assert.deepEqual(m.popups, []);
  } finally { await m.close(); }
});

test('APIK3: closing before the tick asks first; Go back keeps it, Close drops it; unmount drops it too', async () => {
  const n = await mounted();
  try {
    await n.click('apik-create-open');
    await n.change('apik-name', 'Deploy bot');
    await n.change('apik-company-7', true);
    await n.change('apik-scope-validate:read', true);
    await n.click('apik-create-submit');
    await n.click('apik-reveal-close');
    assert.ok(n.has('apik-close-early'), 'closing early asks');
    await n.click('apik-go-back');
    assert.equal(n.has('apik-close-early'), false);
    assert.equal(n.props('apik-secret').value, SECRET, 'Go back keeps the secret on screen');
    await n.click('apik-reveal-close');
    await n.click('apik-close-anyway');
    assert.equal(n.has('apik-reveal'), false);
    assert.ok(!n.values().includes(SECRET));
    assert.deepEqual(leaks(n), []);
  } finally { await n.close(); }
  const u = await mounted();
  try {
    await u.click('apik-create-open');
    await u.change('apik-name', 'Deploy bot');
    await u.change('apik-company-7', true);
    await u.change('apik-scope-validate:read', true);
    await u.click('apik-create-submit');
    assert.equal(u.props('apik-secret').value, SECRET);
    await u.unmount();
    assert.ok(!u.values().includes(SECRET), 'unmounted, it is nowhere in the document');
    assert.deepEqual(leaks(u), []);
  } finally { await u.close(); }
});

test('a create refusal is shown in the dialog in the page\'s words', async () => {
  const m = await mounted({}, { over: { create: () => { throw status(409, 'too_many_keys'); } } });
  try {
    await m.click('apik-create-open');
    await m.change('apik-name', 'Deploy bot');
    await m.change('apik-company-7', true);
    await m.change('apik-scope-validate:read', true);
    await m.click('apik-create-submit');
    assert.equal(m.textOf('apik-create-refusal'), REFUSALS.too_many_keys);
    assert.equal(m.has('apik-reveal'), false);
  } finally { await m.close(); }
});

test('APIK7: Revoke needs the typed name and shows Revoked from the re-read, never before', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const m = await mounted({}, { over: { revoke: async (uid) => { await gate; return { key: KEY({ uid, revoked_at: '2026-10-24 12:00:00' }) }; } } });
  try {
    await m.click('apik-revoke-u-deploy');
    assert.equal(m.props('apik-revoke-go').disabled, true);
    await m.change('apik-revoke-name', 'Deploy');
    assert.equal(m.props('apik-revoke-go').disabled, true);
    await m.change('apik-revoke-name', 'Deploy bot');
    assert.equal(m.props('apik-revoke-go').disabled, false);
    const pending = m.click('apik-revoke-go');
    assert.match(m.textOf('apik-row-u-deploy'), /Active/, 'not revoked while the write is in flight');
    release();
    await pending;
    assert.deepEqual(m.calls.filter((c) => c[0] === 'revoke'), [['revoke', 'u-deploy']]);
    assert.equal(m.textOf('apik-notice'), 'Deploy bot was revoked.');
  } finally { await m.close(); }
});

test('a failed revoke keeps the row and says so', async () => {
  const m = await mounted({}, { over: { revoke: () => { throw status(500); } } });
  try {
    await m.click('apik-revoke-u-deploy');
    await m.change('apik-revoke-name', 'Deploy bot');
    await m.click('apik-revoke-go');
    assert.equal(m.textOf('apik-revoke-refusal'), 'Deploy bot was not changed. Try again.');
    assert.match(m.textOf('apik-row-u-deploy'), /Active/);
  } finally { await m.close(); }
});

test('APIK6: Rotate confirms, then reveals the new secret once with the old key revoked', async () => {
  const m = await mounted();
  try {
    await m.click('apik-rotate-u-deploy');
    assert.match(m.textOf('apik-rotate'), /The current key stops working at once\./);
    await m.click('apik-rotate-go');
    assert.equal(m.props('apik-secret').value, ROTATED);
    assert.equal(m.textOf('apik-reveal-old'), 'The old key axk_k7f3m2q9x4p1_•••• was revoked at 14:40.');
    await m.click('apik-copy');
    await m.change('apik-stored', true);
    await m.click('apik-reveal-done');
    assert.ok(!m.values().includes(ROTATED));
    assert.match(m.textOf('apik-notice'), /was rotated/);
    assert.deepEqual(leaks(m), []);
  } finally { await m.close(); }
});

test('APIK5: the drawer: still owned or lost, dates, month, recent requests; a rotate from it moves to the new key only after Done', async () => {
  const m = await mounted({}, { url: '/account/builder/keys/u-sync' });
  try {
    assert.ok(m.has('builder-drawer-key'));
    assert.match(m.textOf('apik-reach-7'), /Still yours ✓/);
    assert.match(m.textOf('apik-reach-9'), /You no longer own this company\. Calls for it are refused\./);
    assert.match(m.textOf('builder-drawer-key'), /Last used— No call recorded/);
    assert.match(m.textOf('apik-recent'), /get_validate_context.*OK.*submit_interview.*refused/s);
    assert.deepEqual(m.calls.find((c) => c[0] === 'usage.events')[1], { key: 'u-sync' });
    await m.click('apik-drawer-rotate');
    await m.click('apik-rotate-go');
    assert.equal(where, '/account/builder/keys/u-sync', 'no address change while the secret is shown');
    assert.equal(m.props('apik-secret').value, ROTATED);
    await m.change('apik-stored', true);
    await m.click('apik-reveal-done');
    assert.equal(where, '/account/builder/keys/u-rot');
  } finally { await m.close(); }
});

test('the drawer edits a live key\'s name and limit only, and sends only what changed', async () => {
  const m = await mounted({}, { url: '/account/builder/keys/u-deploy' });
  try {
    await m.click('apik-drawer-edit');
    await m.change('apik-edit-limit', '');
    await m.click('apik-edit-save');
    assert.deepEqual(m.calls.find((c) => c[0] === 'update').slice(1), ['u-deploy', { monthly_limit_microusd: null }]);
    assert.equal(m.textOf('apik-notice'), 'Deploy bot was saved.');
  } finally { await m.close(); }
});

test('APIK14: a uid that is not the member\'s says only that; a support session lists with no write', async () => {
  const m = await mounted({}, { url: '/account/builder/keys/someone-elses' });
  try {
    assert.equal(m.textOf('apik-foreign').startsWith(WORDS.foreign), true);
    assert.equal(m.has('apik-drawer-rotate'), false);
  } finally { await m.close(); }
  const s = await mounted({ support: true, who: 'Ada Founder' });
  try {
    assert.equal(s.textOf('apik-support'), 'You are viewing as Ada Founder. Keys cannot be created, rotated or revoked in a support session.');
    assert.ok(s.has('apik-list'));
    for (const id of ['apik-create-open', 'apik-rotate-u-deploy', 'apik-revoke-u-deploy', 'apik-replace-u-trial']) assert.equal(s.has(id), false, id);
  } finally { await s.close(); }
});

test('APIK9–APIK13: off at 404, unreadable is not none, empty, nothing to reach, the Explorer', async () => {
  const cases = [
    [{ list: () => { throw status(404); } }, {}, 'apik-off', WORDS.off],
    [{ list: () => { throw status(500); } }, {}, 'apik-unreadable', WORDS.unreadable],
    [{ list: () => LIST({ keys: [] }) }, {}, 'apik-empty', WORDS.empty],
    [{ list: () => LIST({ keys: [], companies_available: [] }) }, {}, 'apik-nothing', WORDS.nothing],
    [{ list: () => LIST({ keys: [], companies_available: [] }) }, { role: 'explorer' }, 'apik-explorer', WORDS.explorer],
  ];
  for (const [over, props, id, words] of cases) {
    const m = await mounted(props, { over });
    try {
      assert.ok(m.has(id), id);
      assert.ok(m.textOf(id).startsWith(words), id);
      if (id !== 'apik-empty') assert.equal(m.has('apik-create-open'), false, `${id} offers no Create`);
      if (id === 'apik-off') assert.equal(m.has('apik-how'), false, 'no form, no card 2 when off');
      if (id === 'apik-unreadable') assert.match(m.textOf(id), /That is not the same as having none\./);
    } finally { await m.close(); }
  }
  const hq = await mounted({ role: 'super_admin' }, { over: { list: () => LIST({ keys: [], companies_available: [] }) } });
  try { assert.match(hq.textOf('apik-nothing'), /Platform keys for connectors are set in HQ › Integration keys\./); } finally { await hq.close(); }
});

// ---------------------------------------------------------------- source rules

test('the source: one home for the secret, no pop-up, no hex, dark pairs, the client and its re-export', () => {
  const page = read('frontend/src/pages/account/builder/ApiKeysPage.jsx');
  const dialogs = read('frontend/src/pages/account/builder/ApiKeyDialogs.jsx');
  const model = read('frontend/src/pages/account/builder/apiKeysModel.js');
  for (const [name, src] of [['page', page], ['dialogs', dialogs], ['model', model]]) {
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/, name);
    assert.doesNotMatch(src, /(bg|text|border)-\[#/, name);
    assert.doesNotMatch(src, /localStorage|sessionStorage|console\.|reportError|posthog|track\(/, `${name} touches storage, logs or analytics`);
    assert.doesNotMatch(src, /credits/i, name);
  }
  assert.doesNotMatch(model, /\.secret\b/, 'the model never reads a secret');
  assert.equal((dialogs.match(/value=\{masked \? previewOf\(keyView\) : secret\}/g) || []).length, 1, 'one field draws the secret');
  assert.doesNotMatch(page, /searchParams|setSearchParams|\?secret|history\.(push|replace)State/);
  for (const src of [page, dialogs]) for (const m of src.matchAll(/hover:bg-gray-50(?! dark:hover)/g)) assert.match(src.slice(m.index, m.index + 200), /dark:hover:bg-/);
  const client = read('frontend/src/lib/api/developerKeys.js');
  assert.match(client, /update: \(uid, body\) => request\(`\/developer\/keys\/\$\{enc\(uid\)\}`, \{ method: 'PATCH'/);
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/developerKeys\.js';$/m);
  assert.match(read('cloudflare-worker/src/routes/developer_keys.ts'), /developerKeys\.patch\('\/:uid'/);
  assert.match(read('documentation/architecture/decisions/D1317.md'), /## D1317/);
});

test('a change of drawer address drops a secret on screen, even without a remount', async () => {
  const restore = installDocument();
  const { api, usageApi } = stubs();
  let setUid = null;
  function Host() {
    const [uid, set] = React.useState(null);
    setUid = set;
    return h(ApiKeysPage, { api, usageApi, now: NOW, drawerUid: uid });
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(document.body).find((n) => props_(n)['data-testid'] === id);
  const fire = async (id, ev) => { await act(async () => { await (ev ? props_(byId(id)).onChange(ev) : props_(byId(id)).onClick({ preventDefault() {} })); }); await flush(); };
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/account/builder/keys'] }, h(Host))));
    await flush();
    await fire('apik-create-open');
    await fire('apik-name', { target: { value: 'Deploy bot' } });
    await fire('apik-company-7', { target: { checked: true } });
    await fire('apik-scope-validate:read', { target: { checked: true } });
    await fire('apik-create-submit');
    assert.equal(props_(byId('apik-secret')).value, SECRET);
    await act(async () => setUid('u-deploy'));
    await flush();
    assert.equal(byId('apik-secret'), undefined, 'the reveal closed with the secret when the address changed');
  } finally { await act(async () => root.unmount()); restore(); }
});
