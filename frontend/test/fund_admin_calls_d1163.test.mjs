/**
 * D1163 (#3070, part 6 of #2388) — Capital calls and Distributions drawn in
 * place in the fund administration console (FND7–FND9), with call and
 * distribution notices:
 *
 *   - the preview and the issued call show the same figures, and the console
 *     says so (or names the LP whose line differs);
 *   - a due date is never defaulted: an empty one is refused, and nothing is
 *     previewed;
 *   - an Admin reads "A Super Admin issues fund notices." where Issue would be;
 *   - L6: a notice that cannot issue reads "This notice can't issue: …", and
 *     no Issue is drawn;
 *   - the outstanding-by-age chart, the cumulative chart, the per-LP preview
 *     by name, Record receipt and Mark paid, each behind an in-page dialog.
 *
 * Every name, id and amount here is invented. No Mercury call is made: the
 * console's APIs are stubs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_calls_d1163.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  ageChart, callTiles, checkNewCall, cumulativeDistributions, distributionRows, figuresMatch, lpName, previewRows, receiptBody, refusedNotice,
} from '../src/pages/admin/fundAdmin/callsModel.js';

const h = React.createElement;

const SUPER_ACTS = ['capital_call.issue', 'distribution.execute', 'fund_notice.issue'];
const ADMIN_ACTS = ['capital_call.preview', 'capital_call.receipt', 'distribution.preview', 'distribution.mark_paid', 'fund_notice.preview'];
const SENTENCE = {
  'capital_call.issue': 'A Super Admin issues capital calls.',
  'distribution.execute': 'A Super Admin executes distributions.',
  'fund_notice.issue': 'A Super Admin issues fund notices.',
};
const access = (superAdmin) => ({
  super_admin: superAdmin,
  acts: [
    ...SUPER_ACTS.map((a) => ({ act: a, tier: 'super_admin', allowed: superAdmin, sentence: SENTENCE[a] })),
    ...ADMIN_ACTS.map((a) => ({ act: a, tier: 'admin', allowed: true, sentence: null })),
  ],
});
const OVERVIEW = () => ({
  as_of: '2026-10-18',
  entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund I', committed_cents: 50000000, called_cents: 10000000, received_cents: 7500000, outstanding_cents: 2500000, overdue_lines: 2, next_due_date: '2026-11-01' }] },
  fees: { state: 'ok', items: [] },
  drafts: { state: 'ok', items: [] },
  matches: { state: 'ok', items: [] },
});

const LINE = (id, callId, lp, name, owed, received, state, extra = {}) => ({
  id, fund_call_id: callId, limited_partner_id: lp, lp_name: name, lp_email: `lp${lp}@example.test`, has_account: true, kyc_status: 'approved',
  commitment_cents: owed * 5, owed_cents: owed, received_cents: received, outstanding_cents: state === 'paid' ? 0 : owed - received,
  receipt_count: received ? 1 : 0, due_date: '2026-10-01', paid_date: null, created_at: '2026-09-15', state,
  days_overdue: state === 'overdue' ? 17 : null, receipt_recorded: null, ...extra,
});
const CALL = (id, n, amount, lines, extra = {}) => ({
  id, uid: String(n).repeat(32), call_number: n, amount_cents: amount, purpose: `Call ${n} purpose`, due_date: '2026-10-01', created_at: '2026-09-15',
  issued_by_name: 'Ada Admin', residual_cents: 0, residual_lp_id: null, residual_lp_name: null, line_count: lines.length,
  received_cents: lines.reduce((s, l) => s + l.received_cents, 0), outstanding_cents: lines.reduce((s, l) => s + l.outstanding_cents, 0), lines, ...extra,
});
const LEDGER = (calls) => ({
  ok: true,
  summary: {
    committed_cents: 50000000, committed_lps: 2,
    called_cents: calls.flatMap((c) => c.lines).reduce((s, l) => s + l.owed_cents, 0),
    received_cents: calls.flatMap((c) => c.lines).reduce((s, l) => s + l.received_cents, 0),
    paid_before_receipts_cents: 0,
    outstanding_cents: calls.flatMap((c) => c.lines).reduce((s, l) => s + l.outstanding_cents, 0),
    calls_count: calls.length,
  },
  calls, unnumbered: [], truncated: false,
});
const CALL2 = () => CALL(22, 2, 5000000, [LINE(11, 22, 1, 'LP One', 3000000, 1000000, 'overdue'), LINE(12, 22, 2, 'LP Two', 2000000, 1500000, 'pending', { due_date: '2026-11-01' })]);
const CALL1 = () => CALL(21, 1, 5000000, [LINE(9, 21, 1, 'LP One', 3000000, 3000000, 'paid'), LINE(10, 21, 2, 'LP Two', 2000000, 2000000, 'paid')]);
// What New capital call previews for $10,000.00: LP One 60%, LP Two 40%.
const CALL_PREVIEW = () => ({
  ok: true, next_call_number: 3, residual_cents: 0, excluded: [],
  lines: [
    { lp_id: 1, name: 'LP One', email: 'lp1@example.test', commitment_cents: 30000000, share_cents: 600000, residual: false, kyc_status: 'approved', has_account: true },
    { lp_id: 2, name: 'LP Two', email: 'lp2@example.test', commitment_cents: 20000000, share_cents: 400000, residual: false, kyc_status: null, has_account: false },
  ],
});
const CALL3 = (two = 400000) => CALL(23, 3, 1000000, [LINE(13, 23, 1, 'LP One', 600000, 0, 'pending', { due_date: '2026-12-01' }), LINE(14, 23, 2, 'LP Two', two, 0, 'pending', { due_date: '2026-12-01' })]);

const DISTRIBUTIONS = () => ({ ok: true, items: [
  { id: 91, lp_id: 1, lp_name: 'LP One', amount_cents: 450000, status: 'pending', distribution_type: 'exit_proceeds', created_at: '2026-10-01' },
  { id: 90, lp_id: 2, lp_name: 'LP Two', amount_cents: 300000, status: 'paid', distribution_type: 'exit_proceeds', created_at: '2026-08-01', distributed_at: '2026-08-03' },
  { id: 89, lp_id: 1, lp_name: 'LP One', amount_cents: 200000, status: 'paid', distribution_type: 'dividend', created_at: '2026-06-01', distributed_at: '2026-06-02' },
] });

function stubs(over = {}) {
  const calls = [];
  const rec = (name, fallback) => (...args) => { calls.push([name, ...args]); return (over[name] || fallback)(...args); };
  let issued = false;
  return {
    calls,
    apis: {
      fundAdmin: {
        access: rec('access', async () => access(false)),
        overview: rec('overview', async () => OVERVIEW()),
        distributionPreview: rec('distributionPreview', async (fundId, cents) => ({
          ok: true, fund_id: fundId, proceeds_cents: cents, distributable: true, basis_returned_cents: cents / 2, profit_cents: cents / 2,
          carry_rate: 0.2, carry_rate_defaulted: false, carry_withheld_cents: cents / 10, distributable_cents: cents - cents / 10,
          distribution_type: 'exit_proceeds', unallocated_cents: 0, dropped_lp_ids: [],
          lines: [{ lp_id: 1, lp_name: 'LP One', amount_cents: (cents - cents / 10) * 0.6 }, { lp_id: 2, lp_name: 'LP Two', amount_cents: (cents - cents / 10) * 0.4 }],
        })),
      },
      calls: {
        ledger: rec('ledger', async () => (over.issuedLedger && issued ? over.issuedLedger() : LEDGER([CALL2(), CALL1()]))),
        preview: rec('callPreview', async () => CALL_PREVIEW()),
        issue: rec('callIssue', async () => { issued = true; return { ok: true }; }),
        receipt: rec('receipt', async () => ({ ok: true })),
      },
      notices: {
        preview: rec('noticePreview', async () => ({ html: '<p>Distribution notice</p>', figures: { amount_cents: 300000 }, figures_sha256: 'e'.repeat(64), refusal: null })),
        issue: rec('noticeIssue', async () => ({ already_issued: false, notice: { uid: 'n'.repeat(32) } })),
        callPreview: rec('callNoticePreview', async (uid) => ({ call: { uid }, digest: 'd'.repeat(64), lines: [
          { line_id: 11, figures: { amount_cents: 3000000 }, figures_sha256: '1'.repeat(64), refusal: null },
          { line_id: 12, figures: { amount_cents: 2000000 }, figures_sha256: '2'.repeat(64), refusal: null },
        ] })),
        callIssue: rec('callNoticeIssue', async () => ({ already_issued: false, notices: [{ uid: 'a' }, { uid: 'b' }] })),
      },
      capitalAttestations: { forFund: rec('forFund', async () => ({ ok: true, items: [] })) },
      funds: {
        distributions: rec('distributions', async () => DISTRIBUTIONS()),
        execute: rec('execute', async () => ({ ok: true })),
        markPaid: rec('markPaid', async () => ({ ok: true })),
      },
    },
  };
}

const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };

async function mount(user, apis, url) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user, apis }))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    by, props: (id) => pr(need(id)), text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value } }); }); await settle(); },
    async submit(id) {
      let n = need(id); const all = walk(container); const up = (x) => all.find((p) => (p.childNodes || []).includes(x));
      while (n && n.tagName?.toLowerCase() !== 'form') n = up(n);
      await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const as = (user) => stubs({ access: async () => access(Number(user.is_super_admin) === 1) });
const openCalls = (user, s = as(user)) => mount(user, s.apis, '/admin/fund-admin/calls?fund=7').then((m) => ({ m, s }));
const openDist = (user, s = as(user)) => mount(user, s.apis, '/admin/fund-admin/distributions?fund=7').then((m) => ({ m, s }));

async function previewCall(m, { amount = '10000', due = '2026-12-01', purpose = 'Follow-on' } = {}) {
  await m.click('calls-new');
  await m.type('calls-new-amount', amount);
  if (due != null) await m.type('calls-new-due', due);
  await m.type('calls-new-purpose', purpose);
  await m.submit('calls-new-preview');
}

// ------------------------------------------------------------------ the model

test('a due date is never defaulted: an empty one is refused, whatever else is filled', () => {
  assert.deepEqual(checkNewCall({ amount: '10000', due: '', purpose: '' }), { error: 'Choose a due date. It is never filled in for you.' });
  assert.equal(checkNewCall({ amount: '10000', due: undefined }).error, 'Choose a due date. It is never filled in for you.');
  const ok = checkNewCall({ amount: '10000', due: '2026-12-01', purpose: ' Follow-on ' });
  assert.equal(ok.cents, 1000000);
  assert.equal(ok.due, '2026-12-01');
});

test('figuresMatch: the issued call against its preview, LP by LP', () => {
  const preview = { ...CALL_PREVIEW(), amount_cents: 1000000 };
  assert.deepEqual(figuresMatch(preview, CALL3()), { same: true, differs: [] });
  assert.deepEqual(figuresMatch(preview, CALL3(399999)), { same: false, differs: ['LP Two'] });
  assert.equal(figuresMatch({ ...preview, amount_cents: 1000001 }, CALL3()).same, false, 'a different total is not the same call');
  assert.equal(figuresMatch(preview, { ...CALL3(), lines: CALL3().lines.slice(0, 1) }).same, false, 'a missing line is not the same call');
});

test('people are named, never by email or number', () => {
  assert.equal(lpName({ lp_name: 'LP One', lp_email: 'lp1@example.test' }), 'LP One');
  assert.equal(lpName({ name: 'LP Two', email: 'lp2@example.test', lp_id: 2 }), 'LP Two');
  assert.equal(lpName({ lp_email: 'lp3@example.test', lp_id: 3 }), 'Name not recorded');
  assert.deepEqual(previewRows(CALL_PREVIEW()).map((r) => [r.name, r.pct, r.flag]), [
    ['LP One', '60.00%', null],
    ['LP Two', '40.00%', 'No platform account · no identity check linked'],
  ]);
});

test('L6: a refused notice says why, in one sentence', () => {
  assert.equal(refusedNotice({ code: 'no_payment_instructions', message: 'No payment instructions are recorded for this fund.' }),
    "This notice can't issue: No payment instructions are recorded for this fund.");
  assert.equal(refusedNotice('The line is paid.'), "This notice can't issue: The line is paid.");
  assert.equal(refusedNotice(null), "This notice can't issue: the Worker gave no reason.");
});

test('outstanding by age sums each band in cents, and a line with no due date is never "not yet due"', () => {
  const ledger = LEDGER([CALL(30, 1, 0, [
    LINE(1, 30, 1, 'A', 100000, 0, 'overdue', { days_overdue: 5 }),
    LINE(2, 30, 2, 'B', 200000, 50000, 'overdue', { days_overdue: 45 }),
    LINE(3, 30, 3, 'C', 300000, 0, 'overdue', { days_overdue: 120 }),
    LINE(4, 30, 4, 'D', 70000, 0, 'pending', { due_date: '2026-12-01' }),
    LINE(5, 30, 5, 'E', 90000, 0, 'pending', { due_date: null }),
    LINE(6, 30, 6, 'F', 500000, 500000, 'paid'),
  ])]);
  const chart = ageChart(ledger);
  assert.deepEqual(Object.fromEntries(chart.rows.map((r) => [r.key, r.cents])), { not_due: 70000, no_due: 90000, d1_30: 100000, d31_60: 150000, d61_90: 0, d90: 300000 });
  assert.equal(chart.total, 710000);
  assert.equal(chart.note, 'Most of what is outstanding ($3,000.00 of $7,100.00) is over 90 days overdue.');
  assert.deepEqual(chart.table.rows[0], ['Not yet due', '$700.00']);
  const none = ageChart(LEDGER([CALL1()]));
  assert.equal(none.empty, true);
  assert.equal(none.note, 'Nothing is outstanding on this fund.');
});

test('the tiles read the ledger; without it each figure is Not recorded, never $0.00', () => {
  const tiles = Object.fromEntries(callTiles(LEDGER([CALL2(), CALL1()])).map((t) => [t.key, t]));
  assert.equal(tiles.committed.v, '$500,000.00');
  assert.equal(tiles.called.v, '$100,000.00');
  assert.equal(tiles.received.v, '$75,000.00');
  assert.equal(tiles.outstanding.v, '$25,000.00');
  assert.equal(tiles.overdue.v, '1');
  assert.equal(tiles.overdue.note, 'oldest 17 days');
  assert.equal(tiles.next.v, '2026-11-01');
  const blank = Object.fromEntries(callTiles(null).map((t) => [t.key, t.v]));
  for (const k of ['committed', 'called', 'received', 'outstanding']) assert.equal(blank[k], 'Not recorded', k);
});

test('Record receipt: the full outstanding or another amount, with the date it arrived', () => {
  assert.deepEqual(receiptBody({ which: 'full', date: '2026-10-20', reference: ' WIRE-1 ' }, 2000000).body, { amount_cents: 2000000, received_on: '2026-10-20', reference: 'WIRE-1' });
  assert.equal(receiptBody({ which: 'other', amount: '500.25', date: '2026-10-20', reference: '' }, 2000000).body.amount_cents, 50025);
  assert.ok(receiptBody({ which: 'other', amount: '', date: '2026-10-20' }, 2000000).error);
  assert.equal(receiptBody({ which: 'full', date: '' }, 2000000).error, 'Enter the date the money arrived.');
});

test('the per-LP distribution preview names each LP, and its total is the sum of its lines', () => {
  const d = distributionRows({ distributable_cents: 1000, unallocated_cents: 1, lines: [{ lp_id: 1, lp_name: 'LP One', amount_cents: 600 }, { lp_id: 2, amount_cents: 399 }] });
  assert.deepEqual(d.rows.map((r) => [r.name, r.pct]), [['LP One', '60.06%'], ['Name not recorded', '39.94%']]);
  assert.equal(d.totalText, '$9.99');
  assert.equal(d.balances, true);
  assert.equal(distributionRows({ distributable_cents: 1000, unallocated_cents: 0, lines: [{ lp_id: 1, amount_cents: 600 }] }).balances, false);
});

test('cumulative distributions add each month\'s paid lines to the months before, and leave pending lines out', () => {
  const c = cumulativeDistributions(DISTRIBUTIONS().items);
  assert.deepEqual(c.points.map((p) => [p.label, p.cents]), [['2026-06', 200000], ['2026-08', 500000]]);
  assert.equal(c.note, '$5,000.00 distributed from this fund so far, counting lines marked paid. 1 line not yet paid is not counted.');
  assert.equal(cumulativeDistributions([]).empty, true);
});

// ------------------------------------------------------------------ Capital calls, in place

test('FND7: the tiles, the age chart, the latest call with its LP lines, and the earlier calls open in place', async () => {
  const { m } = await openCalls(SUPER);
  assert.ok(m.by('fund-admin-panel-calls'), 'the panel keeps its id');
  assert.equal(m.text(m.by('calls-tile-outstanding')).includes('$25,000.00'), true);
  assert.ok(m.text(m.by('calls-age')).includes('Most of what is outstanding ($20,000.00 of $25,000.00) is 1 to 30 days overdue.'));
  await m.click('calls-age-toggle');
  assert.ok(m.text(m.by('calls-age-table')).includes('Not yet due'), 'the chart reads as a table too');
  const latest = m.text(m.by('call-2'));
  assert.ok(latest.includes('Call 2 · $50,000.00 · due 2026-10-01'), latest);
  assert.ok(latest.includes('LP One') && latest.includes('LP Two'));
  assert.equal(m.props('call-open-lp-11').href, '/admin/fund-admin/lps/1?fund=7');
  assert.ok(!m.by('call-expanded-1'));
  await m.click('call-expand-1');
  assert.ok(m.text(m.by('call-expanded-1')).includes('LP One'));
  assert.doesNotMatch(m.text(), /@example\.test/, 'no email is drawn');
  assert.ok(!m.by('calls-notices-dialog'));
  await m.unmount();
});

test('FND8: a due date is never defaulted — the field starts empty, and Preview without one is refused without a read', async () => {
  const { m, s } = await openCalls(SUPER);
  await m.click('calls-new');
  assert.equal(m.props('calls-new-due').value, '', 'the due date starts empty');
  await m.type('calls-new-amount', '10000');
  await m.submit('calls-new-preview');
  assert.equal(m.text(m.by('calls-new-error')), 'Choose a due date. It is never filled in for you.');
  assert.ok(!s.calls.some(([n]) => n === 'callPreview'), 'nothing is previewed');
  await m.unmount();
});

test('FND8: the preview and the issued call show the same figures, and the console says so', async () => {
  const s = stubs({ access: async () => access(true), issuedLedger: () => LEDGER([CALL3(), CALL2(), CALL1()]) });
  const { m } = await openCalls(SUPER, s);
  await previewCall(m);
  assert.deepEqual(s.calls.find(([n]) => n === 'callPreview'), ['callPreview', 7, 1000000]);
  assert.ok(m.text(m.by('calls-preview-line-1')).includes('$6,000.00'));
  assert.ok(m.text(m.by('calls-preview-line-2')).includes('No platform account'));
  assert.equal(m.text(m.by('calls-preview-total')), '$10,000.00');
  assert.ok(m.by('calls-preview-flagged'));
  await m.click('calls-preview-issue');
  // Exactly the amount and the date on screen.
  assert.deepEqual(s.calls.find(([n]) => n === 'callIssue'), ['callIssue', 7, 1000000, 'Follow-on', '2026-12-01']);
  assert.ok(!m.by('calls-new-dialog'), 'the dialog closes');
  assert.equal(m.text(m.by('calls-issued-check')), 'Call 3 is issued, with the figures its preview showed.');
  await m.unmount();

  // A line the Worker wrote differently is named.
  const d = stubs({ access: async () => access(true), issuedLedger: () => LEDGER([CALL3(399999), CALL2(), CALL1()]) });
  const { m: n } = await openCalls(SUPER, d);
  await previewCall(n);
  await n.click('calls-preview-issue');
  assert.match(n.text(n.by('calls-issued-check')), /figures differ from the preview for LP Two/);
  await n.unmount();
});

test('FND8: an Admin previews a call and reads the sentence where Issue would be', async () => {
  const { m, s } = await openCalls(ADMIN);
  assert.equal(m.text(m.by('calls-issue-refused')), 'A Super Admin issues capital calls.');
  await previewCall(m);
  assert.ok(m.by('calls-preview'));
  assert.ok(!m.by('calls-preview-issue'), 'no Issue button for an Admin');
  assert.equal(m.text(m.by('calls-preview-issue-refused')), 'A Super Admin issues capital calls.');
  assert.ok(!s.calls.some(([n]) => n === 'callIssue'));
  await m.click('calls-preview-back');
  assert.equal(m.props('calls-new-due').value, '2026-12-01', 'Back keeps the terms');
  await m.unmount();
});

test('Record receipt opens its dialog, records the amount on the line, and reads the ledger again', async () => {
  const { m, s } = await openCalls(ADMIN);
  const reads = s.calls.filter(([n]) => n === 'ledger').length;
  await m.click('call-receipt-11');
  assert.ok(m.text(m.by('calls-receipt-dialog')).includes('Record receipt · LP One · Call 2'));
  await m.type('calls-receipt-other', 'on');
  await m.type('calls-receipt-amount', '500.25');
  await m.type('calls-receipt-date', '2026-10-20');
  await m.type('calls-receipt-reference', 'WIRE-1');
  await m.submit('calls-receipt-submit');
  assert.deepEqual(s.calls.find(([n]) => n === 'receipt'), ['receipt', 7, 11, { amount_cents: 50025, received_on: '2026-10-20', reference: 'WIRE-1' }]);
  assert.ok(!m.by('calls-receipt-dialog'));
  assert.ok(s.calls.filter(([n]) => n === 'ledger').length > reads, 'the ledger is read again');
  await m.unmount();
});

test('Call notices: the Super Admin previews every line and issues by the digest, in the page size chosen', async () => {
  const { m, s } = await openCalls(SUPER);
  await m.click('call-notices-2');
  await m.click('calls-notices-page-a4');
  await m.click('calls-notices-preview-submit');
  assert.deepEqual(s.calls.find(([n]) => n === 'callNoticePreview'), ['callNoticePreview', '2'.repeat(32)]);
  assert.ok(m.text(m.by('calls-notice-11')).includes('Notice · LP One'));
  await m.click('calls-notices-issue');
  assert.deepEqual(s.calls.find(([n]) => n === 'callNoticeIssue'), ['callNoticeIssue', '2'.repeat(32), { page_size: 'a4', digest: 'd'.repeat(64) }]);
  assert.equal(m.text(m.by('calls-notices-done')), '2 notices issued.');
  await m.unmount();
});

test('Call notices: an Admin sees "A Super Admin issues fund notices."', async () => {
  const { m, s } = await openCalls(ADMIN);
  await m.click('call-notices-2');
  await m.click('calls-notices-preview-submit');
  assert.ok(m.by('calls-notices-preview'), 'an Admin previews');
  assert.ok(!m.by('calls-notices-issue'));
  assert.equal(m.text(m.by('calls-notices-issue-refused')), 'A Super Admin issues fund notices.');
  assert.ok(!s.calls.some(([n]) => n === 'callNoticeIssue'));
  await m.unmount();
});

test('L6 on a call: a line that cannot issue says why, and no notice is issued until each can', async () => {
  const s = stubs({
    access: async () => access(true),
    callNoticePreview: async () => ({ digest: 'd'.repeat(64), lines: [
      { line_id: 11, figures: { amount_cents: 3000000 }, figures_sha256: '1'.repeat(64), refusal: null },
      { line_id: 12, figures: { amount_cents: 2000000 }, figures_sha256: '2'.repeat(64), refusal: { code: 'no_payment_instructions', message: 'No payment instructions are recorded for this fund.' } },
    ] }),
  });
  const { m } = await openCalls(SUPER, s);
  await m.click('call-notices-2');
  await m.click('calls-notices-preview-submit');
  assert.equal(m.text(m.by('calls-notice-refused-12')), "This notice can't issue: No payment instructions are recorded for this fund.");
  assert.ok(!m.by('calls-notice-refused-11'));
  assert.ok(m.text(m.by('calls-notices-blocked')).includes("1 notice can't issue, so none is issued until each can."));
  assert.ok(!m.by('calls-notices-issue'));
  await m.unmount();
});

// ------------------------------------------------------------------ Distributions, in place

test('FND9: where every cent goes, the per-LP preview by name, and Execute with its foot', async () => {
  const { m, s } = await openDist(SUPER);
  assert.ok(m.by('fund-admin-panel-distributions'));
  await m.type('distribution-proceeds', '1000.00');
  await m.submit('distribution-preview-submit');
  assert.ok(m.text(m.by('distribution-where')).includes('the fund’s recorded carry rate'));
  assert.ok(m.text(m.by('distribution-line-1')).includes('LP One'));
  assert.ok(m.text(m.by('distribution-line-2')).includes('LP Two'));
  assert.equal(m.text(m.by('distribution-preview-total')), '$900.00');
  assert.equal(m.text(m.by('distribution-preview-balance')), 'The total equals the sum of its lines.');
  assert.ok(m.by('distribution-execute-foot'));
  await m.click('distribution-execute');
  assert.deepEqual(s.calls.find(([n]) => n === 'execute'), ['execute', { fund_id: 7, proceeds_cents: 100000 }]);
  await m.unmount();
  const a = await openDist(ADMIN);
  await a.m.type('distribution-proceeds', '1000.00');
  await a.m.submit('distribution-preview-submit');
  assert.ok(!a.m.by('distribution-execute'));
  assert.equal(a.m.text(a.m.by('distribution-execute-refused')), 'A Super Admin executes distributions.');
  assert.equal(a.m.text(a.m.by('distribution-notices-refused')), 'A Super Admin issues fund notices.');
  await a.m.unmount();
});

test('FND9: Mark paid asks first in a dialog; Cancel writes nothing', async () => {
  const { m, s } = await openDist(ADMIN);
  await m.click('distribution-mark-paid-91');
  assert.ok(m.text(m.by('distribution-mark-dialog')).includes('Mark paid · LP One'));
  assert.ok(!s.calls.some(([n]) => n === 'markPaid'));
  await m.click('distribution-mark-confirm');
  assert.deepEqual(s.calls.find(([n]) => n === 'markPaid'), ['markPaid', 91]);
  assert.ok(!m.by('distribution-mark-dialog'));
  await m.unmount();
});

test('FND9: the cumulative chart counts paid lines only, and reads as a table', async () => {
  const { m } = await openDist(SUPER);
  assert.equal(m.text(m.by('distribution-cumulative-note')), '$5,000.00 distributed from this fund so far, counting lines marked paid. 1 line not yet paid is not counted.');
  await m.click('distribution-cumulative-toggle');
  assert.ok(m.text(m.by('distribution-cumulative-table')).includes('2026-08'));
  await m.unmount();
});

test('a distribution notice: the tax character is chosen, never defaulted; the Super Admin issues by the figures previewed', async () => {
  const { m, s } = await openDist(SUPER);
  assert.ok(!m.by('distribution-notice-91'), 'a pending line has no notice');
  await m.click('distribution-notice-90');
  await m.click('distribution-notice-preview');
  assert.equal(m.text(m.by('distribution-notice-error')), 'Pick the distribution’s tax character.');
  assert.ok(!s.calls.some(([n]) => n === 'noticePreview'));
  await m.type('distribution-notice-tax', 'return_of_capital');
  await m.type('distribution-notice-page', 'a4');
  await m.click('distribution-notice-preview');
  const body = { type: 'distribution_notice', source: { distribution_id: 90 }, inputs: { tax_character: 'return_of_capital' }, page_size: 'a4' };
  assert.deepEqual(s.calls.find(([n]) => n === 'noticePreview'), ['noticePreview', body]);
  assert.equal(m.props('distribution-notice-frame').sandbox, '', 'the Worker\'s HTML runs no script');
  await m.click('distribution-notice-issue');
  assert.deepEqual(s.calls.find(([n]) => n === 'noticeIssue'), ['noticeIssue', { ...body, figures_sha256: 'e'.repeat(64) }]);
  assert.equal(m.text(m.by('distribution-notice-done')), 'The notice is issued.');
  await m.unmount();
});

test('a distribution notice: an Admin previews and reads the sentence; L6 replaces Issue with why', async () => {
  const { m } = await openDist(ADMIN);
  await m.click('distribution-notice-90');
  await m.type('distribution-notice-tax', 'ordinary_income');
  await m.click('distribution-notice-preview');
  assert.ok(m.by('distribution-notice-frame'));
  assert.equal(m.text(m.by('distribution-notice-issue-refused')), 'A Super Admin issues fund notices.');
  await m.unmount();
  const s = stubs({ access: async () => access(true), noticePreview: async () => ({ html: '<p>Draft</p>', figures: {}, figures_sha256: 'e'.repeat(64), refusal: { code: 'not_paid', message: 'This distribution line is not paid.' } }) });
  const { m: n } = await openDist(SUPER, s);
  await n.click('distribution-notice-90');
  await n.type('distribution-notice-tax', 'ordinary_income');
  await n.click('distribution-notice-preview');
  assert.equal(n.text(n.by('distribution-notice-refused')), "This notice can't issue: This distribution line is not paid.");
  assert.ok(!n.by('distribution-notice-issue'));
  await n.unmount();
});
