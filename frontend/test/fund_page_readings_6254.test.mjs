/** D6254: independent fund-page reads, server audience, recorded zeros and LP source isolation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import Readings, { readPagePerformance, readPagePositions, PerformanceBand, LpPosition } from '../src/pages/FundPageReadings.jsx';
import FundPage, { FundNextAction, FundTerms, LpaReadFailure } from '../src/pages/FundPage.jsx';
import { readableFund } from '../src/hooks/useFundReport.js';
const perf = { id: 42, as_of: '2026-11-22', nav_basis: 'Investments only.', nav_cents: null, paid_in_cents: 10000, distributed_cents: 0, tvpi: null, dpi: 0, irr: null, unavailable: { nav_cents: 'One position has no dated mark.' } };
const render = el => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/42'] }, el));
test('the extended page schema accepts legacy absence but rejects corrupt present terms or documents', () => {
  const base = { currency: 'USD', can_manage: false, fund: { id: 42, name: 'Fixture', lp_count: 0, size_cents: null,
    gp: { name: null, title: null, entity: null, email: null }, providers: { fund_admin: null, auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } }, totals: { committed_cents: 0, invested_cents: null }, periods: [], lpa: null };
  assert.equal(Boolean(readableFund(base)), true);
  const terms = { management_fee: 0.02, carried_interest: 0, management_fee_reason: null, carried_interest_reason: null };
  const docs = [{ kind: 'lpa', status: 'signed', version: 3, updated_at: '2026-10-01' }];
  assert.equal(Boolean(readableFund({ ...base, terms, documents: docs, documents_reason: 'Other documents are not recorded.' })), true);
  for (const fields of [{ terms: { ...terms, management_fee: '0.02' } }, { terms: { ...terms, carried_interest: -1 } }, { terms: { ...terms, management_fee_reason: {} } }, { documents: [{ ...docs[0], kind: 'private' }] }, { documents: [{ ...docs[0], status: {} }] }, { documents_reason: {} }]) assert.equal(Boolean(readableFund({ ...base, ...fields })), false);
});
test('term values retain recorded zeros and distinguish missing terms with the returned reason', () => {
  const zero = render(React.createElement(FundTerms, { page: { terms: { management_fee: 0, carried_interest: 0 } } }));
  assert.equal((zero.match(/0\.0%/g) || []).length, 2);
  const absent = render(React.createElement(FundTerms, { page: { terms: { management_fee: null, management_fee_reason: 'No recorded fee term.' } } }));
  assert.match(absent, /Not recorded/); assert.match(absent, /No recorded fee term/);
});
test('a performance result must identify this fund and contain readable dated figures', async () => {
  assert.equal(await readPagePerformance(42, async () => perf), perf);
  for (const bad of [{ ...perf, id: 99 }, { ...perf, as_of: null }, { ...perf, nav_cents: '0' }, { ...perf, dpi: Infinity }]) await assert.rejects(readPagePerformance(42, async () => bad), /unreadable/);
});
test('position counts require the matching fund, recorded row ids, as-of and a possible unmarked count', async () => {
  const value = { fund_id: 42, as_of: '2026-11-22', items: [{ id: 1 }], unmarked: 0 };
  assert.equal(await readPagePositions(42, async () => value), value);
  for (const invalid of [{ ...value, fund_id: 99 }, { ...value, as_of: null }, { ...value, items: [null] }, { ...value, unmarked: -1 }, { ...value, unmarked: 2 }]) await assert.rejects(readPagePositions(42, async () => invalid), /unreadable/);
});
test('the band preserves zero distributions and the missing NAV reason', () => {
  const html = render(React.createElement(PerformanceBand, { reading: { status: 'ready', data: perf } }));
  assert.match(html, /22 Nov 2026/); assert.match(html, /\$0\.00/); assert.match(html, /\$100\.00/);
  assert.match(html, /One position has no dated mark/); assert.match(html, /Investments only/);
  assert.match(html, /Uncalled · USD/); assert.match(html, /The performance read does not return uncalled capital/);
  assert.match(html, /href="\/funds\/performance"/);
});
test('the LP card filters by fund and pairs each multiple with its own LP id', () => {
  const html = render(React.createElement(LpPosition, { fundId: 42, reading: { status: 'ready', data: {
    lp_holdings: [{ id: 7, fund_id: 42, name: 'Own position', commitment_amount: 500, invested_amount: 100 }, { id: 8, fund_id: 99, name: 'Other fund sentinel' }],
    performance: [{ lp_id: 7, fund_id: 99, tvpi: 99 }, { lp_id: 88, fund_id: 42, tvpi: 88 }, { lp_id: 7, fund_id: 42, tvpi: 1.2, dpi: 0, distributions_dollars: 0 }],
  } } }));
  assert.match(html, /Own position/); assert.match(html, /\$500\.00/); assert.match(html, /1\.20x/); assert.match(html, /\$0\.00/);
  assert.doesNotMatch(html, /Other fund sentinel|99\.00x/);
});
test('next actions follow the recorded audience and period status', () => {
  const page = { fund: { id: 42, lp_count: 2 }, can_manage: true, periods: [{ id: 3, period: 'Q3', status: 'draft' }, { id: 2, period: 'Q2', status: 'issued' }] };
  assert.match(render(React.createElement(FundNextAction, { page })), /Open Q3 draft/);
  const lp = render(React.createElement(FundNextAction, { page: { ...page, can_manage: false } }));
  assert.match(lp, /Read Q2/); assert.doesNotMatch(lp, /Q3|draft|reporting\/new/);
  assert.match(render(React.createElement(FundNextAction, { page: { ...page, fund: { id: 42, lp_count: 0 } } })), /Add the first LP/);
});
test('LPA refused, absent body and failed download remain distinct', () => {
  assert.match(render(React.createElement(LpaReadFailure, { kind: 'refused' })), /Refused/);
  assert.match(render(React.createElement(LpaReadFailure, { kind: 'not_recorded' })), /Not recorded/);
  assert.match(render(React.createElement(LpaReadFailure, { kind: 'unavailable', retry() {} })), /Unavailable/);
});

async function mount(manager, failedPerformance = false) {
  const restore = installDocument(), oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    const path = new URL(String(url), 'http://fixture').pathname; calls.push(path);
    const body = path === '/api/fund-performance/42' ? perf : path.endsWith('/positions') ? { fund_id: 42, as_of: '2026-11-22', items: [{ id: 1 }, { id: 2 }], unmarked: 1 }
      : { lp_holdings: [{ id: 7, fund_id: 42, name: 'Own position', commitment_amount: 500, invested_amount: 100 }], performance: [] };
    return Response.json(body, { status: failedPerformance && path === '/api/fund-performance/42' ? 503 : 200 });
  };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, {}, React.createElement(Readings, { page: { fund: { id: 42 }, can_manage: manager } }))));
  const text = () => {
    const visit = n => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(visit).join('') : n.textContent || '';
    return visit(container);
  };
  const until = performance.now() + 10000;
  while (!(manager ? text().includes('2 positions') : text().includes('Own position')) && performance.now() < until) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  return { calls, text, async close() { await act(async () => root.unmount()); globalThis.fetch = oldFetch; restore(); } };
}
test('mounted: an LP reads performance and their own portal, never GP positions', async () => {
  const v = await mount(false);
  try { assert.ok(v.calls.includes('/api/funds/lp-portal')); assert.ok(v.calls.includes('/api/fund-performance/42')); assert.ok(!v.calls.some(p => p.endsWith('/positions'))); assert.match(v.text(), /Own position/); }
  finally { await v.close(); }
});
test('mounted: a GP reads positions without an LP portal call; a failed band preserves positions', async () => {
  const v = await mount(true, true);
  try { assert.ok(v.calls.includes('/api/fund-performance/42/positions')); assert.ok(!v.calls.includes('/api/funds/lp-portal')); assert.match(v.text(), /2 positions/); assert.match(v.text(), /Unavailable/); }
  finally { await v.close(); }
});


test('the LP page and unresolved audience expose no GP zone navigation', () => {
  const data = { currency: 'USD', can_manage: false, fund: { id: 42, name: 'Fixture', lp_count: 1, size_cents: null,
    gp: { name: null, title: null, entity: null, email: null }, providers: { fund_admin: null, auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } }, totals: { committed_cents: 0, invested_cents: null }, periods: [], lpa: null };
  for (const reading of [{ loading: false, data, reload() {} }, { loading: true, data: null, reload() {} }]) {
    const html = render(React.createElement(FundPage, { reading }));
    assert.doesNotMatch(html, /aria-label="Fund sections"/);
    assert.doesNotMatch(html, /href="\/funds\/(lps|calls|ledger|reporting)(?:\?|")/);
  }
  const gp = render(React.createElement(FundPage, { reading: { loading: false, data: { ...data, can_manage: true }, reload() {} } }));
  assert.match(gp, /aria-label="Fund sections"/);
  assert.match(gp, /href="\/funds\/lps/);
});
