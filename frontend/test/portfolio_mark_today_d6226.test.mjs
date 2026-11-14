/**
 * D6226 (#6226): mark age is measured against the positions read's own
 * `today` (the Worker's UTC date). Positions no longer needs the reporting
 * read to count stale marks, and the company's Latest FMV draws its Stale chip
 * (undoing D4817 part 6's departure). A positions read without `today` keeps
 * the old behaviour: Positions falls back to `kpi-compliance`'s `as_of`, and
 * the company draws no chip.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_mark_today_d6226.test.mjs
 *
 * Mutations checked, each both ways (fails with the mutation, passes without):
 *   - `markReference` ignoring the positions read's `today` → tests 1 and 3;
 *   - `markReference` preferring `today` over a chosen as-of date → test 3;
 *   - `workerToday` accepting a malformed date → test 3;
 *   - the Positions page not passing `reads.positions` to `markReference` → test 1;
 *   - `keyFactsOf` dropping the FMV chip → test 2;
 *   - `FinancialMetric` not drawing `metric.chip` → test 2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioPositions from '../src/pages/investor/InvestorPortfolioPositions.jsx';
import { FinancialMetric } from '../src/pages/portfolio/PortfolioParts.jsx';
import { markReference, workerToday } from '../src/pages/portfolio/portfolioModel.js';
import { keyFactsOf } from '../src/pages/portfolio/companyModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (value) => ({ state: 'ok', value });

async function render(element, answer = () => undefined) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => answer(new URL(String(input), 'http://localhost').pathname) ?? json({});
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  await act(async () => root.render(element));
  for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  return {
    text: (id) => { const n = nodes().find((x) => props(x)['data-testid'] === id); return n ? textOf(n) : null; },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

const row = (id, uid, name, markAsOf) => ({
  project_id: id, project: { uid, name }, total_invested: 1000000, latest_ownership_pct: 5, fmv: 1500000, multiple: 1.5,
  marked_down: false, unmarked: false, mark_unavailable_reason: null, mark_unavailable: null, mark_as_of: markAsOf, mark_basis: 'round_price',
});
/** Worker-shaped `/api/positions` with D6226's `today`. */
const POSITIONS = { items: [row(1, 'lumen', 'Lumen Robotics', '2026-09-30'), row(2, 'northwind', 'Northwind Labs', '2026-03-31')], today: '2026-11-14' };

test('Positions: with the reporting read failing, the stale count resolves from the positions read’s own date', async () => {
  const view = await render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(InvestorPortfolioPositions)), (path) => {
    if (path === '/api/positions') return json(POSITIONS);
    if (path === '/api/positions/kpi-compliance') return json({ detail: 'boom' }, 500);
    if (path === '/api/portfolio/health') return json({ items: [], not_measured: [] });
    if (path === '/api/portfolio-updates/latest') return json({ items: [] });
    return undefined;
  });
  try {
    assert.match(view.text('positions-count-stale'), /Stale marks \(older than two quarters\)1Northwind Labs · 31 Mar 2026/);
    assert.doesNotMatch(view.text('positions-count-stale'), /Unreadable/);
    assert.match(view.text('row-investor-position-ledger-2'), /31 Mar 2026Stale · 7 months old/);
    assert.equal(view.text('stale-1'), null, 'a current mark reads stale');
  } finally { await view.close(); }
});

const POSITION = row(4, 'p-abc', 'Acme Robotics', '2026-03-31');
const facts = (positions) => keyFactsOf({ positions, owed: { state: 'loading' }, support: { state: 'loading' } }, 'p-abc');

test('company: the Latest FMV draws a Stale chip measured at the positions read’s today', async () => {
  const fmv = facts(ok({ items: [POSITION], today: '2026-11-14' })).find((f) => f.key === 'fmv');
  assert.deepEqual(fmv.chip, { text: 'Stale · 7 months old', tone: 'late' });
  const view = await render(h(FinancialMetric, { metric: fmv }));
  try {
    assert.match(view.text('metric-fmv'), /\$1,500,000As of 31 Mar 2026 · Priced roundStale · 7 months old/);
    assert.equal(view.text('metric-fmv-chip'), 'Stale · 7 months old');
  } finally { await view.close(); }
});

test('the model: the reference date prefers a chosen as-of, then the positions read’s today, then kpi-compliance', () => {
  const positions = ok({ items: [], today: '2026-11-14' });
  const compliance = ok({ companies: [], as_of: '2026-11-13' });
  assert.deepEqual(markReference('', { state: 'unreadable' }, positions), { date: '2026-11-14', state: 'ok', source: 'positions' });
  assert.equal(markReference('', compliance, positions).date, '2026-11-14', 'the positions read’s own date wins over the reporting read');
  assert.equal(markReference('2026-06-30', compliance, positions).date, '2026-06-30', 'a chosen as-of date still wins');
  // A positions read without `today` (an older Worker): the D4817 part 2 fallback, unchanged.
  assert.equal(markReference('', compliance, ok({ items: [] })).date, '2026-11-13');
  assert.deepEqual(markReference('', { state: 'unreadable' }, ok({ items: [] })), { date: null, state: 'unreadable' });
  assert.equal(markReference('', compliance, { state: 'loading' }).date, '2026-11-13');
  assert.equal(markReference('', compliance).date, '2026-11-13', 'a caller that passes no positions read is unchanged');
  assert.equal(workerToday(ok({ items: [], today: '14 Nov 2026' })), null, 'a malformed date is not a reference');
  assert.equal(workerToday(ok([])), null);
});

test('company: no chip for a current mark, or when the positions read carries no today', () => {
  assert.equal(facts(ok({ items: [{ ...POSITION, mark_as_of: '2026-09-30' }], today: '2026-11-14' })).find((f) => f.key === 'fmv').chip, null);
  const older = facts(ok({ items: [POSITION] })).find((f) => f.key === 'fmv');
  assert.equal(older.chip, null, 'without the Worker’s date the age is not measured, and the browser clock is not used');
  assert.match(older.note, /As of 31 Mar 2026/);
});
