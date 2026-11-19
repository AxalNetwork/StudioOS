/** D4864 (#4864, GR-12, GR-15): Grow's figures and domain tiles in the platform's states, with source, freshness and recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GrowOverviewView } from '../src/pages/cycles/GrowOverview.jsx';
import GrowSnapshot from '../src/pages/cycles/GrowSnapshot.jsx';
import { GROW_AREAS } from '../src/pages/cycles/growOverviewModel.js';
import { growDomain, growKpi, lastGoodFor, rememberRead, sourceLine, sourceName, viewerKey } from '../src/pages/cycles/growKpiModel.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const fig = (o) => ({ key: 'mrr', label: 'MRR', unit: 'usd', value: null, delta_30d: null, spark: [], state: 'not_recorded', source: null, as_of: null, reason: null, reason_code: null, freshness: null, ...o });
const measured = (o = {}) => fig({ value: 1840, delta_30d: 125, state: 'too_little', source: 'stripe', as_of: '2026-11-14', freshness: 'current', ...o });
const area = (key) => GROW_AREAS.find((a) => a.key === key);
const q = '?project_id=7';
const draw = (el) => renderToStaticMarkup(h(MemoryRouter, {}, el));

test('a measured zero is a Value with its source, never Not recorded', () => {
  const k = growKpi(measured({ value: 0, delta_30d: 0 }), { search: q, now: NOW });
  assert.equal(k.state, 'value');
  assert.equal(k.value, '$0');
  assert.equal(k.zero, true);
  assert.deepEqual(k.actions, []);
  assert.equal(sourceLine(k), 'Source: Stripe · as of 2026-11-14');
  assert.match(k.sr, /^MRR, \$0, measured, no change in 30 days, from Stripe, as of 2026-11-14\.$/);
  const html = draw(h(GrowSnapshot, { figures: [measured({ value: 0 })], search: q, now: NOW }));
  assert.match(html, /data-kpi-state="value"/);
  assert.match(html, /Measured zero, not missing/);
  assert.doesNotMatch(html, /Not recorded|data-platform-state="not_recorded"/);
});

test('nothing recorded is Not recorded with its reason and a recovery action, never 0', () => {
  const none = growKpi(fig({ reason_code: 'no_record', reason: 'Not recorded: no metric snapshot records MRR' }), { search: q });
  assert.equal(none.state, 'not_recorded');
  assert.equal(none.reason, 'No metric snapshot records MRR.');
  assert.deepEqual(none.actions.map((a) => [a.label, a.href]), [['Enter manually', '/grow/revenue-and-traction/new?project_id=7&kpi=mrr']]);
  assert.equal(sourceLine(none), 'Source: none recorded');

  const off = growKpi(fig({ key: 'customers', label: 'Customers', unit: 'count', reason_code: 'not_connected', reason: 'Not recorded: Stripe is not connected and no Customers figure was entered by hand' }), { search: q });
  assert.equal(off.state, 'not_recorded', 'Not connected is Not recorded with its reason (Platform States Q2 = A)');
  assert.deepEqual(off.actions.map((a) => [a.label, a.href]), [['Connect Stripe', '/account/connectors/stripe'], ['Enter manually', '/grow/revenue-and-traction/new?project_id=7&kpi=paying_accounts']]);
  assert.equal(sourceLine(off), 'Source: none connected');

  const team = growKpi(fig({ key: 'headcount', label: 'Headcount', unit: 'count', reason_code: 'no_record', reason: 'Not recorded: this venture has no company roster yet' }), { search: q });
  assert.deepEqual(team.actions.map((a) => a.href), ['/build/team?project_id=7']);
  assert.deepEqual(growKpi(fig({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', reason_code: 'no_record' }), { search: q }).actions, [], 'NRR needs history, not an entry');
  assert.deepEqual(growKpi(fig({ reason_code: 'not_connected' }), { search: q, readOnly: true }).actions, [], 'a reader gets no operating action');

  const html = draw(h(GrowSnapshot, { figures: [fig({ reason_code: 'not_connected', reason: 'Not recorded: Stripe is not connected' })], search: q }));
  assert.match(html, /data-platform-state="not_recorded"/);
  assert.match(html, /Stripe is not connected\./);
  assert.match(html, /data-testid="grow-kpi-mrr-connect"[^>]*>Connect Stripe</);
  assert.doesNotMatch(html, />\$?0</);
});

test('a failed figure is Unavailable with Retry, never Not recorded; it can say what was last read', () => {
  for (const f of [fig({ reason_code: 'unavailable', state: 'unreadable' }), fig({ state: 'unreadable' })]) {
    const k = growKpi(f, { search: q });
    assert.equal(k.state, 'unavailable');
    assert.deepEqual(k.actions, [], 'nothing is known to be missing, so no setup action');
  }
  const k = growKpi(fig({ reason_code: 'unavailable', state: 'unreadable' }), { lastGood: measured() });
  assert.equal(k.reason, 'Last read: $1,840 as of 2026-11-14.');
  const html = draw(h(GrowSnapshot, { figures: [fig({ reason_code: 'unavailable', state: 'unreadable' })], onRetry() {} }));
  assert.match(html, /data-platform-state="unavailable"/);
  assert.match(html, /MRR could not be read\. This is not a claim that nothing is recorded\./);
  assert.match(html, /data-state-retry=""/);
  assert.doesNotMatch(html, /Not recorded|Connect Stripe|Enter manually/);
});

test('a stale figure keeps its value and age and shows no change across periods', () => {
  const k = growKpi(measured({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', value: 104, delta_30d: 2, as_of: '2026-09-30', source: 'Revenue ledger · stripe', freshness: 'stale' }), { now: NOW });
  assert.equal(k.state, 'value');
  assert.equal(k.change, null);
  assert.equal(k.stale.age, '49 days old');
  assert.equal(k.source, 'Revenue ledger · Stripe');
  const current = growKpi(measured(), { now: NOW });
  assert.equal(current.stale, null);
  assert.match(current.change, /▲/);
  const html = draw(h(GrowSnapshot, { figures: [measured({ freshness: 'stale', as_of: '2026-09-30' })], now: NOW }));
  assert.match(html, /Stale · 49 days old/);
  assert.match(html, /No change shown: the figure is from an earlier period/);
  assert.doesNotMatch(html, /▲/);
});

test('domain tiles: zero is None with one setup action, a failed read is Unavailable with none', () => {
  const zero = { state: 'recorded', value: 0 };
  const attention = { focus: { state: 'not_recorded', value: null }, signals: { customers: zero, channels: { state: 'unreadable', value: null } } };
  const c = growDomain(area('customers'), { attention, search: q });
  assert.deepEqual([c.state, c.action.label, c.action.href], ['none', 'Add customer', '/grow/customers?project_id=7']);
  const d = growDomain(area('distribution'), { attention, search: q });
  assert.deepEqual([d.state, d.action], ['unavailable', null]);
  assert.equal(growDomain(area('focus'), { attention, search: q }).action.href, '/grow/focus?project_id=7');
  const cards = [
    { slug: 'partner-network', name: 'Partner network', state: 'empty', reason: 'No partners yet. Partners by stage appear here.', next: { text: 'Add partner', href: '/grow/partner-network?project=7&add=1' } },
    { slug: 'market-expansion', name: 'Market expansion', state: 'empty', reason: 'No markets yet.', next: { text: 'Add market', href: 'https://elsewhere.example/?project=7' } },
    { slug: 'team-expansion', name: 'Team expansion', state: 'unreadable', reason: 'Unreadable' },
  ];
  const p = growDomain(area('partnerships'), { cards, search: q });
  assert.deepEqual([p.state, p.summary, p.action.label, p.action.href], ['none', 'No partners yet.', 'Add partner', '/grow/partner-network?project_id=7&add=1']);
  assert.equal(growDomain(area('markets'), { cards, search: q }).action, null, 'an off-site next is never a link');
  assert.equal(growDomain(area('markets'), { cards, search: q }).summary, 'No markets yet.', 'one sentence is kept whole');
  assert.equal(growDomain(area('talent'), { cards, search: q }).state, 'unavailable');
  assert.equal(growDomain(area('customers'), { attention, search: q, readOnly: true }).action, null);
});

test('the last good read is kept only for the same venture and viewer, and only a ready read replaces it', () => {
  const a = viewerKey(7, q, { id: 1 });
  const b = viewerKey(8, '?project_id=8', { id: 1 });
  const other = viewerKey(7, q, { id: 2 });
  const data = { figures: [measured(), fig({ key: 'nrr', reason_code: 'no_record' })] };
  let store = rememberRead(null, a, { status: 'ready', raw: { attention: {} }, data, at: NOW });
  assert.equal(lastGoodFor(store, a).read.at, NOW);
  assert.deepEqual(Object.keys(lastGoodFor(store, a).figures), ['mrr'], 'only a recorded value is a last good value');
  store = rememberRead(store, a, { status: 'unreadable', raw: null, data: null, at: NOW + 1 });
  assert.equal(lastGoodFor(store, a).read.at, NOW, 'a failed read never replaces the last good one');
  assert.equal(lastGoodFor(store, b).read, null, 'another venture sees nothing kept');
  assert.equal(lastGoodFor(store, other).read, null, 'another viewer sees nothing kept');
  assert.equal(rememberRead(store, b, { status: 'unreadable', at: NOW }).read, null, 'switching venture starts empty');
});

test('a failed refresh shows the kept figures as Stale with Try again, and never the setup or attention of an old read', () => {
  const raw = { attention: { state: 'ready', writable: true, period: '2026-11', focus: { state: 'not_recorded', value: null }, measurement: { state: 'not_recorded', value: null }, items: [{ key: 'set_focus', label: 'Choose your primary growth metric', why: 'x', href: '/grow/focus?project_id=7', actionLabel: 'Set focus metric' }], signals: {} } };
  const data = { figures: [measured()], cards: [] };
  const prior = { read: { raw, data, at: NOW - 2 * 3600000 }, figures: {} };
  const html = draw(h(GrowOverviewView, { raw: null, data: null, status: 'unreadable', search: q, onRetry() {}, prior, now: NOW }));
  assert.match(html, /data-testid="grow-refresh-failed"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Grow could not refresh\./);
  assert.match(html, /Stale · 2 hours old/);
  assert.match(html, /data-kpi-state="kept"/);
  assert.match(html, /MRR, \$1,840, from Stripe, as of 2026-11-14, stale, 2 hours old\./, 'a kept figure is read with no change and its age');
  assert.match(html, /\$1,840/);
  assert.match(html, /data-testid="grow-refresh-retry"/);
  assert.doesNotMatch(html, /grow-overview-error|grow-attention-set_focus|grow-setup|data-testid="cycle-action"/);
  // Without a kept read the failure is the whole-read Unavailable, as before.
  const bare = draw(h(GrowOverviewView, { status: 'unreadable', search: q, onRetry() {} }));
  assert.match(bare, /data-testid="grow-overview-error"/);
  assert.doesNotMatch(bare, /grow-refresh-failed|\$1,840/);
});

test('loading draws skeletons in the snapshot shape; a refused read is Refused, not empty', () => {
  const loading = draw(h(GrowOverviewView, { status: 'loading', search: q }));
  assert.match(loading, /aria-label="Loading Grow overview"/);
  assert.equal((loading.match(/data-platform-state="loading"/g) || []).length, 4);
  assert.doesNotMatch(loading, /Not recorded|\$0/);
  const refused = draw(h(GrowOverviewView, { status: 'refused', search: q, message: 'Only the venture’s team can open this.' }));
  assert.match(refused, /data-platform-state="refused"/);
  assert.match(refused, /Only the venture’s team can open this\./);
  assert.doesNotMatch(refused, /Not recorded|No customer/);
});

test('sparse ventures fold the snapshot on a phone; every live state is announced politely', () => {
  const raw = { attention: { state: 'ready', writable: true, period: '2026-11', focus: { state: 'not_recorded', value: null }, measurement: { state: 'not_recorded', value: null }, items: [], signals: {} } };
  const data = { figures: [fig({ reason_code: 'not_connected' }), measured({ key: 'customers', label: 'Customers', unit: 'count', value: 0 }), fig({ key: 'nrr', reason_code: 'unavailable', state: 'unreadable' })], cards: [] };
  const html = draw(h(GrowOverviewView, { raw, data, status: 'ready', search: q, now: NOW }));
  assert.match(html, /data-testid="grow-snapshot-phone"/);
  assert.match(html, /3 figures · 1 recorded · 1 unavailable/);
  assert.match(html, /role="status" aria-live="polite">Growth snapshot: 3 figures · 1 recorded · 1 unavailable\.</);
  assert.equal(sourceName('manual'), 'Entered by hand');
});

test('the Worker sends the typed reason codes this page reads, and the overview keeps using the shared states', () => {
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/growCycle.ts', import.meta.url), 'utf8');
  for (const code of ['no_record', 'not_connected', 'unavailable']) assert.match(worker, new RegExp(`'${code}'`));
  const page = readFileSync(new URL('../src/pages/cycles/GrowSnapshot.jsx', import.meta.url), 'utf8');
  assert.match(page, /from '\.\.\/\.\.\/ui'/);
  assert.doesNotMatch(page, /function (DataState|StateChip|Unrecorded|Unreadable)\b/, 'no local copy of the shared states');
});
