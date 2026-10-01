/**
 * D371 — IF2 · Capital calls, the fund call ledger page.
 *
 * The Worker half (migration 312, the split, receipts, the gates) is pinned on
 * real SQLite in `cloudflare-worker/test/fund_call_ledger_d371.test.ts`. This
 * file holds the page: its arithmetic and labels, the rule for which fund it
 * opens, what it reads and writes, and the IF2 artboard's elements.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_calls_if2_d371.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  formatCents, parseDollarsToCents, percent, lineStateLabel, lineAge, kycLabel, linesFor, wireRows,
} from '../src/pages/investor/fundCallsModel.js';
import { pickManagedFund } from '../src/pages/investor/managedFund.jsx';
import InvestorFundCalls from '../src/pages/investor/InvestorFundCalls.jsx';
import { INVESTOR_ZONE_ACTIONS } from '../src/workspaces/investorZoneActions.js';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = 'frontend/src/pages/investor/InvestorFundCalls.jsx';
const CANVAS = 'design/canvases/integrated/Pages · Investor Fund.dc.html';

// ── Money ───────────────────────────────────────────────────────────────

test('cents print exactly, and absence is not $0.00', () => {
  assert.equal(formatCents(33_334), '$333.34');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(123_456_789_01), '$123,456,789.01');
  assert.equal(formatCents(null), null);
  assert.equal(formatCents(undefined), null);
  assert.equal(formatCents(12.5), null, 'a fractional cent is not a figure the ledger holds');
});

test('a typed amount becomes whole cents without a float, and a third decimal is refused', () => {
  assert.equal(parseDollarsToCents('1000'), 100_000);
  assert.equal(parseDollarsToCents('1,234.5'), 123_450);
  assert.equal(parseDollarsToCents(' 0.07 '), 7);
  // 0.1 + 0.2 territory: parsed digit by digit, never via Number('…') * 100.
  assert.equal(parseDollarsToCents('1.15'), 115);
  assert.equal(parseDollarsToCents('4.35'), 435);
  for (const bad of ['12.345', '0', '0.00', '-5', 'abc', '', null, '1e3', '$10']) {
    assert.equal(parseDollarsToCents(bad), null, `${bad} was accepted`);
  }
});

test('a percentage needs a whole to be a share of', () => {
  assert.equal(percent(35, 100), '35.0%');
  assert.equal(percent(1, 0), null);
  assert.equal(percent(null, 100), null);
});

// ── Labels ──────────────────────────────────────────────────────────────

test('a line paid before receipts existed says so; the rest read their state', () => {
  assert.equal(lineStateLabel({ state: 'paid', receipt_recorded: false }), 'Paid · no receipt recorded');
  assert.equal(lineStateLabel({ state: 'paid', receipt_recorded: true }), 'Paid');
  assert.equal(lineStateLabel({ state: 'part_received' }), 'Part received');
  assert.equal(lineStateLabel({ state: 'overdue' }), 'Overdue');
});

test('age is days overdue, the date paid, or the due date — and says when there is none', () => {
  assert.equal(lineAge({ state: 'overdue', days_overdue: 1 }), '1 day overdue');
  assert.equal(lineAge({ state: 'overdue', days_overdue: 19 }), '19 days overdue');
  assert.equal(lineAge({ state: 'paid', paid_date: '2026-09-21' }), 'Paid 2026-09-21');
  assert.equal(lineAge({ state: 'pending', due_date: '2026-12-01' }), 'Due 2026-12-01');
  assert.equal(lineAge({ state: 'pending', due_date: null }), 'No due date recorded');
});

test('an LP with no account has no KYC record — never "pending"', () => {
  assert.equal(kycLabel({ has_account: false, kyc_status: null }), 'No platform account · no KYC record');
  assert.doesNotMatch(kycLabel({ has_account: false }), /pending/i);
  assert.equal(kycLabel({ has_account: true, kyc_status: 'in_review' }), 'KYC in review');
  assert.equal(kycLabel({ has_account: true, kyc_status: null }), 'KYC not recorded');
});

// ── Filters ─────────────────────────────────────────────────────────────

const LEDGER = {
  calls: [
    { call_number: 2, lines: [{ id: 21, state: 'pending', outstanding_cents: 500 }, { id: 22, state: 'paid', outstanding_cents: 0 }] },
    { call_number: 1, lines: [{ id: 11, state: 'overdue', outstanding_cents: 100 }, { id: 12, state: 'paid', outstanding_cents: 0 }] },
  ],
  unnumbered: [{ id: 1, state: 'pending', outstanding_cents: 2550 }, { id: 2, state: 'paid', outstanding_cents: 0 }],
};

test('Current call, All calls and Outstanding each select the lines they name', () => {
  assert.deepEqual(linesFor('latest', LEDGER).map((l) => [l.id, l.call_number]), [[21, 2], [22, 2]]);
  assert.deepEqual(linesFor('all', LEDGER).map((l) => l.id), [21, 22, 11, 12]);
  // Outstanding reaches the lines from before numbering too: they are owed.
  assert.deepEqual(linesFor('outstanding', LEDGER).map((l) => [l.id, l.call_number]), [[21, 2], [11, 1], [1, null]]);
  assert.deepEqual(linesFor('latest', { calls: [], unnumbered: [] }), []);
});

test('the wire trail is the receipts of the ledger read, nothing else', () => {
  const rows = wireRows({ entries: [{ kind: 'call', id: 1 }, { kind: 'receipt', id: 9 }, { kind: 'line', id: 3 }] });
  assert.deepEqual(rows.map((r) => r.id), [9]);
  assert.deepEqual(wireRows(null), []);
});

// ── Which fund ──────────────────────────────────────────────────────────

const FUNDS = [
  { id: 7, name: 'LP-only fund', can_manage: false },
  { id: 3, name: 'Fund I', can_manage: true },
  { id: 4, name: 'Fund II', can_manage: true },
];

test('the page opens a fund the caller operates, never the first row of the list', () => {
  const { funds, fund } = pickManagedFund(FUNDS, null);
  assert.deepEqual(funds.map((f) => f.id), [3, 4]);
  assert.equal(fund.id, 3, 'items[0] — a fund the caller only invests in — was picked');
  assert.equal(pickManagedFund(FUNDS, '4').fund.id, 4, '?fund= was not honoured');
  // Named in the URL but not operable: not picked.
  assert.equal(pickManagedFund(FUNDS, '7').fund.id, 3);
  assert.equal(pickManagedFund([{ id: 7, can_manage: false }], null).fund, null);
  assert.equal(pickManagedFund(undefined, null).fund, null);
});

test('the LPs and Reporting pages pick through the same rule, not items[0]', () => {
  for (const p of ['frontend/src/pages/investor/InvestorFundLPs.jsx', 'frontend/src/pages/investor/InvestorFundReporting.jsx']) {
    const src = codeOnly(read(p));
    assert.match(src, /useManagedFund\(\)/, `${p} does not use the managed-fund rule`);
    assert.doesNotMatch(src, /items\[0\]|fundsRows\[0\]/, `${p} still opens the first fund in the list`);
  }
});

// ── The page ────────────────────────────────────────────────────────────

test('the page reads the fund call ledger and the wire trail, and a failed read is Unreadable', () => {
  const src = codeOnly(read(PAGE));
  assert.match(src, /api\.fundsCallLedger\(fund\.id\)/);
  assert.match(src, /api\.fundsLedger\(fund\.id\)/);
  // Each read fails on its own, and each failure is said with a retry.
  assert.match(src, /Promise\.allSettled\(/);
  assert.match(src, /ledger\.status === 'unreadable' && [\s\S]{0,160}?<Unreadable what="This fund's call ledger"[^>]*onRetry=\{load\}/);
  assert.match(src, /wires\.status === 'unreadable'\s*\?\s*<Unreadable what="The wire trail"[^>]*onRetry=\{load\}/);
  assert.match(src, /managed\.error \? \([\s\S]{0,160}?<Unreadable what="The list of funds you operate"[^>]*onRetry=\{managed\.reload\}/);
});

test('Issue sends the amount whose split is on screen; changing the amount drops the preview', () => {
  const src = codeOnly(read(PAGE));
  assert.match(src, /api\.fundsCallPreview\(fund\.id, cents\)/);
  assert.match(src, /api\.fundsCapitalCallV2\(fund\.id, preview\.amount_cents, /,
    'the issue re-reads the input instead of sending the previewed amount');
  assert.match(src, /key === 'amount' \? \{ preview: null \} : \{\}/, 'editing the amount keeps a stale preview');
  // The due date the modal and the API dropped now travels.
  const api = codeOnly(read('frontend/src/lib/api.js'));
  assert.match(api, /fundsCapitalCallV2: \(id, amount_cents, note, due_date\) =>[\s\S]{0,200}?due_date: due_date \|\| undefined/);
  const modal = codeOnly(read('frontend/src/pages/FundsPage.jsx'));
  assert.match(modal, /api\.fundsCapitalCallV2\(fund\.id, [^\n]*, note, dueDate \|\| null\)/);
  assert.match(modal, /<Field label="Due date \(optional\)" type="date"/);
});

test('a receipt posts whole cents, the date it landed and the reference — nothing else', () => {
  const src = codeOnly(read(PAGE));
  assert.match(src, /api\.fundsRecordReceipt\(fund\.id, receipt\.lineId, \{\s*amount_cents: cents, received_on: receipt\.date, reference: [^}]*\}\)/);
  assert.match(src, /const cents = parseDollarsToCents\(receipt\.amount\)/);
  // A paid line offers no receipt.
  assert.match(src, /line\.state !== 'paid' && <button[^>]*button-record-receipt/);
});

test('no figure on the page is defaulted to zero', () => {
  const src = codeOnly(read(PAGE));
  assert.doesNotMatch(src, /\|\| 0\b|\?\? 0\b/, 'a figure is defaulted to zero');
  const lps = codeOnly(read('frontend/src/pages/investor/InvestorFundLPs.jsx'));
  assert.doesNotMatch(lps, /lpCommitment\(row\) \|\| 0/, 'the LP register still sums an unrecorded commitment as zero');
});

test('the page ships no canvas sample LPs or figures', () => {
  const src = read(PAGE);
  for (const sample of ['Meridian', 'Ashcombe', 'Okonkwo', 'Delacroix', 'Tessellate', 'Halvorsen', 'Call 3', '19 days']) {
    assert.ok(!src.includes(sample), `the page carries the canvas sample "${sample}"`);
  }
});

test('the page renders without a fund read, and mounts the rail once', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/calls'] },
    React.createElement(InvestorFundCalls)));
  assert.match(html, /data-testid="investor-fund-calls"/);
  assert.match(html, /<h1>Capital calls<\/h1>/);
  assert.equal((codeOnly(read(PAGE)).match(/<WorkerRail\b/g) || []).length, 1);
});

// ── The IF2 artboard ────────────────────────────────────────────────────

/** The IF2 page object in the canvas, sliced at both ends. */
function if2() {
  const canvas = read(CANVAS);
  const from = canvas.indexOf("{ id:'if2'");
  const to = canvas.indexOf("{ id:'if3'", from);
  assert.ok(from > 0 && to > from, 'the IF2 artboard was not found between its neighbours');
  return canvas.slice(from, to);
}

test('the artboard\'s heading, stats and ledger columns are on the page', () => {
  const art = if2();
  const src = read(PAGE);
  assert.match(art, /h1:'Capital calls'/);
  assert.ok(src.includes('<h1>Capital calls</h1>'));
  assert.match(art, /sub:'Schedule builder, letters, wire tracking and delinquency\.'/);
  assert.ok(src.includes('Schedule builder, letters, wire tracking and delinquency.'));
  // The four stat tiles, by the canvas's own labels.
  const adds = [...art.matchAll(/\{ label:'([^']+)', value:/g)].map((m) => m[1]);
  assert.deepEqual(adds.slice(0, 3), ['Called to date', 'Collected', 'Outstanding']);
  for (const label of ['Called to date', 'Collected', 'Outstanding', 'Current call']) {
    assert.ok(src.includes(`label="${label}"`), `the ${label} tile is missing`);
  }
  // The ledger's columns, in the canvas's order.
  const head = /head:\[([^\]]+)\]/.exec(art)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(head, ['LP', 'Commitment', 'Owed', 'Received', 'State', 'Age']);
  const table = src.slice(src.indexOf('function LineTable'));
  let at = 0;
  for (const col of head) {
    const i = table.indexOf(`>${col}</th>`, at);
    assert.ok(i > at, `the ${col} column is missing or out of order`);
    at = i;
  }
});

test('every filter and op the artboard draws is live or states why not', () => {
  const art = if2();
  const filters = /filters: fil\(\[([^\]]+)\]/.exec(art)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const ops = /ops:\[([^\]]+)\]/.exec(art)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const f = INVESTOR_ZONE_FILTERS['funds/calls'];
  assert.deepEqual(f.map((x) => x.canvas), filters);
  assert.deepEqual(f.filter((x) => x.key).map((x) => x.key), ['latest', 'all', 'outstanding']);
  const a = INVESTOR_ZONE_ACTIONS['funds/calls'];
  assert.deepEqual(a.map((x) => x.label), ops);
  assert.equal(a.find((x) => x.label === 'New call').kind, 'handler');
  assert.equal(a.find((x) => x.label === 'Export wires').kind, 'export');
  // The one op left unbuilt says so, and the page's rail names the Eadwyn draft it lacks.
  assert.ok(a.find((x) => x.label === 'Send reminders').unbuilt);
  assert.match(read(PAGE), /\['Reminder letters', 'Eadwyn drafts no reminder for this page yet/);
});
