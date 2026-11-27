// D4812 part 6 (#4812, FA-05 to FA-07) — Portfolio, Reporting and Banking &
// Books: each figure as of its own date, a stale mark said in words, a report
// pack's recipients named before it is issued, the bank and ledger sides of a
// match side by side with the effect on outstanding, an account's balance
// with its read time, and the books' totals that balance (or say by how much
// they do not), each entry with its source.
//
// Every name, id and amount here is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_workspaces_d4812.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import { markState, navTiles, positionRows } from '../src/pages/admin/fundAdmin/performanceModel.js';
import { accountBalanceLine, entrySource, journalTotals, packRecipients, queueLine } from '../src/pages/admin/fundAdmin/fundAdminModel.js';
import { matchEffects, matchOutcome, reportIssueEffects } from '../src/pages/admin/fundAdmin/moneyFlowModel.js';

const h = React.createElement;
const fx = (rows) => Object.fromEntries(rows);

/* ------------------------------------------------------------------ FA-05 */

test('FA-05: NAV, RVPI and TVPI are as of the newest mark; cash figures as of the read; a mark older than a quarter is Stale', () => {
  // Mutations checked: Stale at exactly three months; the cash note on TVPI.
  const perf = { nav_cents: 100, paid_in_cents: 50, distributed_cents: 0, dpi: 0, rvpi: 2, tvpi: 2, irr: null, unavailable: { irr: 'Needs cash-flow dates.' } };
  const positions = { as_of: '2026-11-09', items: [
    { id: 1, marked: true, value_cents: 100, valuation_date: '2026-11-02' },
    { id: 2, marked: true, value_cents: 0, valuation_date: '2026-06-30' },
    { id: 3, marked: false },
  ] };
  const t = fx(navTiles(perf, { positions, asOf: '2026-11-09' }).map((x) => [x.key, x]));
  assert.deepEqual([t.nav.note, t.tvpi.note, t.rvpi.note], ['latest marks of 2 positions · marks to 2 Nov 2026', 'marks to 2 Nov 2026', 'marks to 2 Nov 2026']);
  assert.deepEqual([t.paid.note, t.dist.note, t.dpi.note], ['capital called · as of 9 Nov 2026', 'as of 9 Nov 2026', 'as of 9 Nov 2026']);
  assert.deepEqual([t.irr.text, t.irr.reason], [null, 'Needs cash-flow dates.'], 'IRR is Not recorded, never estimated');
  assert.equal(t.dist.text, '$0.00', 'a measured zero stays a zero');
  assert.equal(markState('2026-08-09', '2026-11-09'), 'Current', 'exactly one quarter is not stale');
  assert.equal(markState('2026-08-08', '2026-11-09'), 'Stale');
  assert.equal(markState(null, '2026-11-09'), null, 'no mark has no state');
  assert.deepEqual(positionRows(positions).map((r) => [r.id, r.state]), [[1, 'Current'], [2, 'Stale'], [3, null]]);
});

/* ------------------------------------------------------------------ FA-06 */

test('FA-06: an LP report names its recipients, counted from its pack; the queue says how many wait to be issued', () => {
  const report = { uid: 'r', kind: 'lp_quarterly_report', fund_id: 7, period_label: 'Q3 2026', status: 'prepared' };
  const items = [report,
    { kind: 'lp_capital_statement', fund_id: 7, period_label: 'Q3 2026', status: 'prepared' },
    { kind: 'lp_capital_statement', fund_id: 7, period_label: 'Q3 2026', status: 'prepared' },
    { kind: 'lp_capital_statement', fund_id: 7, period_label: 'Q3 2026', status: 'superseded' },
    { kind: 'lp_capital_statement', fund_id: 7, period_label: 'Q2 2026', status: 'issued' },
    { kind: 'lp_capital_statement', fund_id: 8, period_label: 'Q3 2026', status: 'prepared' },
    { kind: 'fee_statement', fund_id: 7, period_label: 'Q3 2026', status: 'prepared' }];
  assert.equal(packRecipients(report, items), 2);
  assert.equal(packRecipients({ kind: 'fee_statement' }, items), null);
  assert.equal(fx(reportIssueEffects(report, 'a'.repeat(64), 2)).Recipients, '2 LPs, one statement each, in the LP portal. No email is sent.');
  assert.equal(fx(reportIssueEffects(report, 'a'.repeat(64), 0)).Recipients.notRecorded, true, 'no statement is not "0 LPs"');
  assert.equal(queueLine(items, items.slice(0, 3)), '3 drafts · 2 prepared, waiting to be issued', 'a statement is issued with its report, so it does not wait alone');
});

/* ------------------------------------------------------------------ FA-07 */

test('FA-07: a match\'s effect on outstanding; a fee match marks the period collected; an unread line is said', () => {
  const line = { target_kind: 'capital_call_line', target_id: 11, amount_cents: 5000000,
    ledger: { kind: 'capital_call_line', lp_name: 'Harbor Family Office', call_number: 3, due_on: '2026-11-01', outstanding_cents: 12500000 } };
  assert.equal(matchOutcome(line), 'Records a $50,000.00 receipt on call 3 · outstanding $125,000.00 → $75,000.00');
  assert.equal(fx(matchEffects(line, 'Call 3')).Effect, matchOutcome(line));
  assert.match(matchOutcome({ ...line, ledger: null, ledger_unavailable: 'This target is no longer on the ledger.' }), /receipt\. This target is no longer on the ledger\.$/);
  assert.match(matchOutcome({ target_kind: 'fee_period', target_id: 51, amount_cents: 1, ledger: { quarter: '2026Q3' } }), /fee period 2026Q3, which then reads as collected/);
  assert.equal(accountBalanceLine({ current: { cents: 41238000 }, balance_read_at: '2026-11-09 14:05:00' }), 'Balance $412,380.00 · as of 2026-11-09 14:05:00');
  assert.equal(accountBalanceLine({ current: { cents: null, reason: 'unreadable' } }), 'Balance Unreadable · read time not recorded');
  assert.equal(accountBalanceLine(null), 'Pick one account to see its balance.');
});

test('FA-07 C: the books balance or say by how much they do not; each entry names its source', () => {
  const entry = (lines) => ({ lines });
  assert.deepEqual(journalTotals([entry([{ debit_cents: 1000000, credit_cents: 0 }, { debit_cents: 0, credit_cents: 1000000 }])]), { debit: 1000000, credit: 1000000, balanced: true });
  assert.deepEqual(journalTotals([entry([{ debit_cents: 5, credit_cents: 0 }])]), { debit: 5, credit: 0, balanced: false });
  assert.deepEqual(journalTotals([entry([{ debit_cents: null, credit_cents: 0 }])]), { debit: null, credit: null, balanced: null }, 'a line with no cents is not counted as 0');
  assert.equal(journalTotals([]), null);
  assert.equal(entrySource({ kind: 'fee_accrual', fee_terms_id: 4 }), 'Fee accrual · fee terms #4');
  assert.equal(entrySource({ kind: 'journal' }), 'Manual journal');
  assert.equal(entrySource({}), 'Not recorded');
});

/* ------------------------------------------------------------------ mounted */

const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const OVERVIEW = { as_of: '2026-11-09', entities: { state: 'ok', items: [] }, funds: { state: 'ok', items: [] }, fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] } };
const MATCH = (extra = {}) => ({ uid: 'm-1', target_kind: 'capital_call_line', target_id: 11, state: 'proposed', amount_cents: 5000000, posted_on: '2026-11-06',
  counterparty_name: 'HARBOR FAMILY OFF', entity_key: 'fund', last_four: '4471',
  ledger: { kind: 'capital_call_line', fund_id: 7, lp_name: 'Harbor Family Office', call_number: 3, due_on: '2026-11-01', outstanding_cents: 12500000 }, ledger_unavailable: null, ...extra });

async function mount(url, matches) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const apis = {
    fundAdmin: { access: async () => ({ super_admin: false, acts: [{ act: 'mercury.reconcile', tier: 'admin', allowed: true }] }), overview: async () => OVERVIEW, activity: async () => ({ items: [] }) },
    mercury: { matches: async () => ({ ok: true, items: matches }), transactions: async () => ({ ok: true, items: [] }) },
    fees: {}, performance: { list: async () => ({ items: [] }) }, reporting: { list: async () => ({ items: [] }) }, funds: {},
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user: ADMIN, apis }))));
  await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    by, text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('reconciliation: an open match shows bank and ledger side by side and its effect on outstanding; a confirmed one does not', async () => {
  const v = await mount('/admin/fund-admin/banking/reconciliation', [MATCH(), MATCH({ uid: 'm-2', state: 'confirmed' }), MATCH({ uid: 'm-3', target_id: 99, ledger: null, ledger_unavailable: 'This target is no longer on the ledger.' })]);
  try {
    assert.match(v.text('match-bank-m-1'), /Bank HARBOR FAMILY OFF \$50,000\.00 2026-11-06 · fund ending 4471/);
    assert.match(v.text('match-ledger-m-1'), /Ledger Call 3 · Harbor Family Office \$125,000\.00 outstanding Due 2026-11-01/);
    assert.equal(v.text('match-effect-m-1'), 'Effect · Records a $50,000.00 receipt on call 3 · outstanding $125,000.00 → $75,000.00');
    assert.ok(!v.by('match-pair-m-2'), 'a confirmed match is a line, not a pair to decide');
    assert.match(v.text('match-ledger-m-3'), /Capital-call line #99 .*Not recorded/);
  } finally { await v.close(); }
});
