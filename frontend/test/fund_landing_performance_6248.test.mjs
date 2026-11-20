/**
 * #6248 — the Fund landing (`/funds`) and the performance page tell the same truth: NAV, RVPI, TVPI
 * and IRR come from `GET /api/fund-performance/:id` (D627), each its value or Not recorded with the
 * Worker's reason; a failed read says it failed; the fixed "unavailable until…" sentence is gone.
 * Every fund here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_landing_performance_6248.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorFundLanding from '../src/pages/investor/InvestorFundLanding.jsx';
import { performanceFigures, PERFORMANCE_FALLBACK_REASON } from '../src/pages/investor/investorFundLandingModel.js';

const h = React.createElement;
const FUNDS = [
  { id: 3, name: 'Example Fund I', status: 'active', committed_cents: 500000000, called_cents: 120000000, collected_cents: 90000000, deployed_cents: 0, distributed_cents: 0, lp_count: 0 },
  { id: 8, name: 'Example Fund II', status: 'active', committed_cents: 100000000, called_cents: 30000000, collected_cents: null, deployed_cents: 0, distributed_cents: 0, lp_count: 0 },
];
const NAV_REASON = 'Every attributed position needs a dated valuation; no complete investment NAV is recorded.';
const RATIO_REASON = 'This figure needs its recorded investment NAV or paid distributions and positive capital called.';
const IRR_REASON = 'IRR needs complete dated calls, paid distributions and terminal investment NAV, with a unique solvable cash-flow series.';
const COMPLETE = { id: 3, as_of: '2026-10-20', nav_basis: 'Investments only; cash balances, liabilities, fees and carry are not included.', nav_cents: 150000000, paid_in_cents: 120000000, distributed_cents: 30000000, rvpi: 1.25, dpi: 0.25, tvpi: 1.5, irr: 0.184, unavailable: {} };
const BARE = { id: 8, as_of: '2026-10-20', nav_basis: COMPLETE.nav_basis, nav_cents: null, paid_in_cents: 30000000, distributed_cents: null, rvpi: null, dpi: null, tvpi: null, irr: null,
  unavailable: { nav_cents: NAV_REASON, distributed_cents: 'No complete paid distribution amount is recorded for this fund.', rvpi: RATIO_REASON, dpi: RATIO_REASON, tvpi: RATIO_REASON, irr: IRR_REASON } };

// Mutation checked: a figure's value dropped (fails); the Worker's reason replaced (fails); a null read as 0x (fails);
// a failed read drawn as Not recorded (fails); the fallback reason missing (fails).
test('#6248 model: each figure is its value, or Not recorded with the Worker reason; a failed read claims nothing', () => {
  const ready = performanceFigures(COMPLETE);
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.figures.map((f) => [f.key, f.value, f.reason]), [
    ['nav_cents', '$1.5M', null], ['rvpi', '1.25x', null], ['tvpi', '1.50x', null], ['irr', '18.4%', null],
  ]);
  assert.equal(ready.asOf, '2026-10-20');
  const bare = performanceFigures(BARE);
  assert.deepEqual(bare.figures.map((f) => [f.key, f.value, f.reason]), [
    ['nav_cents', null, NAV_REASON], ['rvpi', null, RATIO_REASON], ['tvpi', null, RATIO_REASON], ['irr', null, IRR_REASON],
  ]);
  assert.equal(performanceFigures({ ...BARE, unavailable: undefined }).figures[0].reason, PERFORMANCE_FALLBACK_REASON, 'never a blank reason');
  assert.equal(performanceFigures({ ...COMPLETE, irr: 0 }).figures[3].value, '0.0%', 'a recorded zero is a figure');
  const failed = performanceFigures('unreadable');
  assert.equal(failed.state, 'unreadable');
  assert.ok(failed.figures.every((f) => f.value === null && f.reason === null), 'a failed read gives no value and no reason');
  assert.equal(performanceFigures(null).state, 'loading');
});

async function mount(path, perf) {
  const restore = installDocument();
  const prev = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const reads = [];
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (/\/api\/funds\/analytics/.test(url)) return json({ items: FUNDS, totals: null, unavailable: {} });
    const p = /\/api\/fund-performance\/(\d+)$/.exec(url.split('?')[0]);
    if (p) { reads.push(Number(p[1])); return perf(Number(p[1]), json); }
    if (/\/api\/funds\/\d+\/lps/.test(url)) return json({ items: [] });
    if (/\/api\/capital\/calls/.test(url)) return json([]);
    if (/\/report-periods/.test(url)) return json({ items: [] });
    return json({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(InvestorFundLanding, { fundUnlocked: true }))));
  await act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    reads,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    href: (id) => props(byId(id)).href ?? byId(id)?.getAttribute?.('href') ?? null,
    state: () => props(byId('fund-performance-figures'))['data-state'],
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, prev); restore(); },
  };
}

// Mutation checked: the landing not reading performance (fails); reading another fund's (fails); the old fixed
// sentence restored (fails); the RVPI "on NAV" placeholder restored (fails); the link without the fund (fails).
test('#6248 mounted: a fund with complete marks shows its figures; the fixed sentence is gone', async () => {
  const v = await mount('/funds?fund=3', (id, json) => json(id === 3 ? COMPLETE : BARE));
  try {
    assert.deepEqual(v.reads, [3], 'reads the selected fund only');
    assert.equal(v.state(), 'ready');
    assert.equal(v.textOf('fund-performance-nav_cents'), 'NAV · investments only$1.5M');
    assert.equal(v.textOf('fund-performance-rvpi'), 'RVPI1.25x');
    assert.equal(v.textOf('fund-performance-tvpi'), 'TVPI1.50x');
    assert.equal(v.textOf('fund-performance-irr'), 'IRR18.4%');
    assert.equal(v.href('link-fund-performance'), '/funds/performance', 'the one link, to the page of every fund (D6245)');
    const t = v.text();
    assert.doesNotMatch(t, /unavailable until the underlying records exist/);
    assert.doesNotMatch(t, /RVPI · on NAV/);
    assert.doesNotMatch(t, /Unavailable values stay unavailable/);
    assert.match(t, /Accrued expenses\s*Unavailable/, 'the performance read does not supply accruals, so that line stays');
  } finally { await v.close(); }
});

// Mutation checked: the Worker's reason dropped (fails); a missing figure drawn as 0 (fails).
test('#6248 mounted: a fund without complete marks reads Not recorded with the Worker reason', async () => {
  const v = await mount('/funds?fund=8', (id, json) => json(BARE));
  try {
    assert.deepEqual(v.reads, [8]);
    assert.equal(v.textOf('fund-performance-nav_cents'), `NAV · investments onlyNot recorded· ${NAV_REASON}`);
    assert.match(v.textOf('fund-performance-irr'), new RegExp(`^IRRNot recorded.*${IRR_REASON.slice(0, 40)}`));
    assert.doesNotMatch(v.textOf('fund-performance-rvpi'), /0\.00x/);
  } finally { await v.close(); }
});

// Mutation checked: a failed read drawn as Not recorded (fails); a failed read hiding the link (fails); the
// failure swallowing the rest of the page (fails).
test('#6248 mounted: a failed performance read shows the read failure, not a claim', async () => {
  const v = await mount('/funds?fund=3', (id, json) => json({ error: 'fund_performance_unreadable' }, 503));
  try {
    assert.equal(v.state(), 'unreadable');
    assert.ok(v.has('text-fund-performance-unreadable'));
    assert.match(v.textOf('text-fund-performance-unreadable'), /Fund performance[\s\S]*This is not a claim that it is unrecorded\./);
    assert.ok(!v.has('fund-performance-nav_cents'), 'no figure claims Not recorded');
    assert.equal(v.href('link-fund-performance'), '/funds/performance', 'the one link, to the page of every fund (D6245)');
    assert.equal(v.textOf('text-fund-committed'), '$5.0M', 'the rest of the summary still draws');
  } finally { await v.close(); }
});

// Mutation checked: the read removed from the landing's source (fails).
test('#6248: the landing reads the performance client the performance page uses', () => {
  const src = readFileSync(new URL('../src/pages/investor/InvestorFundLanding.jsx', import.meta.url), 'utf8');
  assert.match(src, /fundPerformanceApi\.read\(fund\.id\)/);
});
