/** D6253: the GP's read-only detail, its audience boundary, missing marks and independent failed reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Detail, { PerformanceDetailView, readPerformanceDetail } from '../src/pages/investor/FundPerformanceDetail.jsx';
import { FundPerformanceView } from '../src/pages/FundPerformancePage.jsx';
import FundPerformancePage from '../src/pages/FundPerformancePage.jsx';
import { installDocument } from './_contracts_dom.mjs';
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
  assert.match(detail(read({ ...history, truncated: true })), /Partial: only the latest 1 quarter was read/);
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

test('Refresh rechecks permission before detail, refreshes both reads and preserves the selected fund', async () => {
  const restore = installDocument();
  const old = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let manager = true, audienceCalls = 0, hold = false, release;
  const calls = [];
  globalThis.fetch = async url => {
    const path = new URL(String(url), 'http://fixture').pathname; calls.push(path);
    let body = {};
    if (path === '/api/fund-performance') body = { items: [fund, { ...fund, id: 43, name: 'Second fund', status: 'raising' }] };
    if (path === '/api/funds') {
      audienceCalls++;
      if (hold) await new Promise(resolve => { release = resolve; });
      body = { items: [{ id: 42, can_manage: manager }, { id: 43, can_manage: manager }] };
    }
    const match = /^\/api\/fund-performance\/(\d+)\/(history|positions)$/.exec(path);
    if (match) body = { fund_id: Number(match[1]), as_of: '2026-11-22', items: [], reason: 'No capital call is recorded.' };
    return Response.json(body);
  };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = n => n?.[Object.keys(n).find(k => k.startsWith('__reactProps$'))] || {};
  const text = n => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
  const count = (id, part) => calls.filter(p => p === `/api/fund-performance/${id}/${part}`).length;
  const until = async condition => {
    const deadline = performance.now() + 10000;
    while (!condition() && performance.now() < deadline) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    assert.ok(condition(), `condition did not settle; calls=${JSON.stringify(calls)}`);
  };
  const refresh = async () => {
    const button = walk(container).find(n => props(n)['aria-label'] === 'Refresh fund performance');
    assert.ok(button);
    await act(async () => props(button).onClick());
  };
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, {}, React.createElement(FundPerformancePage))));
    await until(() => count(42, 'positions') === 1 && count(42, 'history') === 1);
    const choices = walk(container).filter(n => props(n).onClick && text(n) === 'Show detail');
    assert.equal(choices.length, 2);
    await act(async () => props(choices[1]).onClick());
    await until(() => count(43, 'positions') === 1 && count(43, 'history') === 1);
    manager = false; hold = true;
    await refresh();
    await until(() => audienceCalls === 2 && text(container).includes('Checking access to fund detail'));
    assert.equal(count(43, 'positions'), 1); assert.equal(count(43, 'history'), 1);
    await act(async () => { release(); });
    await until(() => text(container).includes('currently GP and admin reads'));
    assert.equal(count(43, 'positions'), 1); assert.equal(count(43, 'history'), 1);
    manager = true; hold = false;
    await refresh();
    await until(() => count(43, 'positions') === 2 && count(43, 'history') === 2);
    assert.equal(audienceCalls, 3);
    assert.equal(calls.filter(path => path === '/api/fund-performance').length, 3, 'One summary request per mount or Refresh');
    assert.equal(count(42, 'positions'), 1, 'Refresh retained the second fund selection');
    const filter = label => walk(container).find(n => props(n).onClick && props(n)['aria-pressed'] !== undefined && text(n).startsWith(label));
    const active = filter('Active'); assert.ok(active);
    await act(async () => props(active).onClick());
    await until(() => text(container).includes('selected fund is hidden by this filter'));
    assert.equal(count(42, 'positions'), 1, 'Filtering must not silently select another fund');
    const all = filter('All funds'); assert.ok(all);
    await act(async () => props(all).onClick());
    await until(() => count(43, 'positions') === 3);
    assert.equal(count(42, 'positions'), 1, 'The original selected fund returns when its filter returns');
  } finally {
    release?.(); await act(async () => root.unmount()); Object.assign(globalThis, old); restore();
  }
});
