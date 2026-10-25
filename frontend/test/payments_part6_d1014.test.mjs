/**
 * D1014 (#2833, part 6 of Payments #2386) — Stripe connection complete
 * (deliveries per hour with the hour that has no log, the part-5 buttons),
 * the Change log tab at /admin/platform/payments/log, the dark colours and the
 * phone form. Mounted on a stubbed `fetch`; each read also fails alone.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/payments_part6_d1014.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  DIALOGS_WAIT, TABS, actionWord, deliveryColumns, deliveryHours, deliveryTable, detailText, logFilters, logRange,
  peopleOf, reasonOf, reasonProblem, silentHoursText, tabOf, whoText,
} from '../src/pages/admin/payments/payModel.js';
import { totalsText } from '../src/pages/admin/payments/StripeConnection.jsx';
import { paymentsApi } from '../src/lib/api/payments.js';
import Payments from '../src/pages/admin/payments/Payments.jsx';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// 24 hours ending 14:00 on 24 Oct; 03:00 and 04:00 have no log at all, 05:00 was logged with no delivery.
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const at = new Date(Date.UTC(2026, 9, 23, 15) + i * 3_600_000);
  const hh = at.getUTCHours();
  if (hh === 3 || hh === 4) return { hour: at.toISOString(), deliveries: null, not_2xx: null };
  if (hh === 5) return { hour: at.toISOString(), deliveries: 0, not_2xx: 0 };
  return { hour: at.toISOString(), deliveries: 10, not_2xx: hh === 9 ? 2 : 0 };
});

// ---------------------------------------------------------------- the model

test('the tabs: three, the change log at /log', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['catalogue', 'stripe', 'log']);
  assert.equal(tabOf('/admin/platform/payments/log/'), 'log');
});

test('deliveries per hour: a silent hour is never 0, a logged empty hour is', () => {
  const rows = deliveryHours(HOURS);
  assert.equal(rows.length, 24);
  const three = rows.find((r) => r.label === '03:00');
  assert.equal(three.logged, false);
  assert.equal(three.deliveries, null, 'a silent hour was counted');
  const five = rows.find((r) => r.label === '05:00');
  assert.equal(five.logged, true);
  assert.equal(five.deliveries, 0);
  assert.equal(rows.find((r) => r.label === '09:00').refused, 2);
  assert.equal(rows.find((r) => r.label === '09:00').accepted, 8);
  assert.equal(rows.at(-1).current, true);
  assert.equal(rows.filter((r) => r.current).length, 1);
  // A half-written hour (one count missing) is not logged either.
  assert.equal(deliveryHours([{ hour: '2026-10-24T10:00:00.000Z', deliveries: 3, not_2xx: null }])[0].logged, false);
});

test('the chart rows: the silent hour dashed (open), a logged hour stacked accepted over not accepted', () => {
  const cols = deliveryColumns(HOURS);
  const three = cols.find((c) => c.label === '03');
  assert.equal(three.open, true, 'the no-log hour is not dashed');
  assert.equal(three.parts, undefined);
  const nine = cols.find((c) => c.label === '09');
  assert.equal(nine.open, undefined);
  assert.deepEqual(nine.parts, [{ value: 8, tone: 'violet' }, { value: 2, tone: 'amber' }]);
  assert.equal(nine.value, 10);
  assert.equal(cols.find((c) => c.label === '05').open, undefined, 'a logged empty hour was drawn as no log');
});

test('the silent hours in words, runs joined', () => {
  assert.equal(silentHoursText(HOURS), 'No log was kept for 03:00 to 05:00.');
  const two = HOURS.map((x, i) => (i === 0 ? { ...x, deliveries: null, not_2xx: null } : x));
  assert.equal(silentHoursText(two), 'No log was kept for 15:00 to 16:00 and 03:00 to 05:00.');
  assert.equal(silentHoursText(HOURS.map((x) => ({ ...x, deliveries: 1, not_2xx: 0 }))), null);
});

test('the table form: newest first, the current hour "so far", a silent hour "Not logged"', () => {
  const t = deliveryTable(HOURS);
  assert.equal(t[0].hour, '14:00 · so far');
  assert.equal(t[1].hour, '13:00');
  const three = t.find((r) => r.hour === '03:00');
  assert.equal(three.accepted, 'Not logged');
  assert.equal(three.refused, 'Not logged');
  assert.equal(t.find((r) => r.hour === '05:00').accepted, '0');
});

test('totals: a count the read did not carry is not recorded, never NaN or 0', () => {
  assert.equal(totalsText({ deliveries: 212, not_2xx: 2 }), '212 deliveries · 2 not accepted');
  assert.equal(totalsText({}), 'Not recorded deliveries · not recorded not accepted');
  assert.equal(totalsText({ deliveries: null, not_2xx: 0 }), 'Not recorded deliveries · 0 not accepted');
});

test('the change log in words: actions, details, who, the range, the filters, the reason', () => {
  assert.equal(actionWord('catalog_sync_failed'), 'Sync failed');
  assert.equal(actionWord('stripe_pk_update'), 'Replaced the publishable key');
  assert.equal(actionWord('something_new'), 'something_new', 'an unknown action was hidden');
  assert.equal(detailText({ action: 'catalog_sync', details: { synced: 24 } }), '24 products synced');
  assert.equal(detailText({ action: 'catalog_sync', details: { synced: 1 } }), '1 product synced');
  assert.equal(detailText({ action: 'catalog_sync', details: {} }), null, 'a missing count was drawn');
  assert.equal(detailText({ action: 'catalog_sync_failed', details: { failure: 'stripe', stripe_status: 502 } }), 'Stripe answered 502');
  assert.equal(detailText({ action: 'catalog_sync_failed', details: { failure: 'stripe' } }), 'Stripe did not answer');
  assert.equal(detailText({ action: 'stripe_pk_update', details: { mode: 'live', key_prefix: 'pk_live_' } }), 'Now Live');
  assert.equal(detailText({ action: 'token_pack_create', details: { face_cents: 1000 } }), '10.00 USD pack');
  assert.equal(detailText({ action: 'stripe_webhook_register', details: { secret_stored: false, url: 'x' } }), 'Signing secret not stored');
  assert.equal(reasonOf({ details: { reason: '  Raise for Q4  ' } }), 'Raise for Q4');
  assert.equal(reasonOf({ details: { reason: '   ' } }), null);
  assert.equal(whoText({ id: 7, name: 'Ada' }), 'Ada');
  assert.equal(whoText({ id: 7, name: null }), 'Account #7 · name not recorded');
  assert.equal(logRange(0, 25, 142), '1–25 of 142');
  assert.equal(logRange(25, 25, 142), '26–50 of 142');
  assert.equal(logRange(0, 0, 0), '0 of 0');
  assert.deepEqual(logFilters({ what: 'price', who: '', product: undefined, from: '2026-10-01', to: '' }), { what: 'price', from: '2026-10-01' });
  assert.match(reasonProblem('short'), /at least 10/);
  assert.equal(reasonProblem('  Quarterly audit  '), null);
  assert.match(reasonProblem('x'.repeat(501)), /500/);
  assert.deepEqual(peopleOf([{ who: { id: 2, name: 'Zed' } }, { who: { id: 1, name: 'Ada' } }, { who: { id: 2, name: 'Zed' } }]).map((p) => p.name), ['Ada', 'Zed']);
});

// ---------------------------------------------------------------- mounted

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PRODUCTS = [
  { id: 'prod_b', name: 'Founder Validate + Build', kind: 'subscription', active: true, categories: [], prices: [{ id: 'price_1', currency: 'usd', unit_amount: 2000, interval: 'month', interval_count: 1, active: true }] },
  { id: 'prod_c', name: 'Delaware incorporation', kind: 'incorporation', active: true, categories: ['founders'], prices: [{ id: 'price_2', currency: 'usd', unit_amount: 49900, interval: null, active: true }] },
];
const ENTRIES = [
  { id: 9, at: '2026-10-18 09:12:00', what: 'sync', action: 'catalog_sync', who: { id: 1, name: 'Ada Admin' }, product_id: null, price_id: null, details: { synced: 24 } },
  { id: 8, at: '2026-10-18 08:55:00', what: 'price', action: 'catalog_price_create', who: { id: 1, name: 'Ada Admin' }, product_id: 'prod_b', price_id: 'price_9', details: { reason: 'Yearly plan for founders', product_id: 'prod_b', price_id: 'price_9' } },
  { id: 7, at: '2026-10-14 11:02:00', what: 'sync', action: 'catalog_sync_failed', who: { id: 2, name: null }, product_id: null, price_id: null, details: { failure: 'stripe', stripe_status: 503 } },
];
const WEBHOOK = { our_url: 'https://axal.vc/api/billing/stripe/webhook', required_events: ['checkout.session.completed', 'charge.refunded'], endpoints: [
  { id: 'we_1', url: 'https://axal.vc/api/billing/stripe/webhook', status: 'enabled', is_ours: true, missing_events: ['charge.refunded'] },
] };
const SUMMARY = { payments_catalog: {
  publishable: { configured: true, masked: 'pk_live_••••4821', mode: 'live' },
  catalog: { available: true, products: { all: 2, active: 2 }, prices: { all: 2, active: 2 }, last_written_at: '2026-10-18 09:12:00', sync_basis: 'Nothing syncs on a schedule.' },
  webhook: { available: true, deliveries: 212, not_2xx: 2, last: { status_code: 200, latency_ms: 84, at: '2026-10-24 14:02:00' } },
} };
const DELIVERIES = { available: true, window_hours: 24, deliveries: 212, not_2xx: 2, last: { status_code: 200, latency_ms: 84, at: '2026-10-24 14:02:00' }, hours: HOURS };

function stub(over = {}) {
  const original = globalThis.fetch;
  const seen = [];
  const answers = {
    '/api/admin/catalog/products': () => json({ products: PRODUCTS, mode: 'live', audience_categories: [{ value: 'founders', label: 'For Founders' }] }),
    '/api/admin/stripe/config': () => json({ publishable_key: 'pk_live_••••4821', mode: 'live', configured: true }),
    '/api/admin/stripe/webhook': () => json(WEBHOOK),
    '/api/admin/platform/summary': () => json(SUMMARY),
    '/api/admin/payments/webhook-deliveries': () => json(DELIVERIES),
    '/api/admin/payments/change-log': (u) => json({ entries: ENTRIES, total: 3, limit: Number(u.searchParams.get('limit')), offset: 0, filters: {}, kinds: ['product', 'price', 'sync', 'token_pack', 'webhook', 'key'] }),
    ...over,
  };
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u);
    return answers[u.pathname] ? answers[u.pathname](u) : json({});
  };
  return { seen, paths: () => [...new Set(seen.map((u) => u.pathname))].filter((p) => !p.startsWith('/api/ai')).sort(), restore() { globalThis.fetch = original; } };
}

async function settle() { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

async function render(url, { phone = false } = {}) {
  const restore = installDocument();
  if (phone) globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null, ['', '/stripe', '/log', '/products/:id'].map((p) => h(Route, { key: p, path: `/admin/platform/payments${p}`, element: h(Payments) })))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    of: (id) => textOf(node(id)),
    has: (id) => Boolean(byTestId(id)),
    props: (id) => props(node(id)),
    count: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).length,
    all: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).map(textOf),
    svgClasses: () => walk(container).filter((n) => n.tagName === 'RECT').map((n) => props(n)?.className || ''),
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {}, target: node(id) }); }); await settle(); },
    async change(id, value) { await act(async () => { props(node(id)).onChange({ target: { value } }); }); await settle(); },
    async submit(id) { await act(async () => { props(node(id)).onSubmit({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); if (phone) delete globalThis.matchMedia; restore(); },
  };
}

test('mounted Stripe connection: the hourly chart with the dashed no-log hour, the totals, and the table on request', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/stripe');
  try {
    assert.match(v.of('pay-deliveries'), /212 deliveries · 2 not accepted/);
    assert.ok(v.has('pay-deliveries-chart'), 'no chart on a computer');
    const dashed = v.svgClasses().filter((c) => c.includes('stroke-axal-muted'));
    assert.equal(dashed.length, 2, 'the two silent hours are not dashed');
    assert.ok(dashed.every((c) => c.includes('dark:stroke-gray-400')), 'the dashed hour fades in the dark (PAY13)');
    assert.ok(v.svgClasses().some((c) => c.includes('dark:fill-[#a78bfa]')), 'violet is not #a78bfa in the dark');
    assert.match(v.of('pay-deliveries'), /No log was kept for 03:00 to 05:00\./);
    assert.match(v.of('pay-deliveries-last'), /Last delivery: 24 Oct 2026, 14:02 UTC · 200 · 84 ms/);
    assert.ok(s.paths().includes('/api/admin/payments/webhook-deliveries'));
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Stripe connection: the table form, six hours newest first, then all 24', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/stripe', { phone: true });
  try {
    assert.ok(!v.has('pay-deliveries-chart'), 'a phone drew the chart');
    assert.ok(!v.has('pay-deliveries-view'), 'a phone offered the chart');
    assert.equal(v.count('pay-deliveries-row'), 6);
    assert.match(v.all('pay-deliveries-row')[0], /14:00 · so far/);
    await v.click('pay-deliveries-all');
    assert.equal(v.count('pay-deliveries-row'), 24);
    assert.match(v.all('pay-deliveries-row').find((t) => t.startsWith('03:00')), /Not loggedNot logged/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Stripe connection: the three part-5 buttons are drawn, disabled, saying where the work is done today', async () => {
  const noEndpoint = stub({ '/api/admin/stripe/webhook': () => json({ ...WEBHOOK, endpoints: [] }) });
  let v = await render('/admin/platform/payments/stripe');
  try {
    assert.equal(v.props('pay-key-replace').disabled, true);
    assert.match(v.of('pay-key'), /Replace key…/);
    assert.ok(v.of('pay-key').includes(DIALOGS_WAIT));
    assert.equal(v.props('pay-webhook-register').disabled, true);
    assert.ok(!v.has('pay-webhook-add-we_1'));
  } finally { await v.unmount(); noEndpoint.restore(); }
  const s = stub();
  v = await render('/admin/platform/payments/stripe');
  try {
    assert.equal(v.props('pay-webhook-add-we_1').disabled, true);
    assert.match(v.of('pay-webhook'), /1 missing\..*Add the missing events/s);
    assert.ok(!v.has('pay-webhook-register'), 'register offered beside an endpoint of ours');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Stripe connection, failed: the deliveries read fails alone, and is not drawn as no delivery', async () => {
  const s = stub({ '/api/admin/payments/webhook-deliveries': () => json({ error: 'webhook_deliveries_unreadable', message: 'down' }, 503) });
  const v = await render('/admin/platform/payments/stripe');
  try {
    assert.match(v.of('pay-deliveries-unread'), /Could not be read\..*not a claim that no delivery came/s);
    assert.match(v.of('pay-deliveries-unread'), /Try again/);
    assert.ok(!v.has('pay-deliveries-chart'));
    assert.doesNotMatch(v.of('pay-deliveries'), /0 deliveries/);
    assert.match(v.of('pay-mirror'), /2 active of 2 products/, 'the summary still answered');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Change log: the tab, newest first, who, product by name, failed sync marked, codes only under Technical details', async () => {
  const s = stub();
  const v = await render('/admin/platform/payments/log');
  try {
    assert.match(v.of('pay-tab-log'), /Change log/);
    assert.equal(v.count('pay-log-row'), 3);
    const rows = v.all('pay-log-row');
    assert.match(rows[0], /^18 Oct 2026, 09:12 UTCAda AdminSynced from Stripe—24 products synced/);
    assert.match(rows[1], /Ada AdminAdded a priceFounder Validate \+ Build.*Reason: Yearly plan for founders/);
    assert.match(rows[2], /Account #2 · name not recorded✕Sync failed—Stripe answered 503/);
    assert.match(v.of('pay-log-count'), /1–3 of 3/);
    assert.ok(v.all('pay-log-tech').every((t) => t.startsWith('Technical details')));
    assert.match(v.all('pay-log-tech')[1], /action catalog_price_create · product prod_b · price price_9/);
    const call = s.seen.find((u) => u.pathname === '/api/admin/payments/change-log');
    assert.equal(call.searchParams.get('limit'), '25');
    assert.equal(call.searchParams.get('offset'), '0');
    assert.deepEqual(s.paths(), ['/api/admin/catalog/products', '/api/admin/payments/change-log'], 'the log tab read more than it draws');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Change log: filters go to the read, people come from the rows, and paging moves by 25', async () => {
  const s = stub({ '/api/admin/payments/change-log': (u) => json({ entries: ENTRIES, total: 60, limit: 25, offset: Number(u.searchParams.get('offset')), filters: {}, kinds: ['price', 'sync'] }) });
  const v = await render('/admin/platform/payments/log');
  try {
    assert.match(v.of('pay-log-what'), /^EverythingPricesSyncs$/, 'the kinds did not come from the read');
    assert.match(v.of('pay-log-who'), /AnyoneAccount #2 · name not recordedAda Admin/);
    assert.match(v.of('pay-log-product'), /Delaware incorporation.*Founder Validate \+ Build/);
    await v.change('pay-log-what', 'price');
    await v.change('pay-log-who', '1');
    await v.change('pay-log-product', 'prod_b');
    await v.change('pay-log-from', '2026-10-01');
    const last = s.seen.filter((u) => u.pathname === '/api/admin/payments/change-log').at(-1);
    assert.deepEqual(Object.fromEntries(last.searchParams), { what: 'price', who: '1', product: 'prod_b', from: '2026-10-01', limit: '25', offset: '0' });
    assert.equal(v.props('pay-log-newer').disabled, true);
    await v.click('pay-log-older');
    assert.equal(s.seen.filter((u) => u.pathname === '/api/admin/payments/change-log').at(-1).searchParams.get('offset'), '25');
    await v.change('pay-log-to', '2026-10-20');
    assert.equal(s.seen.filter((u) => u.pathname === '/api/admin/payments/change-log').at(-1).searchParams.get('offset'), '0', 'a filter did not go back to the newest');
    await v.click('pay-log-clear');
    assert.deepEqual(Object.fromEntries(s.seen.filter((u) => u.pathname === '/api/admin/payments/change-log').at(-1).searchParams), { limit: '25', offset: '0' });
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Change log, failed and empty: an unread log is never an empty one, and the catalogue failing loses only names', async () => {
  let s = stub({ '/api/admin/payments/change-log': () => json({ error: 'change_log_unreadable', message: 'down' }, 503) });
  let v = await render('/admin/platform/payments/log');
  try {
    assert.match(v.of('pay-log-unread'), /Could not be read\. Nothing is shown rather than an empty log\.Try again/);
    assert.ok(!v.has('pay-log-empty'), 'a failed read was drawn as an empty log');
    assert.equal(v.props('pay-log-export').disabled, true);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ '/api/admin/payments/change-log': () => json({ entries: [], total: 0, limit: 25, offset: 0, filters: {}, kinds: [] }) });
  v = await render('/admin/platform/payments/log');
  try {
    assert.match(v.of('pay-log-empty'), /No change has been recorded yet/);
  } finally { await v.unmount(); s.restore(); }
  s = stub({ '/api/admin/catalog/products': () => json({ detail: 'down' }, 502) });
  v = await render('/admin/platform/payments/log');
  try {
    assert.match(v.of('pay-log-names-unread'), /named by their ID/);
    assert.match(v.all('pay-log-row')[1], /Added a priceprod_b/);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Change log export: an in-page dialog asks why; the reason is sent; a refusal is shown, not a file', async () => {
  const s = stub({ '/api/admin/payments/change-log.csv': () => json({ error: 'export_not_recorded', message: 'The export could not be recorded, so it was not sent. Try again in a moment.' }, 503) });
  const v = await render('/admin/platform/payments/log');
  try {
    await v.change('pay-log-what', 'sync');
    await v.click('pay-log-export');
    assert.ok(v.has('pay-export'), 'no dialog');
    assert.equal(v.props('pay-export-send').disabled, true, 'an export without a reason was allowed');
    assert.match(v.of('pay-export-hint'), /at least 10 characters/);
    await v.change('pay-export-reason', 'Quarterly audit of price changes');
    assert.equal(v.props('pay-export-send').disabled, false);
    await v.submit('pay-export-form');
    const call = s.seen.find((u) => u.pathname === '/api/admin/payments/change-log.csv');
    assert.ok(call, 'the export was not asked for');
    assert.equal(call.searchParams.get('reason'), 'Quarterly audit of price changes');
    assert.equal(call.searchParams.get('what'), 'sync', 'the export ignored the filters');
    assert.match(v.of('pay-export-error'), /could not be recorded, so it was not sent/);
    assert.ok(v.has('pay-export'), 'the dialog closed on a refusal');
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Change log export, sent: the dialog closes and says what was exported, and that it was recorded', async () => {
  const s = stub();
  const original = paymentsApi.changeLogCsv;
  const calls = [];
  paymentsApi.changeLogCsv = async (filters, reason) => { calls.push({ filters, reason }); return { filename: 'payments-change-log-20261025.csv', rows: 3 }; };
  const v = await render('/admin/platform/payments/log');
  try {
    await v.click('pay-log-export');
    await v.change('pay-export-reason', '  Quarterly audit of price changes  ');
    await v.submit('pay-export-form');
    assert.deepEqual(calls, [{ filters: {}, reason: 'Quarterly audit of price changes' }]);
    assert.ok(!v.has('pay-export'), 'the dialog stayed open');
    assert.match(v.of('pay-log-exported'), /Exported 3 rows as payments-change-log-20261025\.csv\. The export and its reason are recorded\./);
  } finally { paymentsApi.changeLogCsv = original; await v.unmount(); s.restore(); }
});

test('mounted phone: the catalogue stacks into cards, a product opens as a bottom sheet, the log is a list', async () => {
  const s = stub();
  let v = await render('/admin/platform/payments', { phone: true });
  try {
    assert.ok(v.has('pay-phone-catalogue'));
    assert.equal(v.count('pay-row'), 2);
    // D1012: a card is a door to the product's own address; the product opens there.
    assert.equal(v.props('pay-row').href, '/admin/platform/payments/products/prod_b');
  } finally { await v.unmount(); }
  v = await render('/admin/platform/payments/products/prod_b', { phone: true });
  try {
    assert.ok(v.has('pay-product'), 'no product sheet');
    assert.equal(v.props('pay-product-layer')['data-phone'], 'sheet', 'the dialog is not a bottom sheet');
    assert.match(v.props('pay-product-layer').className, /max-sm:items-end/);
    assert.match(v.of('pay-product'), /Founder Validate \+ Build.*Monthly.*20\.00 USD/s, 'D1012: the product is PAY2\'s lightbox, at its own address');
    assert.match(v.of('pay-product-tech'), /^Technical details.*product: prod_b.*price_1/s);
  } finally { await v.unmount(); }
  v = await render('/admin/platform/payments/log', { phone: true });
  try {
    assert.ok(v.has('pay-log-list'));
    assert.ok(!v.has('pay-log-table'));
    await v.click('pay-log-export');
    assert.equal(v.props('pay-export-layer')['data-phone'], 'sheet');
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- the source

test('the route, the door, dark colours on the new parts, no pop-up and no secret key', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/platform/payments/log" element={guard(['admin'], hqOnly(<Payments />))} />`));
  const page = read('frontend/src/pages/admin/payments/Payments.jsx');
  assert.ok(page.includes('<HeaderTab to="/admin/platform/payments/log" data-testid="pay-tab-log">Change log</HeaderTab>'));
  for (const f of ['Payments.jsx', 'StripeConnection.jsx', 'ChangeLog.jsx', 'payUi.jsx']) {
    const src = read(`frontend/src/pages/admin/payments/${f}`);
    assert.ok(!/\b(alert|confirm|prompt)\(/.test(src), `${f}: a browser pop-up`);
    assert.ok(!/sk_(live|test)_|STRIPE_SECRET/.test(src), `${f}: names a secret key`);
    // Every light surface or ink class has its dark twin on the same element (PAY13).
    for (const cls of src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) || []) {
      if (/\bbg-white\b/.test(cls)) assert.match(cls, /dark:bg-/, `${f}: bg-white without a dark background: ${cls}`);
      if (/\btext-axal-ink\b/.test(cls)) assert.match(cls, /dark:text-/, `${f}: ink without a dark colour: ${cls}`);
    }
  }
  const ui = read('frontend/src/pages/admin/payments/payUi.jsx');
  for (const name of ['GHOST', 'CARD', 'SUB', 'EYE', 'H2', 'PILL', 'AMBER', 'LINK', 'FIELD', 'BIG', 'TAG', 'PRIMARY']) {
    const line = ui.split('\n').find((l) => l.startsWith(`export const ${name} =`));
    assert.match(line, /dark:/, `${name} has no dark colour`);
  }
});
