/**
 * D6231 (#6231): /funds/ledger reads one fund, chosen as the other Fund zones
 * choose it, and every block follows it; one row of view chips; copy that says
 * the page's one write; a refresh; no empty tile column.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_accounting_scope_6231.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { fundLedgerApi } from '../src/lib/api/fundLedger.js';
import { mercuryInvestorApi } from '../src/lib/api/mercuryInvestor.js';
import InvestorFundAccounting, { LOCKED_LINE, WRITE_LINE, ledgerLocks } from '../src/pages/investor/InvestorFundAccounting.jsx';
import { FundLedgerView } from '../src/pages/investor/FundLedgerPanel.jsx';
import { LEDGER_LINES_LOCKED, investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const PERIOD = { id: 1, label: 'Q3 2026', start_date: '2026-07-01', end_date: '2026-09-30', closed: 0 };
const FUNDS = [
  { id: 1, name: 'Alpha Fund I', can_manage: true },
  { id: 2, name: 'Beta Fund II', can_manage: true },
  { id: 3, name: 'Outside Fund', can_manage: false }, // an LP position only: never chosen
];
const ANALYTICS = { items: [
  { id: 1, committed_cents: 100_000_00, called_cents: 40_000_00, collected_cents: 30_000_00, outstanding_cents: 10_000_00, deployed_cents: 20_000_00, distributed_cents: 0, lp_capital: [{ limited_partner_id: 11, name: 'Alpha LP', called_cents: 1_00, collected_cents: 1_00, outstanding_cents: 0 }] },
  { id: 2, committed_cents: 777_000_00, called_cents: 500_000_00, collected_cents: 444_000_00, outstanding_cents: 56_000_00, deployed_cents: 111_000_00, distributed_cents: 5_000_00, lp_capital: [{ limited_partner_id: 21, name: 'Beta LP', called_cents: 2_00, collected_cents: 2_00, outstanding_cents: 0 }] },
] };
const LEDGER = (over = {}) => ({ items: [
  { id: 2, name: 'Beta Fund II', can_manage: false, period: PERIOD, periods: [PERIOD], summary: { fee_cents: 12_345, expense_cents: 678 }, reason: null, journal: [], trial_balance: [], ...over },
] });

test('the view chips: Journal and Fees lock with one reason unless this reader administers the fund; Audit trail has no read', () => {
  assert.deepEqual(ledgerLocks({ status: 'ready', present: true, canManage: true }), {});
  for (const access of [{ status: 'loading' }, { status: 'unreadable' }, { status: 'ready', present: false }, { status: 'ready', present: true, canManage: false }]) {
    assert.deepEqual(ledgerLocks(access), { journal: LEDGER_LINES_LOCKED, fees: LEDGER_LINES_LOCKED }, JSON.stringify(access));
  }
  const picked = [];
  const open = investorZoneFilters('funds/ledger', { value: 'journal', onChange: (k) => picked.push(k), locked: {} });
  assert.deepEqual(open.map((c) => [c.label, !!c.disabled, !!c.active]), [['Summary', false, false], ['Journal', false, true], ['Fees', false, false], ['Audit trail', true, false]]);
  open[2].onSelect(); assert.deepEqual(picked, ['fees']);
  const locked = investorZoneFilters('funds/ledger', { value: 'summary', onChange() {}, locked: ledgerLocks({ status: 'ready', present: true, canManage: false }) });
  assert.deepEqual(locked.map((c) => [c.label, !!c.disabled]), [['Summary', false], ['Journal', true], ['Fees', true], ['Audit trail', true]]);
  assert.equal(locked[1].title, LEDGER_LINES_LOCKED); assert.equal(locked[1].onSelect, undefined, 'a locked chip cannot be pressed');
  assert.match(locked[3].title, /no audit-trail read/);
});

test('the ledger panel in scoped mode never shows another fund, and draws no chips of its own', () => {
  const html = (props) => renderToStaticMarkup(h(FundLedgerView, { items: LEDGER().items, ...props }));
  const other = html({ fundId: 1, scoped: true, scopeName: 'Alpha Fund I' });
  assert.match(other, /Not recorded: no operational ledger for Alpha Fund I is readable with your access\./);
  assert.doesNotMatch(other, /Beta Fund II|\$123\.45/);
  const two = renderToStaticMarkup(h(FundLedgerView, { items: [...LEDGER().items, { ...LEDGER().items[0], id: 9, name: 'Gamma Ledger' }], fundId: 2, scoped: true }));
  assert.doesNotMatch(two, /Gamma Ledger/, 'no fund chips: the page chose the fund');
  const own = html({ fundId: 2, scoped: true, scopeName: 'Beta Fund II', view: 'journal' });
  assert.match(own, /Beta Fund II · Q3 2026/); assert.match(own, /\$123\.45/);
  assert.doesNotMatch(own, />Journal<|>Fees<|>Summary</, 'no view chips: the header row drives the panel');
  const admin = renderToStaticMarkup(h(FundLedgerView, { items: LEDGER({ can_manage: true }).items, fundId: 2, scoped: true }));
  assert.doesNotMatch(admin, />Journal<|>Fees<|>Summary</);
  // Unscoped (Fund Administration's Books tab) keeps today's fallback and chips.
  assert.match(html({ fundId: 1 }), /Beta Fund II/);
});

async function mountAt(url) {
  const restore = installDocument();
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const store = new Map();
  globalThis.localStorage = globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.nodeValue ?? n.textContent ?? '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(InvestorFundAccounting))); });
  await settle();
  return {
    by, pr, settle,
    text: () => txt(container).replace(/\s+/g, ' ').trim(),
    html: () => container.innerHTML ?? '',
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore?.(); },
  };
}
function stub(over = {}) {
  const saved = { fundsList: api.fundsList, fundsAnalytics: api.fundsAnalytics, list: fundLedgerApi.list, read: fundLedgerApi.read, proposals: mercuryInvestorApi.proposals, feeds: mercuryInvestorApi.feeds, ledgerMap: mercuryInvestorApi.ledgerMap };
  const calls = { fundsList: 0, fundsAnalytics: 0, ledger: 0, mercury: [] };
  api.fundsList = async () => { calls.fundsList += 1; return over.fundsList ? over.fundsList() : FUNDS; };
  api.fundsAnalytics = async () => { calls.fundsAnalytics += 1; return ANALYTICS; };
  fundLedgerApi.list = async () => { calls.ledger += 1; return over.ledger ? over.ledger() : LEDGER(); };
  fundLedgerApi.read = async () => { throw new Error('not used'); };
  const never = () => new Promise(() => {});
  mercuryInvestorApi.proposals = (kind, fundId) => { calls.mercury.push(fundId); return never(); };
  mercuryInvestorApi.feeds = never; mercuryInvestorApi.ledgerMap = never;
  return { calls, restore() { api.fundsList = saved.fundsList; api.fundsAnalytics = saved.fundsAnalytics; fundLedgerApi.list = saved.list; fundLedgerApi.read = saved.read; mercuryInvestorApi.proposals = saved.proposals; mercuryInvestorApi.feeds = saved.feeds; mercuryInvestorApi.ledgerMap = saved.ledgerMap; } };
}

test('?fund= picks the fund; capital lines, per-LP capital and the ledger all follow it', async () => {
  const s = stub();
  const m = await mountAt('/funds/ledger?fund=2');
  try {
    const t = m.text();
    assert.match(t, /Committed capital \$777K/, 'Beta’s committed capital');
    assert.match(t, /Capital collected \$444K/);
    assert.doesNotMatch(t, /\$100K|\$30K|Alpha LP/, 'never items[0]');
    assert.match(t, /Beta LP/);
    assert.match(t, /Beta Fund II · Q3 2026/);
    assert.match(t, /\$123\.45/);
    // Beta's ledger grants the summary only: the one line says why, once.
    assert.equal((t.match(/only the fund’s assigned administrator or an admin reads journal lines/g) || []).length, 1);
    assert.ok(m.by('fund-ledger-locked'));
    assert.equal(m.pr(m.by('filter-ledger-journal')).disabled, true);
    if (s.calls.mercury.length) assert.ok(s.calls.mercury.every((id) => String(id) === '2'), 'Mercury proposals are for the chosen fund');
  } finally { await m.unmount(); s.restore(); }
});

test('a chosen fund with no readable ledger says so instead of showing another fund', async () => {
  const s = stub();
  const m = await mountAt('/funds/ledger?fund=1');
  try {
    const t = m.text();
    assert.match(t, /Committed capital \$100K/, 'Alpha’s capital lines');
    assert.match(t, /Not recorded: no operational ledger for Alpha Fund I is readable with your access\./);
    assert.doesNotMatch(t, /Beta Fund II · Q3 2026|\$123\.45/);
    assert.equal(m.by('fund-ledger-locked'), undefined, 'no access line where there is no ledger to lock');
  } finally { await m.unmount(); s.restore(); }
});

test('an administrator gets Journal and Fees from the header row; copy names the one write; refresh re-reads', async () => {
  const s = stub({ ledger: () => LEDGER({ can_manage: true }) });
  const m = await mountAt('/funds/ledger?fund=2');
  try {
    assert.equal(m.by('fund-ledger-locked'), undefined);
    assert.equal(m.pr(m.by('filter-ledger-journal')).disabled, undefined);
    await m.click('filter-ledger-journal');
    assert.match(m.text(), /Trial balance · selected period/);
    const t = m.text();
    assert.ok(t.includes(WRITE_LINE));
    assert.doesNotMatch(t, /no write|Read-only ledger view|this page is read-only/i, 'nothing claims the page never writes');
    const before = { ...s.calls };
    await m.click('fund-accounting-refresh');
    assert.ok(s.calls.fundsList > before.fundsList && s.calls.fundsAnalytics > before.fundsAnalytics && s.calls.ledger > before.ledger, 'refresh reads the funds, the analytics and the ledger again');
  } finally { await m.unmount(); s.restore(); }
});

test('the fund list failing and operating no fund are two different sentences', async () => {
  let s = stub({ fundsList: async () => { throw new Error('down'); } });
  let m = await mountAt('/funds/ledger');
  try { assert.ok(m.by('status-fund-accounting-unreadable')); assert.doesNotMatch(m.text(), /\$/); } finally { await m.unmount(); s.restore(); }
  s = stub({ fundsList: async () => [FUNDS[2]] });
  m = await mountAt('/funds/ledger?fund=3');
  try { assert.ok(m.by('status-fund-accounting-no-fund')); assert.doesNotMatch(m.text(), /Outside Fund/); } finally { await m.unmount(); s.restore(); }
});

test('three tiles draw in three columns, and one on a phone', () => {
  const css = read('frontend/src/pages/investor/investorFundAccounting.css');
  assert.match(css, /\.if3-stats--three\{grid-template-columns:repeat\(3,1fr\)\}/);
  assert.match(css, /@media\(max-width:640px\)\{\.if3-stats,\.if3-stats--three\{grid-template-columns:1fr\}/);
  const page = read('frontend/src/pages/investor/InvestorFundAccounting.jsx');
  assert.equal((page.match(/<Stat /g) || []).length, 3);
  assert.match(page, /className="if3-stats if3-stats--three"/);
  assert.ok(LOCKED_LINE.startsWith('Journal and Fees: '));
});
