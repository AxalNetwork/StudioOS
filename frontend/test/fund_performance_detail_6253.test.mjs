/** D6253: the GP's read-only detail, its audience boundary, missing marks and independent failed reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Detail, { PerformanceDetailView, readPerformanceDetail } from '../src/pages/investor/FundPerformanceDetail.jsx';
import { FundPerformanceView } from '../src/pages/FundPerformancePage.jsx';
const fund = { id: 42, name: 'Fixture fund', status: 'active', as_of: '2026-11-22', unavailable: {} };
const read = data => ({ status: 'ready', data, reload() {} });
const history = { fund_id: 42, as_of: '2026-11-22', truncated: false, items: [
  { quarter: 'Q3 2026', quarter_end: '2026-09-30', paid_in_cents: 10000, distributed_cents: 0, nav_cents: null, dpi: 0, unavailable: { nav_cents: 'One position has no mark.' } },
] };
const positions = { fund_id: 42, as_of: '2026-11-22', items: [
  { id: 1, company_name: 'Marked company', marked: true, value_cents: 0, invested_amount: 20, valuation_date: '2026-01-31', source: 'Recorded valuation' },
  { id: 2, company_name: 'Unmarked company', marked: false, invested_amount: 37, unavailable: { value_cents: 'No recorded mark; cost is not value.' } },
] };
const render = element => renderToStaticMarkup(React.createElement(MemoryRouter, {}, element));
const detail = (h = read(history), p = read(positions)) => render(React.createElement(PerformanceDetailView, { fund, history: h, positions: p }));

test('only an affirmative Worker permission executes a detail request', async () => {
  let calls = 0;
  const reader = async id => { calls++; assert.equal(id, 42); return history; };
  for (const permission of [false, undefined, null, 1, 'true']) {
    assert.equal(await readPerformanceDetail(42, permission, reader), null);
  }
  assert.equal(calls, 0);
  assert.equal(await readPerformanceDetail(42, true, reader), history);
  assert.equal(calls, 1);
  await assert.rejects(readPerformanceDetail(42, true, async () => ({ ...history, fund_id: 99 })), /could not be read/);
  await assert.rejects(readPerformanceDetail(42, true, async () => ({ fund_id: 42 })), /could not be read/);
  await assert.rejects(readPerformanceDetail(42, true, async () => { throw Error('failed'); }), /failed/);
});

test('an LP sees neither GP details nor a GP link', () => {
  const html = render(React.createElement(Detail, { fund, canManage: false }));
  assert.match(html, /currently GP and admin reads/);
  assert.doesNotMatch(html, /data-testid="fund-performance-detail"|Positions with marks|Open fund page/);
});

test('history preserves zero distributions, missing NAV with its reason, and a fund-page link', () => {
  const html = detail();
  assert.match(html, /<h4[^>]*>Q3 2026 · 30 Sep 2026<\/h4>/);
  assert.match(html, /One position has no mark/);
  assert.match(html, /\$100\.00/);
  assert.match(html, /\$0\.00/);
  assert.match(html, /href="\/funds\/42"/);
  assert.doesNotMatch(html, /Record a mark|Move to another fund|Record a valuation/);
});

test('positions reuse dated stale marks, preserve a zero valuation and never replace missing marks by cost', () => {
  const html = detail();
  assert.match(html, /Stale · older than 1 quarter/);
  assert.match(html, /31 Jan 2026/);
  assert.match(html, /Recorded valuation/);
  assert.match(html, /Latest mark<\/dt><dd>\$0\.00/);
  assert.match(html, /No recorded mark; cost is not value/);
  assert.doesNotMatch(html, /Latest mark<\/dt><dd>\$37\.00/);
});

test('one failed read leaves the other result visible and never claims it is empty', () => {
  const failed = { status: 'unreadable', reload() {} };
  const failedPositions = detail(read(history), failed);
  assert.match(failedPositions, /Unavailable/);
  assert.match(failedPositions, /Q3 2026/);
  assert.doesNotMatch(failedPositions, /No position is attributed/);
  const failedHistory = detail(failed, read(positions));
  assert.match(failedHistory, /Unavailable/);
  assert.match(failedHistory, /Marked company/);
  assert.doesNotMatch(failedHistory, /No quarter has ended/);
});

test('empty, loading and truncated are distinct from failure', () => {
  assert.match(detail(read({ ...history, items: [], reason: 'No capital call is recorded.' })), /No capital call is recorded/);
  assert.match(detail(read({ ...history, truncated: true })), /Partial: only the latest 1 quarters/);
  assert.equal((detail({ status: 'loading' }, { status: 'loading' }).match(/aria-busy="true"/g) || []).length, 2);
  assert.match(detail(read(history), read({ ...positions, items: [] })), /No position is attributed/);
});

test('unknown or failed access does not render a detail reader', () => {
  const unknown = render(React.createElement(FundPerformanceView, { items: [fund] }));
  assert.match(unknown, /Checking access/);
  assert.doesNotMatch(unknown, /data-testid="fund-performance-detail"/);
  const failed = render(React.createElement(FundPerformanceView, { items: [fund], audience: { status: 'unreadable', reload() {} } }));
  assert.match(failed, /Unavailable/);
  assert.doesNotMatch(failed, /data-testid="fund-performance-detail"/);
});
