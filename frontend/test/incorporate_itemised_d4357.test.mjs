// D4357 (#4357) — Incorporate's itemised quote on the review step, before
// the founder confirms: each line with its source and the day it was checked,
// "Not recorded" for a fee nobody knows (never 0), and a total of the known
// lines that says so whenever one is unknown. Mounted on a stubbed fetch, with
// D1414's harness.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/incorporate_itemised_d4357.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import IncorporateFlow from '../src/pages/incorporate/IncorporateFlow.jsx';
import { NEVER_CHECKED, amountText, dayLabel, quoteRows, sourceText, totalText } from '../src/pages/incorporate/itemisedQuoteModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const JURISDICTIONS = { jurisdictions: [
  { id: 'us_de_ccorp', label: 'Delaware C-Corp', country: 'Delaware', est_cost_usd: [500, 1500], time_to_form_days: [1, 7], fundraising_friendly: true, summary: 'The default for VC-backed startups.', pros: ['What US investors expect', 'Settled case law'], cons: ['A yearly franchise tax', 'Needs a US registered agent'] },
  { id: 'us_wy_ccorp', label: 'Wyoming C-Corp', country: 'Wyoming', est_cost_usd: [100, 600], time_to_form_days: [1, 7], fundraising_friendly: false, summary: 'A low-cost corporation in the US.', pros: ['Low yearly fees'], cons: ['Less case law'] },
] };
const PROJECTS = { projects: [
  { id: 2, name: '[Orbit Notes]', my_seat: 'owner', company_uid: null, company_name: null },
  { id: 3, name: '[Ledgerline]', my_seat: 'owner', company_uid: 'nl', company_name: '[Northwind Labs]' },
  { id: 4, name: '[Someone else’s]', my_seat: 'cofounder', company_uid: null },
] };
const QUOTE = { jurisdiction_id: 'us_de_ccorp', label: 'Delaware C-Corp', amount_cents: 94800, currency: 'usd', source: 'catalog',
  registered_agent: { price_id: 'price_ra', amount_cents: 14900, currency: 'usd', interval: 'year', product_name: 'Registered agent' } };

function worker(over = {}) {
  return (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url, 'http://x').pathname;
    const key = `${method} ${path}`;
    if (over[key]) return over[key](init, url);
    if (key === 'GET /api/legal/jurisdictions') return response(JURISDICTIONS);
    if (key === 'GET /api/account/projects') return response(PROJECTS);
    if (key === 'GET /api/legal/name-check') return response({ status: 'available' });
    if (key === 'GET /api/legal/documents') return response([{ id: 1, template_name: 'cofounder_agreement', status: 'signed', signed_at: '2026-10-03 10:00:00' }]);
    if (key === 'GET /api/legal/incorporation/quote') return response(QUOTE);
    if (key === 'POST /api/projects') return response({ id: 77, name: '[Fresh]' });
    if (key === 'POST /api/legal/incorporation/order') return response({ dev: true, status: 'paid', incorporation_id: 31 });
    if (key === 'GET /api/legal/incorporate/status') return response({ id: 31, status: 'paid', company_name: '[Orbit Notes Inc.]', paid_at: '2026-10-30 10:00:00', packet_document_id: null, filed_on: null });
    if (path.startsWith('/api/company-ein/')) return response({ recorded: false, last4: null, masked: null, can_edit: true });
    if (key === 'GET /api/legal/83b/trackers') return response({ trackers: [] });
    return response({});
  };
}

async function mount(url = '/incorporate', { handle = worker() } = {}) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 2, role: 'founder', name: '[Avery Stone]' }));
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    let body = null;
    try { body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
    seen.push({ call: `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`, body });
    return handle(String(u), init);
  };
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '/incorporate', element: h(IncorporateFlow) })))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await settle(); };
  return {
    seen, settle,
    calls: () => seen.map((s) => s.call),
    writes: () => seen.filter((s) => !s.call.startsWith('GET ') && s.call !== 'POST /api/client-error'),
    text: () => textOf(document.body),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byId(id)), prop: (id, k) => props(byId(id))?.[k],
    click: (id) => fire(id, 'onClick'), change: (id, v) => fire(id, 'onChange', { target: { value: v, checked: v } }),
    wait: async (ms) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}


const line = (key, label, amount_cents, extra = {}) => ({ key, label, amount_cents, currency: 'usd', interval: null, optional: false, paid: 'with_order', source: 'Stripe catalog (Axal VC)', source_url: null, checked_on: '2026-11-02', ...extra });
const STATE_KNOWN = line('state_filing_fee', 'State filing fee', 8900, { paid: 'at_filing', source: 'Delaware Division of Corporations, fee schedule', source_url: 'https://corp.delaware.gov/fee/', checked_on: '2026-11-04' });
const STATE_UNKNOWN = { ...STATE_KNOWN, amount_cents: null, checked_on: null };
const SERVICE = line('service_fee', 'Axal VC service fee', 94800);
const AGENT = line('registered_agent', 'Registered agent', 14900, { optional: true, interval: 'year', paid: 'after_you_pay', checked_on: '2026-11-01' });
const FULL = { jurisdiction_id: 'us_de_ccorp', label: 'Delaware C-Corp', lines: [STATE_KNOWN, SERVICE, AGENT], total: { amount_cents: 103700, currency: 'usd', complete: true, unknown: [] } };
const PARTIAL = { jurisdiction_id: 'us_de_ccorp', label: 'Delaware C-Corp', lines: [STATE_UNKNOWN, SERVICE, AGENT], total: { amount_cents: 94800, currency: 'usd', complete: false, unknown: ['State filing fee'] } };

test('the model: Not recorded for an unknown fee, never 0; the source and its day; the total says when it is partial', () => {
  assert.equal(amountText(STATE_UNKNOWN), 'Not recorded');
  assert.equal(amountText({ ...STATE_KNOWN, amount_cents: 0 }), 'Not recorded', 'a zero is not a fee');
  assert.equal(amountText(STATE_KNOWN), '$89');
  assert.equal(amountText(AGENT), '$149/year');
  assert.equal(dayLabel('2026-11-04'), '4 Nov 2026');
  assert.equal(sourceText(STATE_KNOWN), 'Delaware Division of Corporations, fee schedule · checked 4 Nov 2026');
  assert.equal(sourceText(STATE_UNKNOWN), `Delaware Division of Corporations, fee schedule · ${NEVER_CHECKED}`);
  const rows = quoteRows(PARTIAL);
  assert.deepEqual(rows.main.map((r) => r.key), ['state_filing_fee', 'service_fee']);
  assert.deepEqual(rows.optional.map((r) => r.key), ['registered_agent']);
  assert.equal(rows.main[0].sourceUrl, 'https://corp.delaware.gov/fee/');
  assert.equal(quoteRows({ lines: [{ ...STATE_KNOWN, source_url: 'javascript:alert(1)' }] }).main[0].sourceUrl, null, 'only an https link');
  assert.deepEqual(totalText(FULL.total), { amount: '$1,037', complete: true, note: null });
  const partial = totalText(PARTIAL.total);
  assert.equal(partial.amount, '$948');
  assert.equal(partial.complete, false);
  assert.match(partial.note, /The sum of the known lines only\. Not recorded: State filing fee\./);
  assert.equal(totalText({ amount_cents: null, currency: 'usd', complete: false, unknown: ['State filing fee', 'Axal VC service fee'] }).amount, 'Not recorded');
  assert.equal(totalText({ amount_cents: 94800, currency: 'usd', complete: true, unknown: ['x'] }).complete, false, 'an unknown line is never a complete total');
});

async function toReview(quote) {
  const w = await mount('/incorporate?project=2', { handle: worker({ 'GET /api/legal/incorporation/itemised-quote': () => (quote instanceof Error ? response({ detail: 'down' }, 500) : response(quote)) }) });
  await w.click('incorporate-primary');
  await w.click('incorporate-primary');
  await w.change('incorporate-company-name', '[Orbit Notes Inc.]');
  await w.wait(700);
  await w.click('incorporate-primary');
  assert.ok(w.has('incorporate-review'), 'on the review step');
  return w;
}

test('mounted: a full quote, line by line, with each source and its day, and a complete total', async () => {
  const w = await toReview(FULL);
  try {
    const read = w.seen.find((s) => s.call === 'GET /api/legal/incorporation/itemised-quote');
    assert.ok(read, 'the review step reads the itemised quote');
    assert.equal(w.of('incorporate-line-state_filing_fee-amount'), '$89');
    assert.match(w.of('incorporate-line-state_filing_fee-source'), /Paid to the state at filing · Delaware Division of Corporations, fee schedule · checked 4 Nov 2026/);
    assert.equal(w.of('incorporate-line-service_fee-amount'), '$948');
    assert.match(w.of('incorporate-line-service_fee-source'), /Charged with your order · Stripe catalog \(Axal VC\) · checked 2 Nov 2026/);
    assert.equal(w.of('incorporate-line-registered_agent-amount'), '$149/year');
    assert.match(w.of('incorporate-itemised'), /Optional, not in the total.*Registered agent/s);
    assert.equal(w.of('incorporate-itemised-total'), '$1,037');
    assert.equal(w.prop('incorporate-itemised-total', 'data-complete'), '1');
    assert.ok(!w.has('incorporate-itemised-incomplete'));
    assert.ok(w.has('incorporate-order'), 'the one price the order charges is still beside it');
    assert.equal(w.writes().filter((x) => x.call.startsWith('POST /api/legal')).length, 0, 'reading the quote orders nothing');
  } finally { await w.close(); }
});

test('mounted: an unknown line reads Not recorded, and the total says it is the known lines only', async () => {
  const w = await toReview(PARTIAL);
  try {
    assert.equal(w.of('incorporate-line-state_filing_fee-amount'), 'Not recorded');
    assert.equal(w.prop('incorporate-line-state_filing_fee', 'data-known'), '0');
    assert.match(w.of('incorporate-line-state_filing_fee-source'), /not checked yet/);
    assert.doesNotMatch(w.of('incorporate-itemised'), /\$0\b/, 'never a zero');
    assert.equal(w.of('incorporate-itemised-total'), '$948');
    assert.equal(w.prop('incorporate-itemised-total', 'data-complete'), '0');
    assert.match(w.of('incorporate-itemised-incomplete'), /The sum of the known lines only\. Not recorded: State filing fee\. The full cost is not known yet\./);
  } finally { await w.close(); }
});

test('mounted: a failed read says so, with Try again, and the review step still works', async () => {
  const w = await toReview(new Error('down'));
  try {
    assert.match(w.of('incorporate-itemised-unread'), /The itemised quote could not be read\./);
    assert.ok(w.has('incorporate-order'));
  } finally { await w.close(); }
});

test('the client reads only its own route', () => {
  assert.match(readFileSync('frontend/src/lib/api/incorporationQuote.js', 'utf8'), /request\(`\/legal\/incorporation\/itemised-quote\?jurisdiction_id=\$\{encodeURIComponent\(jurisdictionId\)\}`\)/);
});
