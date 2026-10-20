/**
 * D789: actual pure rules and server-rendered cards. Each contract also runs
 * against a changed source module, so a passing assertion has a killed mutant.
 * No repository file is changed: Oxc compiles a data-URL copy of the module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { transformWithOxc } from 'vite';
import * as model from '../src/pages/account/costModel.js';
import * as colours from '../src/lib/modelColours.js';
import * as overview from '../src/pages/account/UsageOverview.jsx';
import * as charts from '../src/pages/account/UsageCharts.jsx';
import * as cost from '../src/pages/account/CostPage.jsx';
import { usagePageFor, USAGE_PAGES } from '../src/pages/account/limitsModel.js';
import { accountPathFor } from '../src/pages/account/accountPhone.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const OTHER = '@cf/openai/whisper-large-v3-turbo';
const ready = (data) => ({ status: 'ready', data, reload() {} });
const failed = { status: 'unreadable', reload() {} };
const sample = () => ({
  range: { from: '2026-10-01', to: '2026-10-03', name: 'mtd' }, group: 'model',
  totals: { runs: 3, input_tokens: 120, output_tokens: 30, charged_microusd: 700000, cost_usd: .5, not_recorded: 1,
    output_not_recorded: 1, by_kind: { tokens: { cost_usd: .3 }, audio_speech: { cost_usd: .2 }, image: { cost_usd: 0 }, other: { cost_usd: 0 } } },
  models: [
    { model: MODEL, name: 'Llama', runs: 2, input_tokens: 120, output_tokens: 30, units: {}, cost_usd: .3, charged_microusd: 400000, not_recorded: 1 },
    { model: OTHER, name: 'Whisper', runs: 1, input_tokens: 0, output_tokens: 0, units: { audio_minutes: 4 }, cost_usd: .2, charged_microusd: 300000, not_recorded: 0 },
  ],
  days: [
    { day: '2026-10-01', by_model: [{ model: MODEL, cost_usd: .1, input_tokens: 40, output_tokens: 10 }, { model: OTHER, cost_usd: .2, input_tokens: 0, output_tokens: 0 }] },
    { day: '2026-10-02', by_model: [] },
    { day: '2026-10-03', by_model: [{ model: MODEL, cost_usd: .2, input_tokens: 80, output_tokens: 20 }] },
  ],
  groups: [{ key: 'draft', page: 'validate', label: 'Draft', runs: 3, input_tokens: 120, output_tokens: 30, charged_microusd: 700000 }],
  truncated: false,
});
const me = { balance_microusd: 2500000, plan: { monthly_microusd: 20000000 }, month_spend_microusd: 5000000 };
const limit = { charged_microusd: 5000000, limit_microusd: 20000000, resets_on: '2026-11-01', pack_orders: { today: 1, per_day: 5, window_hours: 24 } };
const props = () => ({ me: ready(me), limit: ready(limit), overview: ready({ payment_methods: [] }), autoReload: ready({ enabled: true }), cost: ready(sample()), invoices: { status: 'not_recorded' } });
const html = (element) => renderToStaticMarkup(h(MemoryRouter, {}, element));
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Resolve relative modules in the in-memory copy just as the real loader does. */
function moduleUrl(specifier, origin) {
  if (!specifier.startsWith('.')) return import.meta.resolve(specifier);
  const url = new URL(specifier, origin);
  if (/\.(jsx?|tsx?|mjs)$/.test(url.pathname)) return url.href;
  for (const suffix of ['.js', '.jsx', '/index.js']) {
    const candidate = new URL(url.href + suffix);
    try { readFileSync(candidate, 'utf8'); return candidate.href; }
    catch (e) { if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code)) throw e; }
  }
  throw new Error('Module not resolved: ' + specifier);
}
async function mutant(path, before, after) {
  const url = new URL(path, import.meta.url);
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes(before), 'mutation target exists: ' + before);
  const { code } = await transformWithOxc(source.replace(before, after), fileURLToPath(url), { jsx: { runtime: 'automatic' } });
  const linked = code.replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => 'from ' + JSON.stringify(moduleUrl(specifier, url)));
  return import('data:text/javascript;base64,' + Buffer.from(linked).toString('base64'));
}
async function killed(path, before, after, check) {
  const normal = await import(new URL(path, import.meta.url).href);
  check(normal);
  const changed = await mutant(path, before, after);
  assert.throws(() => check(changed), /./, 'the changed behaviour is detected');
}

test('every overview card links to its own page; phone cards stack', async () => {
  const check = (m) => {
    const out = html(h(m.UsageOverviewView, props()));
    for (const [id, path] of Object.entries({ spend: '/account/usage/cost', balance: '/account/billing', daily: '/account/usage/cost', tokens: '/account/usage/cost', limits: '/account/usage/limits', invoices: '/account/billing' })) {
      const section = out.slice(out.indexOf('data-testid="overview-' + id + '"'));
      assert.ok(section.slice(0, section.indexOf('</h2>') + 500).includes('href="' + path + '"'), id + ' links to its page');
    }
    assert.match(out, /grid min-w-0 gap-3 md:grid-cols-2/);
    assert.doesNotMatch(out, /class="(?:[^"]*\s)?grid-cols-2(?:\s|")/);
  };
  check(overview);
  await killed('../src/pages/account/UsageOverview.jsx', "spend: '/account/usage/cost'", "spend: '/account/billing'", check);
  await killed('../src/pages/account/UsageOverview.jsx', 'grid min-w-0 gap-3 md:grid-cols-2', 'grid min-w-0 gap-3 grid-cols-2', check);
});

test('daily segments equal by_model and keep empty days; recorded tokens stay in their direction', async () => {
  const check = (m) => {
    const series = m.dailySeries(sample());
    assert.deepEqual(series.days.map((d) => d.segments.map((s) => [s.model, s.cost])), sample().days.map((d) => d.by_model.map((r) => [r.model, r.cost_usd])));
    assert.equal(series.days[0].input, 40);
    assert.equal(series.days[0].output, 10);
    assert.equal(series.days[1].cost, 0);
    assert.equal(series.days[0].segments[0].colour, colours.modelColour(MODEL));
    assert.deepEqual(m.dailySeries(sample(), OTHER).days[0].segments.map((s) => s.model), [OTHER]);
  };
  check(model);
  await killed('../src/pages/account/costModel.js', 'cost: money(m.cost_usd) ? m.cost_usd : null', 'cost: money(m.cost_usd) ? m.cost_usd * 2 : null', check);
  await killed('../src/pages/account/costModel.js', 'input: count(m.input_tokens) ? m.input_tokens : null', 'input: count(m.input_tokens) ? m.output_tokens : null', check);
  await killed('../src/pages/account/costModel.js', "!model || m.model === model", 'true', check);
});

test('a missing cost stays missing; zero is a real zero', async () => {
  const check = (m) => {
    const data = sample(); data.days[0].by_model[0].cost_usd = null;
    assert.equal(m.dailySeries(data).days[0].segments[0].cost, null);
    assert.equal(m.dailySeries(data).days[0].cost, null);
    assert.equal(m.dailySeries(data).days[1].cost, 0);
    assert.equal(m.dailySeries(null), null);
  };
  check(model);
  await killed('../src/pages/account/costModel.js', 'cost: money(m.cost_usd) ? m.cost_usd : null', 'cost: money(m.cost_usd) ? m.cost_usd : 0', check);
});

test('model colours are stable across ranges, filters and charts; canvas IDs keep their colours', async () => {
  const check = (m) => {
    assert.equal(m.modelColour(MODEL), '#7c3aed');
    assert.equal(m.modelColour(OTHER), '#475569');
    const unknown = m.modelColour('@cf/future/model');
    assert.equal(unknown, m.modelColour('@cf/future/model'));
    assert.ok(m.MODEL_PALETTE.includes(unknown));
  };
  check(colours);
  await killed('../src/lib/modelColours.js', 'return MODEL_COLOURS[key]', "return '#000000'", check);
  const data = sample();
  const before = model.dailySeries(data).legend.find((r) => r.model === OTHER).colour;
  data.models.reverse();
  assert.equal(model.dailySeries(data, OTHER).legend[0].colour, before);
  assert.equal(model.costTableRows(data).find((r) => r.key === OTHER).colour, before);
});

test('cost rows keep units, partial charges and missing grouped fields', async () => {
  const check = (m) => {
    const rows = m.costTableRows(sample());
    assert.equal(rows[0].charged, '$0.40');
    assert.equal(rows[0].partial, 1);
    assert.equal(rows[1].units, '4 min');
    assert.equal(m.totalUnits(sample()), '4 min');
    assert.equal(m.costTableRows(sample(), 'page')[0].cost, null);
    assert.equal(m.costTableRows(sample(), 'page')[0].charged, '$0.70');
    const data = sample(); data.models[0].charged_microusd = null;
    assert.equal(m.costTableRows(data)[0].charged, null);
    assert.deepEqual(m.costTotals(data).map((t) => t.value), ['$0.70', '$0.30', '$0.20', '$0.00']);
  };
  check(model);
  await killed('../src/pages/account/costModel.js', 'charged: microUsd(r.charged_microusd)', 'charged: usd(r.charged_microusd)', check);
  await killed('../src/pages/account/costModel.js', "audio_minutes: 'min'", "audio_minutes: 'images'", check);
  await killed('../src/pages/account/costModel.js', 'units: null, cost: null', "units: null, cost: '$0.00'", check);
  const out = html(h(cost.CostTable, { data: sample(), group: 'page' }));
  assert.match(out, /Not recorded/);
  assert.match(out, /Page and option groups return charges and token counts/);
  assert.match(out, /streamed replies recorded no output count/);
  assert.match(out, /grid-cols-2/);
  assert.match(out, /lg:grid-cols/);
});

test('invoice rows are newest three, retain PDFs, reject executable URLs and show partial Stripe failure', async () => {
  const data = { items: [1, 4, 2, 3].map((n) => ({ kind: 'stripe', id: n, date: '2026-10-0' + n, description: 'Plan invoice', amount_cents: 2500, currency: 'USD', status: 'paid', pdf_url: 'https://example.com/invoice-' + n + '.pdf' })), degraded: ['stripe'] };
  const check = (m) => {
    assert.deepEqual(m.recentInvoices(data).map((r) => r.id), [4, 3, 2]);
    assert.equal(m.invoiceHref('javascript:alert(1)'), null);
    assert.deepEqual(m.recentInvoices({ items: [{ id: 'later', date: '2026-10-04 23:00:00' }, { id: 'earlier', date: '2026-10-04T12:00:00Z' }] }).map((r) => r.id), ['later', 'earlier']);
    assert.equal(m.invoiceHref('//example.com/a.pdf'), null);
    assert.equal(m.invoiceHref('/api/orders/ORDER-1/invoice'), '/api/orders/ORDER-1/invoice');
    assert.equal(m.invoiceHref('https://example.com/a.pdf'), 'https://example.com/a.pdf');
  };
  check(model);
  await killed('../src/pages/account/costModel.js', 'invoiceTime(b.date) - invoiceTime(a.date)', 'invoiceTime(a.date) - invoiceTime(b.date)', check);
  await killed('../src/pages/account/costModel.js', "url.protocol === 'https:'", "(url.protocol === 'https:' || url.protocol === 'javascript:')", check);
  const out = html(h(overview.RecentInvoices, { invoices: ready(data) }));
  assert.match(out, /Plan invoices could not be read/);
  assert.match(out, /invoice-4.pdf/);
  assert.doesNotMatch(out, /invoice-1.pdf/);
  assert.match(out, /\$25\.00/);
  assert.match(html(h(overview.RecentInvoices, { invoices: ready({ items: [] }) })), /No invoices yet/);
});

test('missing invoice dependency is explicit, while failed reads never become an empty list', async () => {
  const check = (m) => {
    assert.match(html(h(m.RecentInvoices, { invoices: { status: 'not_recorded' } })), /Not recorded: The combined invoice list is not available yet/);
    assert.match(html(h(m.RecentInvoices, { invoices: failed })), /Recent invoices could not be read/);
    assert.doesNotMatch(html(h(m.RecentInvoices, { invoices: failed })), /No invoices yet/);
  };
  check(overview);
  await killed('../src/pages/account/UsageOverview.jsx', 'Not recorded: {INVOICES_PENDING}', 'No invoices yet.', check);
});

test('balance pills depend on their own successful reads and a missing limit is named', async () => {
  const check = (m) => {
    const p = props();
    assert.match(html(h(m.BalanceOverview, p)), /Auto-reload on/);
    assert.match(html(h(m.BalanceOverview, p)), /No payment method/);
    assert.doesNotMatch(html(h(m.BalanceOverview, { ...p, overview: ready({ payment_methods: [{ last4: '0000' }] }) })), /No payment method/);
    assert.doesNotMatch(html(h(m.BalanceOverview, { ...p, overview: failed })), /No payment method/);
    assert.match(html(h(m.SpendOverview, { limit: ready({ ...limit, limit_microusd: null }) })), /No limit set/);
    assert.match(html(h(m.SpendOverview, { limit: failed })), /monthly spend could not be read/);
    assert.match(html(h(m.LimitsOverview, p)), /Token-pack orders today/);
    assert.match(html(h(m.LimitsOverview, { ...p, limit: ready({ ...limit, pack_orders: null, pack_orders_reason: 'pack_orders_unreadable' }) })), /Token-pack orders could not be read/);
  };
  check(overview);
  await killed('../src/pages/account/UsageOverview.jsx', 'methods.length === 0', 'methods.length >= 0', check);
});

test('empty, loading, unreadable and truncated cost remain distinct', async () => {
  const check = (m) => {
    const empty = { ...sample(), totals: { ...sample().totals, runs: 0 }, days: [], models: [] };
    const emptyOut = html(h(m.CostContents, { cost: ready(empty), group: 'model', model: '' }));
    assert.match(emptyOut, /No AI runs in this range/);
    assert.match(emptyOut, /Change the range/);
    const error = html(h(m.CostContents, { cost: failed, group: 'model', model: '' }));
    assert.match(error, /Cost could not be read/);
    assert.doesNotMatch(error, /No AI runs/);
    assert.match(html(h(m.CostContents, { cost: ready({ ...sample(), truncated: true }), group: 'model', model: '' })), /newest 10,000 runs/);
  };
  check(cost);
  await killed('../src/pages/account/CostPage.jsx', 'read.truncated &&', 'false &&', check);
  assert.match(html(h(overview.UsageCardState, { read: { status: 'loading' }, what: 'Cost' })), /account-loading/);
  const empty = { ...sample(), totals: { ...sample().totals, runs: 0 }, days: [], models: [] };
  assert.match(html(h(overview.UsageOverviewView, { ...props(), cost: ready(empty) })), /Open Studio/);
});

test('CSV uses the authenticated client with range and group; Cost retains all detailed cards', async () => {
  const called = [];
  const fake = { costCsv: (value) => { called.push(value); return 'csv'; } };
  assert.equal(await cost.downloadCostCsv(fake, 'prev_month', 'option'), 'csv');
  assert.deepEqual(called, [{ range: 'prev_month', group: 'option' }]);
  const changed = await mutant('../src/pages/account/CostPage.jsx', 'client.costCsv({ range, group })', "client.costCsv({ range: 'mtd', group })");
  called.length = 0;
  await changed.downloadCostCsv(fake, 'prev_month', 'option');
  assert.notDeepEqual(called, [{ range: 'prev_month', group: 'option' }]);
  const out = html(h(cost.default, { role: 'founder' }));
  assert.match(out, /Download CSV · all models/);
  for (const id of ['allowance', 'top-ups', 'days', 'where', 'models', 'rates', 'last-run', 'storage']) {
    assert.ok(out.includes('usage-card-' + id), id + ' preserved');
  }
});

test('the canonical address and navigation offer Overview, Cost, Limits without losing the legacy anchors', () => {
  assert.deepEqual(USAGE_PAGES.map((p) => p.id), ['overview', 'cost', 'limits']);
  assert.equal(usagePageFor('/account/usage/cost'), 'cost');
  assert.equal(usagePageFor('/settings/usage/cost'), 'cost');
  assert.equal(accountPathFor({ section: 'usage', usagePage: 'cost', phone: true }), '/account/usage/cost');
  assert.equal(usagePageFor('/account/usage/unknown'), 'overview');
  const settings = read('../src/pages/SettingsPage.jsx');
  assert.match(settings, /usagePage === 'cost' \? <CostPage role=\{role\} \/>/);
  assert.match(settings, /import UsageSection from '.\/account\/UsageOverview'/);
  const source = read('../src/pages/account/UsageOverview.jsx');
  assert.match(source, /navigate\(`\/account\/usage\/cost\$\{hash\}`, \{ replace: true \}\)/);
});

test('stacked chart renders every model/day cost and token lines label the recorded values', async () => {
  const check = (m) => {
    const out = html(h(m.DailyCostChart, { data: sample() }));
    assert.equal((out.match(/data-testid="daily-cost-segment"/g) || []).length, 3);
    assert.match(out, /data-cost="0.1"/);
    assert.match(out, /#7c3aed/);
    assert.match(out, /hover, focus or tap a day/);
    assert.match(html(h(m.TokenUsageChart, { data: sample() })), /Input: <strong>80/);
    assert.match(html(h(m.TokenUsageChart, { data: sample() })), /Output: <strong>20/);
  };
  check(charts);
  await killed('../src/pages/account/UsageCharts.jsx', 'data-cost={s.cost}', 'data-cost={s.cost * 2}', check);
});
