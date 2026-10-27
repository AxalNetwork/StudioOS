// D1320 (#2481) — Account › Builder › API usage and Activity's request history
// (APIU1–APIU12): the pure model, both pages mounted through Builder on a
// stubbed fetch, the request drawer, and the words. Every name and figure is
// made up; no test reaches the Worker.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/api_usage_d1320.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuilderSection from '../src/pages/account/builder/BuilderSection.jsx';
import { builderViewFor } from '../src/pages/account/builder/builderModel.js';
import {
  BREAKDOWNS, CATEGORIES, KEY_ALERTS, OUTCOMES, accountMeter, breakdownRows, breakdownSummary, callerOf, callerOptions, categoryLine,
  daySeries, daySummary, daysCsv, eventParams, eventsCsv, keyAlertLine, keyMeter, previousRange, rangeFor, reportParams,
  requestActions, requestTokens, resetsOn, tiles, tokensText, topReasons, usageQuery, usageSearch,
} from '../src/pages/account/builder/apiUsageModel.js';

const h = React.createElement;
const NOW = new Date('2026-10-21T15:00:00Z');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, error) => () => response({ error, message: 'Refused.' }, status);

const STATS = (o = {}) => ({ calls: 0, ok: 0, errors: 0, refused: 0, rate_limited: 0, insufficient_tokens: 0, error: 0, charged_microusd: null, refunded_microusd: null, metered_calls: 0, p50_ms: null, ...o });
const KEYS = { month: '2026-10', near_limit_percent: 80, keys: [
  { uid: 'k1', name: 'Deploy bot', key_id: 'k7f3m2q9x4p1', live: true, monthly_limit_microusd: 20_000_000, calls: 40, charged_microusd: 16_400_000, metered_calls: 40, used_percent: 82, alert: 'near_limit' },
  { uid: 'k2', name: 'Nightly sync', key_id: 'r2d8w5n1c6v3', live: true, monthly_limit_microusd: null, calls: 9, charged_microusd: 850_000, metered_calls: 9, used_percent: null, alert: null },
  { uid: 'k3', name: 'Old laptop', key_id: 'aaaaaaaaaaaa', live: false, monthly_limit_microusd: null, calls: 0, charged_microusd: null, metered_calls: 0, used_percent: null, alert: null },
] };
const GRANTS = { grants: [{ id: 'g1', client_name: 'Assistant A', companies: [] }] };
const PROJECTS = { projects: [{ id: 7, name: 'Northwind Labs' }] };
const DAY_REPORT = {
  recorded: true, recorded_since: '2026-10-08', range: { from: '2026-09-22', to: '2026-10-21' }, group: 'day', by: null, key: null,
  totals: STATS({ calls: 12, ok: 9, errors: 3, refused: 1, error: 1, insufficient_tokens: 1, charged_microusd: 6_420_000, refunded_microusd: 380_000, metered_calls: 10 }),
  groups: [
    { key: '2026-10-09', label: '2026-10-09', ...STATS({ calls: 5, ok: 4, errors: 1, refused: 1, charged_microusd: 4_000_000, metered_calls: 5 }) },
    { key: '2026-10-20', label: '2026-10-20', ...STATS({ calls: 7, ok: 5, errors: 2, error: 1, insufficient_tokens: 1, charged_microusd: 2_420_000, metered_calls: 5 }) },
  ], next_cursor: null,
};
const groupReport = (groups) => ({ ...DAY_REPORT, group: 'x', groups });
const KEY_REPORT = groupReport([
  { key: 'k1', label: 'Deploy bot', ...STATS({ calls: 8, errors: 1, charged_microusd: 4_100_000, p50_ms: 420 }) },
  { key: null, label: null, ...STATS({ calls: 4, errors: 2, charged_microusd: 2_320_000 }) },
]);
const CATEGORY_REPORT = groupReport([
  { key: null, ...STATS({ calls: 9 }) }, { key: 'scope', ...STATS({ calls: 1 }) }, { key: 'insufficient_tokens', ...STATS({ calls: 1 }) }, { key: 'timeout', ...STATS({ calls: 1 }) },
]);
const EVENT = (o = {}) => ({
  execution_id: '11111111-2222-4333-8444-555555555555', created_at: '2026-10-21 14:32:07', surface: 'mcp', operation: 'structure_with_axalvc',
  outcome: 'ok', error_category: null, duration_ms: 420, api_key_uid: 'k1', grant_id: null, client: null, company_id: 7,
  model: 'secret-model-name-x1', provider: null, connector: null, reservation_uid: 'h1', reserved_microusd: 10_000, charged_microusd: 4_000, refunded_microusd: 6_000, ...o,
});
const EVENTS = { range: DAY_REPORT.range, events: [
  EVENT(),
  EVENT({ execution_id: 'aaaaaaaa-2222-4333-8444-555555555555', operation: 'get_validate_context', outcome: 'refused', error_category: 'scope', charged_microusd: null, reservation_uid: null, reserved_microusd: null, refunded_microusd: null, api_key_uid: null, grant_id: 'g1' }),
  EVENT({ execution_id: 'bbbbbbbb-2222-4333-8444-555555555555', operation: 'search_docs', charged_microusd: 0, reservation_uid: null, api_key_uid: null, grant_id: 'gone', client: 'Tool X' }),
], next_cursor: 'c2' };

// ---------------------------------------------------------------- the model

test('the range: 7 days, 30 days, month to date and a custom range, in UTC, at most 92 days', () => {
  assert.deepEqual(rangeFor({ range: '7d' }, NOW), { id: '7d', from: '2026-10-15', to: '2026-10-21' });
  assert.deepEqual(rangeFor({ range: '30d' }, NOW), { id: '30d', from: '2026-09-22', to: '2026-10-21' });
  assert.deepEqual(rangeFor({ range: 'mtd' }, NOW), { id: 'mtd', from: '2026-10-01', to: '2026-10-21' });
  assert.deepEqual(rangeFor({ range: 'custom', from: '2026-08-01', to: '2026-08-31' }, NOW), { id: 'custom', from: '2026-08-01', to: '2026-08-31' });
  for (const bad of [{ from: '2026-08-31', to: '2026-08-01' }, { from: '2026-01-01', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: 'x', to: 'y' }]) {
    assert.equal(rangeFor({ range: 'custom', ...bad }, NOW).id, '30d', JSON.stringify(bad));
  }
  assert.equal(rangeFor({ range: 'custom', from: '2026-07-22', to: '2026-10-21' }, NOW).id, 'custom', '92 days is allowed');
  assert.equal(rangeFor({ range: 'custom', from: '2026-07-21', to: '2026-10-21' }, NOW).id, '30d', '93 days is not');
  assert.deepEqual(rangeFor({ range: 'nope' }, NOW).id, '30d');
  assert.deepEqual(previousRange({ from: '2026-10-15', to: '2026-10-21' }), { from: '2026-10-08', to: '2026-10-14' });
  assert.equal(new Date('2026-10-21T23:30:00-05:00').toISOString().slice(0, 10), '2026-10-22');
  assert.equal(rangeFor({ range: '7d' }, new Date('2026-10-21T23:30:00-05:00')).to, '2026-10-22', 'the day is UTC’s, not the browser’s');
});

test('the address holds the range, key, breakdown and filters, and a plain view stays plain', () => {
  const v = usageQuery('?range=custom&from=2026-09-01&to=2026-09-30&key=k1&group=tool&compare=1', NOW);
  assert.deepEqual([v.range, v.key, v.group, v.compare], [{ id: 'custom', from: '2026-09-01', to: '2026-09-30' }, 'k1', 'tool', true]);
  assert.equal(usageSearch(v), '?range=custom&from=2026-09-01&to=2026-09-30&group=tool&key=k1&compare=1');
  assert.equal(usageSearch(usageQuery('', NOW)), '');
  assert.equal(usageQuery('?group=model', NOW).group, 'key', 'never a model breakdown');
  assert.equal(usageQuery('?key=../../x', NOW).key, null);
  const a = usageQuery('?caller=grant:g1&surface=api&outcome=failed&tool=search_docs&company=7', NOW);
  assert.deepEqual(eventParams(a, 'c2'), { from: '2026-09-22', to: '2026-10-21', key: undefined, grant: 'g1', surface: 'api', outcome: 'failed', operation: 'search_docs', company: '7', cursor: 'c2' });
  assert.equal(eventParams(usageQuery('?caller=key:k1', NOW)).key, 'k1');
  assert.equal(usageQuery('?outcome=nope&surface=web&company=0', NOW).outcome, null);
  assert.throws(() => reportParams(v, 'model'), /Usage › Cost/);
  assert.deepEqual(BREAKDOWNS.map((b) => b.id), ['key', 'provider', 'connector', 'tool']);
});

test('money: a measured zero is Free, a NULL is not recorded, and small calls keep their places', () => {
  assert.equal(tokensText(0), 'Free');
  assert.equal(tokensText(null), null);
  assert.equal(tokensText(undefined), null);
  assert.equal(tokensText(4_000), '$0.004');
  assert.equal(tokensText(6_420_000), '$6.42');
  assert.equal(tokensText(-5), null);
});

test('tiles from totals: a charge never metered is "Not recorded" with why, never $0', () => {
  const t = tiles(DAY_REPORT);
  assert.deepEqual(t.map((x) => [x.id, x.value]), [['requests', '12'], ['ok', '9'], ['failed', '3'], ['charged', '$6.42']]);
  assert.equal(t[3].sub, '$0.38 returned');
  const unmetered = tiles({ ...DAY_REPORT, totals: STATS({ calls: 3, ok: 3 }) })[3];
  assert.equal(unmetered.value, null);
  assert.match(unmetered.reason, /Not recorded before 8 Oct/);
  assert.equal(tiles({ ...DAY_REPORT, recorded_since: '2026-01-01', totals: STATS({ calls: 3 }) })[3].reason, 'Not recorded: no request in this range was metered.');
  const prev = tiles(DAY_REPORT, { totals: STATS({ calls: 2, ok: 2, charged_microusd: null }) });
  assert.deepEqual(prev.map((x) => x.prev), ['2', '2', '0', 'Not recorded']);
  assert.equal(tiles(null), null);
});

test('Chart 1: every day of the range; a day before usage was recorded has no bar, a day after with no row is a real zero', () => {
  const s = daySeries(DAY_REPORT, { from: '2026-10-06', to: '2026-10-10' });
  assert.deepEqual(s.map((d) => [d.day, d.recorded, d.calls, d.charged]), [
    ['2026-10-06', false, null, null], ['2026-10-07', false, null, null], ['2026-10-08', true, 0, null],
    ['2026-10-09', true, 5, 4_000_000], ['2026-10-10', true, 0, null],
  ]);
  assert.equal(daySummary(DAY_REPORT, { from: '2026-09-22', to: '2026-10-21' }), '12 requests in 30 days, 3 failed; $6.42 of AI tokens.');
  assert.equal(daySummary({ ...DAY_REPORT, totals: STATS({ calls: 1 }) }, { from: '2026-10-21', to: '2026-10-21' }), '1 request in 1 day, 0 failed; AI tokens not recorded.');
});

test('Chart 2: the top five by AI tokens, the rest folded into Other, a NULL charge kept NULL', () => {
  const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => ({ key: k, label: k, ...STATS({ calls: 10 - i, errors: 1, charged_microusd: i === 6 ? null : (7 - i) * 1000 }) }));
  const rows = breakdownRows(groupReport(groups), 'tool');
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b', 'c', 'd', 'e', 'Other']);
  assert.deepEqual([rows[5].other, rows[5].calls, rows[5].failed, rows[5].charged], [2, 5 + 4, 2, 2000], 'Other sums what it knows; g’s NULL adds nothing');
  const allNull = breakdownRows(groupReport(groups.map((g, i) => (i >= 5 ? { ...g, charged_microusd: null } : g))), 'tool');
  assert.equal(allNull[5].charged, null, 'Other of unmetered groups is not recorded, not 0');
  assert.equal(breakdownRows(groupReport(groups.slice(0, 5)), 'tool').length, 5, 'five groups fold nothing');
  const keyRows = breakdownRows(KEY_REPORT, 'key');
  assert.deepEqual(keyRows.map((r) => r.name), ['Deploy bot', 'Assistants (no key)']);
  assert.equal(breakdownRows(groupReport([{ key: null, ...STATS({ calls: 1 }) }]), 'connector')[0].name, 'No connector');
  assert.equal(breakdownSummary(keyRows, KEY_REPORT), 'Deploy bot spent the most: $4.10 of $6.42.');
});

test('every outcome and every reason D843 lists has its words', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/apiUsage.ts', import.meta.url), 'utf8');
  const list = [...src.match(/USAGE_ERROR_CATEGORIES = Object\.freeze\(\[([^\]]+)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(CATEGORIES).sort(), [...list].sort(), 'one sentence per D843 reason, no more');
  assert.deepEqual(Object.keys(OUTCOMES).sort(), ['error', 'insufficient_tokens', 'ok', 'rate_limited', 'refused']);
  assert.equal(categoryLine('scope'), 'The key lacks the permission for this tool.');
  assert.equal(categoryLine(null), null);
  assert.deepEqual(topReasons(CATEGORY_REPORT).map((r) => r.label), ['Not enough AI tokens', 'Missing permission', 'Service did not answer'], 'most first, then by reason');
  assert.equal(topReasons(CATEGORY_REPORT).length, 3);
  assert.ok(!topReasons(CATEGORY_REPORT).some((r) => r.id === null), 'a call that succeeded is no reason');
});

test('the key alerts say what D849 sends: 80% and 100% of a key\'s limit, and more than 20% of 50 calls failing in an hour', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/apiKeyLimits.ts', import.meta.url), 'utf8');
  assert.match(src, /KEY_LIMIT_THRESHOLDS = \[80, 100\]/);
  assert.match(src, /FAILURE_WINDOW_CALLS = 50;/);
  assert.match(src, /FAILURE_SHARE = 0\.2;/);
  assert.match(src, /type: 'api_key_limit'[^\n]*channels: \['in_app', 'email'\]/);
  assert.match(src, /type: 'api_key_failures'[^\n]*channels: \['in_app', 'email'\]/);
  assert.deepEqual(KEY_ALERTS.map((a) => a.id), ['api_key_limit', 'api_key_failures']);
  assert.match(KEY_ALERTS[0].title, /80% and 100%/);
  assert.match(KEY_ALERTS[1].title, /more than 20% of at least 50 calls on a key fail within an hour/);
});

test('callers: a key by name and preview, an assistant recognised by its connection, or unrecognised', () => {
  const ctx = { keys: KEYS.keys, grants: GRANTS.grants };
  assert.deepEqual(callerOf(EVENT(), ctx), { kind: 'key', name: 'Deploy bot', sub: 'axk_k7f3m2q9x4p1_••••' });
  assert.equal(callerOf(EVENT({ api_key_uid: null, grant_id: 'g1' }), ctx).name, 'Recognised as Assistant A');
  assert.deepEqual(callerOf(EVENT({ api_key_uid: null, grant_id: 'gone', client: 'Tool X' }), ctx), { kind: 'assistant', name: 'Unrecognised assistant', sub: 'It called itself “Tool X”' });
  assert.equal(callerOf(EVENT({ api_key_uid: 'kx' }), ctx).name, 'A key no longer listed');
  const opts = callerOptions(ctx);
  assert.deepEqual(opts.map((o) => [o.id, o.group]), [['key:k1', 'Keys'], ['key:k2', 'Keys'], ['key:k3', 'Revoked'], ['grant:g1', 'Assistants']]);
});

test('limits: a key against its own limit, "No limit", the 80% and 100% lines, and the account from D788', () => {
  assert.deepEqual(keyMeter(KEYS.keys[0]), { value: '$16.40 of $20.00', limit: '$20.00', percent: 82, alert: 'near_limit' });
  assert.equal(keyMeter(KEYS.keys[1]).limit, 'No limit');
  assert.equal(keyMeter({ ...KEYS.keys[0], charged_microusd: null, used_percent: null }).value, 'Nothing charged of $20.00');
  assert.equal(keyAlertLine(KEYS.keys[0], '2026-10'), 'Deploy bot has used 82% of its monthly limit.');
  assert.match(keyAlertLine({ ...KEYS.keys[0], alert: 'at_limit' }, '2026-12'), /stop until 1 Jan/);
  assert.equal(keyAlertLine(KEYS.keys[1], '2026-10'), null);
  assert.equal(resetsOn('2026-10'), '1 Nov');
  assert.deepEqual(accountMeter({ charged_microusd: 6_420_000, limit_microusd: 50_000_000, share_used: 12.8 }), { value: '$6.42 of $50.00', limit: '$50.00', percent: 12.8 });
  assert.equal(accountMeter({ charged_microusd: 0, limit_microusd: null }).value, '$0.00 this month');
});

test('a request: Held, Charged, Returned; a missing figure says why; what to do about a failure', () => {
  assert.deepEqual(requestTokens(EVENT()).map((t) => [t.label, t.value]), [['Held', '$0.01'], ['Charged', '$0.004'], ['Returned', '$0.006']]);
  const pending = requestTokens(EVENT({ charged_microusd: null, refunded_microusd: null }));
  assert.equal(pending[1].value, null);
  assert.match(pending[1].reason, /hold has not settled/);
  assert.deepEqual(requestActions(EVENT({ outcome: 'insufficient_tokens', error_category: 'insufficient_tokens' })).map((a) => a.to), ['/account/usage/ai-tokens']);
  assert.deepEqual(requestActions(EVENT({ outcome: 'refused', error_category: 'scope' })).map((a) => a.label), ['See the key ›']);
  assert.deepEqual(requestActions(EVENT({ outcome: 'error', error_category: 'timeout', connector: 'CRM' })).map((a) => a.label), ['Open CRM ›']);
  assert.deepEqual(requestActions(EVENT()), []);
});

test('CSV: the same reads; an empty money cell is not recorded, never 0; no model column', () => {
  const days = daysCsv(daySeries(DAY_REPORT, { from: '2026-10-07', to: '2026-10-09' }));
  assert.deepEqual(days.rows, [['2026-10-07', null, null, null, null], ['2026-10-08', 0, 0, 0, null], ['2026-10-09', 5, 4, 1, '4.000000']]);
  const ev = eventsCsv(EVENTS.events, { keys: KEYS.keys, grants: GRANTS.grants, companyName: (id) => (id === 7 ? 'Northwind Labs' : null) });
  assert.ok(!ev.header.includes('model'));
  assert.ok(!JSON.stringify(ev.rows).includes('secret-model-name-x1'), 'the model never leaves the read');
  assert.deepEqual(ev.rows[0].slice(2, 8), ['Deploy bot', 'MCP', 'structure_with_axalvc', 'Northwind Labs', 'OK', null]);
  assert.equal(ev.rows[1][10], null);
  assert.equal(ev.rows[2][10], '0.000000', 'a measured zero is 0 in a file');
});

// ---------------------------------------------------------------- mounted

function Host() {
  const loc = useLocation();
  return h(BuilderSection, { view: builderViewFor(loc.pathname), storage: { getItem: () => '1', setItem: () => {} } });
}

const ROUTES = {
  'GET /api/developer/usage/keys': () => response(KEYS),
  'GET /api/developer/limits': () => response({ window_seconds: 60, member: { calls_per_minute: 120 }, connection: { calls_per_minute: 60 }, keys_enabled: true, keys: [{ uid: 'k1', rate_per_minute: 60 }] }),
  'GET /api/ai-budget/limit': () => response({ month: '2026-10', charged_microusd: 6_420_000, limit_microusd: 50_000_000, share_used: 12.8, notify: { 50: true, 80: true, 100: false } }),
  'GET /api/connectors/assistants': () => response(GRANTS),
  'GET /api/account/projects': () => response(PROJECTS),
  'GET /api/developer/usage': ({ url }) => response({ day: DAY_REPORT, key: KEY_REPORT, category: CATEGORY_REPORT, tool: groupReport([{ key: 'structure_with_axalvc', label: 'structure_with_axalvc', ...STATS({ calls: 3 }) }]) }[url.searchParams.get('group')] ?? groupReport([])),
  'GET /api/developer/usage/events': () => response(EVENTS),
  'GET /api/developer/usage/events/11111111-2222-4333-8444-555555555555': () => response({ event: EVENT() }),
};

async function mount(path, over = {}) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const RealDate = globalThis.Date;
  const seen = [];
  const routes = { ...ROUTES, ...over };
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const key = `${(init.method || 'GET').toUpperCase()} ${url.pathname}`;
    seen.push({ key, url });
    if (routes[key]) return routes[key]({ url });
    return response({});
  };
  // The page's "today" is the clock's; pin it so the range is fixed.
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW.getTime()])); } static now() { return NOW.getTime(); } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Host))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const all = (id) => walk(document.body).filter((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { await props(n)[name](arg); }); await settle(); };
  return {
    seen, text: () => textOf(document.body),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), count: (id) => all(id).length, attr: (id, k) => props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick', { preventDefault() {}, stopPropagation() {} }),
    change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; globalThis.Date = RealDate; restore(); },
  };
}

test('APIU1: tiles, Chart 1, the breakdown, limits and alerts, each from its read; never group=model', async () => {
  const v = await mount('/account/builder/usage');
  try {
    assert.match(v.of('builder-trail'), /Builder › API usage/);
    assert.match(v.of('usage-tile-requests'), /Requests12/);
    assert.match(v.of('usage-tile-charged'), /\$6\.42\$0\.38 returned/);
    assert.equal(v.of('usage-chart-summary'), '12 requests in 30 days, 3 failed; $6.42 of AI tokens.');
    assert.ok(v.count('usage-bar-unrecorded') >= 16, 'days before 8 Oct have a dashed hairline, not a bar');
    assert.equal(v.attr('usage-breakdown', 'data-group'), 'key');
    assert.equal(v.of('usage-breakdown-summary'), 'Deploy bot spent the most: $4.10 of $6.42.');
    assert.match(v.of('usage-breakdown-table'), /Assistants \(no key\)42\$2\.32Not recorded/);
    assert.match(v.of('usage-limits-keys'), /Deploy bot axk_k7f3m2q9x4p1_••••.*\$16\.40 of \$20\.00.*Resets on 1 Nov/s);
    assert.match(v.of('usage-limits-keys'), /Nightly sync.*No limit/s);
    assert.doesNotMatch(v.of('usage-limits-keys'), /Old laptop/, 'a revoked key has no limit to show');
    assert.match(v.of('usage-limit-account'), /\$6\.42 of \$50\.00/);
    assert.match(v.of('usage-limits-rate'), /Per key: 60 a minute.*Across every key and assistant: 120 a minute.*0 requests were rate-limited/s);
    assert.match(v.of('usage-alert-account'), /On at 50%, 80%/);
    assert.equal(v.count('usage-alert-key'), 2);
    assert.match(v.of('usage-alerts-fixed'), /Key alerts are always on\./);
    assert.equal(v.of('usage-key-flag'), 'Deploy bot has used 82% of its monthly limit.');
    assert.match(v.of('usage-footer'), /never records what was sent or what came back\. AI runs by model are in Usage › Cost ›/);
    for (const g of ['provider', 'connector', 'tool']) await v.click(`usage-breakdown-${g}`);
    const groups = v.seen.filter((s) => s.key === 'GET /api/developer/usage').map((s) => s.url.searchParams.get('group'));
    assert.ok(groups.includes('tool') && groups.includes('connector'));
    assert.ok(!groups.includes('model'), 'never group=model');
    assert.ok(!v.seen.some((s) => s.key !== 'GET /api/developer/usage' && s.url.search.includes('model')));
    assert.doesNotMatch(v.text(), /secret-model-name|credits/i);
  } finally { await v.close(); }
});

test('the range and the key live in the address, and compare reads the previous period', async () => {
  const v = await mount('/account/builder/usage?range=7d&key=k1&compare=1');
  try {
    const day = v.seen.filter((s) => s.key === 'GET /api/developer/usage' && s.url.searchParams.get('group') === 'day').map((s) => `${s.url.searchParams.get('from')}..${s.url.searchParams.get('to')}:${s.url.searchParams.get('key')}`);
    assert.ok(day.includes('2026-10-15..2026-10-21:k1'), day.join(' '));
    assert.ok(day.includes('2026-10-08..2026-10-14:k1'), 'the previous seven days');
    assert.match(v.of('usage-tile-prev-requests'), /Previous · 12/);
  } finally { await v.close(); }
});

test('APIU12: a key that is not the member\'s resets to All keys, and says so', async () => {
  const v = await mount('/account/builder/usage?key=theirs', {
    'GET /api/developer/usage': ({ url }) => (url.searchParams.get('key') === 'theirs' ? fail(404, 'unknown_key')() : response(url.searchParams.get('group') === 'day' ? DAY_REPORT : KEY_REPORT)),
  });
  try {
    assert.equal(v.of('usage-key-refused').replace('Dismiss', ''), 'That key is not on your account. The filter is back to All keys.');
    assert.equal(v.attr('usage-key-filter', 'value'), '');
    assert.match(v.of('usage-tile-requests'), /12/);
  } finally { await v.close(); }
});

test('APIU11: a failed summary says so and leaves the breakdown and limits; a failed breakdown leaves the rest', async () => {
  const v = await mount('/account/builder/usage', {
    'GET /api/developer/usage': ({ url }) => (url.searchParams.get('group') === 'day' ? fail(503, 'usage_unreadable')() : response(KEY_REPORT)),
  });
  try {
    assert.match(v.of('usage-summary-unreadable'), /Usage could not be read\. That is not the same as none\./);
    assert.ok(!v.has('usage-tile-requests'), 'no tile claims a figure');
    assert.match(v.of('usage-breakdown-summary'), /Deploy bot/);
    assert.ok(v.has('usage-limits-keys'));
  } finally { await v.close(); }
  const w = await mount('/account/builder/usage', {
    'GET /api/developer/usage': ({ url }) => (url.searchParams.get('group') === 'day' ? response(DAY_REPORT) : fail(503, 'usage_unreadable')()),
  });
  try {
    assert.match(w.of('usage-breakdown-unreadable'), /This breakdown could not be read\. The other tabs still work\./);
    assert.match(w.of('usage-tile-requests'), /12/);
  } finally { await w.close(); }
});

test('APIU9: no caller at all, and callers with no request in the range', async () => {
  const empty = { ...DAY_REPORT, recorded: false, totals: STATS(), groups: [] };
  const v = await mount('/account/builder/usage', {
    'GET /api/developer/usage': () => response(empty), 'GET /api/developer/usage/keys': () => response({ month: '2026-10', keys: [] }),
    'GET /api/connectors/assistants': () => response({ grants: [] }),
  });
  try {
    assert.match(v.of('usage-no-caller'), /No requests yet\.Requests appear here once an API key or an assistant calls StudioOS\.Create an API key ›Connect an assistant ›/);
  } finally { await v.close(); }
  const w = await mount('/account/builder/usage', { 'GET /api/developer/usage': () => response({ ...empty, recorded: true }) });
  try {
    assert.match(w.of('usage-none-in-range'), /No requests between 22 Sep and 21 Oct\./);
    assert.match(w.of('usage-tile-requests'), /Requests0/, 'zero requests is a measured zero');
  } finally { await w.close(); }
});

test('APIU3: the log with caller, surface, tool, company, outcome, time and AI tokens; a failed row says why', async () => {
  const v = await mount('/account/builder/activity');
  try {
    assert.match(v.of('builder-trail'), /Builder › Activity/);
    assert.equal(v.count('activity-row'), 3);
    const t = v.of('activity-table');
    assert.match(t, /21 Oct · 14:32:07Deploy botaxk_k7f3m2q9x4p1_••••MCPstructure_with_axalvcNorthwind LabsOK420 ms\$0\.004/);
    assert.match(t, /Recognised as Assistant A.*get_validate_contextThe key lacks the permission for this tool\..*Refused420 msNot recorded/s);
    assert.match(t, /Unrecognised assistantIt called itself “Tool X”.*search_docs.*Free/s);
    assert.doesNotMatch(v.text(), /secret-model-name/);
    assert.equal(v.count('activity-card'), 3, 'APIU8: the same rows as cards on a phone');
    assert.ok(v.has('activity-day-chart'), 'DEV5’s Calls by day stays');
    assert.match(v.of('activity-connection-events'), /#2479/);
    await v.click('activity-older');
    const last = v.seen.filter((s) => s.key === 'GET /api/developer/usage/events').at(-1);
    assert.equal(last.url.searchParams.get('cursor'), 'c2');
  } finally { await v.close(); }
});

test('Activity\'s filters reach the read: caller (key or assistant), surface, outcome, tool, company', async () => {
  const v = await mount('/account/builder/activity?caller=grant:g1&surface=api&tool=search_docs&company=7');
  try {
    const q = v.seen.filter((s) => s.key === 'GET /api/developer/usage/events').at(-1).url.searchParams;
    assert.deepEqual([q.get('grant'), q.get('key'), q.get('surface'), q.get('operation'), q.get('company')], ['g1', null, 'api', 'search_docs', '7']);
  } finally { await v.close(); }
});

test('APIU6: Failed opens the log filtered to failures, with outcomes and the top reasons', async () => {
  const v = await mount('/account/builder/activity?outcome=failed');
  try {
    assert.equal(v.attr('activity', 'data-failures'), '1');
    assert.match(v.of('activity-failures'), /3 failures in this range/);
    assert.deepEqual(v.count('activity-failure-outcome'), 4);
    assert.equal(v.count('activity-reason'), 3);
    assert.equal(v.seen.filter((s) => s.key === 'GET /api/developer/usage/events').at(-1).url.searchParams.get('outcome'), 'failed');
  } finally { await v.close(); }
});

test('APIU11: a failed log says so and leaves the chart', async () => {
  const v = await mount('/account/builder/activity', { 'GET /api/developer/usage/events': fail(503, 'usage_unreadable') });
  try {
    assert.match(v.of('activity-log-unreadable'), /Requests could not be read\. The chart above was read separately and stays\./);
    assert.ok(v.has('activity-day-chart'));
    assert.ok(!v.has('activity-empty'), 'a failed read is never "no requests"');
  } finally { await v.close(); }
});

test('APIU4: the drawer reads one request; no argument, result, model or secret; APIU12: another member\'s reads as not yours', async () => {
  const v = await mount('/account/builder/activity/11111111-2222-4333-8444-555555555555');
  try {
    assert.ok(v.has('activity-log'), 'the log stays under the drawer');
    assert.match(v.of('activity-drawer-who'), /CallerDeploy botaxk_k7f3m2q9x4p1_••••SurfaceMCPCompanyNorthwind Labs/);
    assert.match(v.of('activity-drawer-when'), /Started21 Oct · 14:32:07 UTCTook420 ms/);
    assert.match(v.of('activity-drawer-tokens'), /Held\$0\.01Charged\$0\.004Returned\$0\.006/);
    assert.match(v.of('activity-drawer-ids'), /Execution11111111-2222-4333-8444-555555555555/);
    assert.match(v.text(), /Arguments and results are never stored, so they cannot be shown\./);
    assert.ok(!v.has('activity-drawer-why'), 'an OK request has no failure section');
    assert.doesNotMatch(v.of('activity-drawer'), /secret-model-name|axk_[a-z0-9]{12}_[a-z0-9]/i);
    await v.click('activity-drawer-back');
    assert.ok(!v.has('activity-drawer'), 'back closes it');
  } finally { await v.close(); }
  const w = await mount('/account/builder/activity/aaaaaaaa-0000-4000-8000-000000000000', {
    'GET /api/developer/usage/events/aaaaaaaa-0000-4000-8000-000000000000': fail(404, 'unknown_request'),
  });
  try {
    assert.match(w.of('activity-drawer-not-yours'), /This request is not on your account\.Nothing here says whether it exists\./);
  } finally { await w.close(); }
});

test('the words: no "credits", no model named, no advice about the AI, and no sample placeholders', () => {
  for (const f of ['apiUsageModel.js', 'ApiUsagePage.jsx', 'ActivityPage.jsx', 'usageParts.jsx']) {
    const src = readFileSync(new URL(`../src/pages/account/builder/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bcredits?\b/i, f);
    assert.doesNotMatch(src, /\b(gpt|claude|llama|gemini|mistral)\b/i, f);
    assert.doesNotMatch(src, /\b(advice|advisor|recommendation|fiduciary)\b/i, f);
    assert.doesNotMatch(src, /\[(Deploy bot|Northwind|Assistant A|\$\d)/, `${f}: no canvas sample data`);
    assert.doesNotMatch(src, /e\.model|\.model\b(?!\s*[:=])/, `${f}: a request's model is never drawn`);
  }
});
