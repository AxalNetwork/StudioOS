/**
 * D6236 (#6236) — Fund · LPs: the LP record drawer (FV4), opened by `?lp=<id>`
 * from a register row or an LP's name on a call line.
 *
 * Mutations checked: 11, all caught (each failed a test here, then was restored):
 *   · kycOf: an LP with no account read as pending, not "No account";
 *   · callLines: receipts summed across every line, not the line's own;
 *   · callLines: outstanding without the floor at zero;
 *   · callLines: a line marked paid with no receipt read as owing its whole call;
 *   · calledToDate: a truncated ledger totalled anyway;
 *   · commBody: an empty subject posted;
 *   · the view: the comms block keyed to the ledger's loading or unreadable state;
 *   · the form: one Worker kind left out;
 *   · LineTable: the LP name drawn without the link to the record;
 *   · the page: closing dropped `?fund=` instead of `?lp=`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  callLines, calledToDate, commBody, distributionRow, dollarsText, kycOf, lpaOf, lpParam, statementOf,
} from '../src/pages/investor/fundLpRecordModel.js';
import { LpRecordView, LogMessageForm } from '../src/pages/investor/InvestorFundLpRecord.jsx';
import { LpRecordSlot } from '../src/pages/investor/InvestorFundLPs.jsx';
import { LineTable } from '../src/pages/investor/InvestorFundCalls.jsx';
import { COMM_KIND_LABELS } from '../src/pages/investor/fundLpCommsModel.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const FUND = { id: 12, name: 'Fund One' };
const LP = { id: 41, name: 'Office A', email: 'office-a@example.test', status: 'committed', lp_type: 'family_office', account_user_id: 9, kyc_status: 'approved', lpa_signed: 1, lpa_signed_at: '2025-10-20 10:00:00', commitment_date: '2025-10-14' };
const FIGURES = { commitment: '$5,000,000', share: '50.0%', paid: '$1,025,000' };
const ENTRIES = [
  { kind: 'line', id: 7, call_number: 2, amount_cents: 72916666, due_date: '2026-12-02', status: 'pending' },
  { kind: 'line', id: 5, call_number: 1, amount_cents: 50000000, due_date: '2026-04-15', status: 'paid' },
  { kind: 'line', id: 3, call_number: null, amount_cents: 12500000, due_date: null, status: 'paid' },
  { kind: 'receipt', id: 90, capital_call_id: 7, amount_cents: 40000000, received_on: '2026-11-11', reference: 'FO-A-C2-01' },
  { kind: 'receipt', id: 80, capital_call_id: 5, amount_cents: 50000000, received_on: '2026-04-10', reference: null },
];
const ready = (data) => ({ status: 'ready', data, reload: () => {} });
const failed = { status: 'unreadable', data: null, reload: () => {} };
const loading = { status: 'loading', data: null, reload: () => {} };
const REPORT = { performance: [{ commitment: 5000000, invested_amount: 1025000, distributions_dollars: 62500, tvpi: null }], distributions: [{ id: 1, amount_cents: 6250000, distribution_type: 'return_of_capital', status: 'paid', distributed_at: '2026-09-25' }], capital_statements: [], capital_statements_recorded: true };
const COMMS = { items: [{ id: 3, kind: 'call_reminder', subject: 'Call 2 still open', sent_at: '2026-11-12', logged_by_name: 'GP' }] };
const view = (over = {}) => h(LpRecordView, { fund: FUND, lp: LP, figures: FIGURES, ledger: ready({ entries: ENTRIES, truncated: false }), comms: ready(COMMS), report: ready(REPORT), onClose: () => {}, ...over });

test('?lp= is an LP id or nothing', () => {
  assert.equal(lpParam('41'), 41);
  for (const bad of [null, '', '0', '-3', '4x', '1.5', ' ']) assert.equal(lpParam(bad), null, String(bad));
});

test('KYC: no account reads "No account" with its source, never pending', () => {
  assert.deepEqual(kycOf({ account_user_id: null, kyc_status: null }).label, 'No account');
  assert.match(kycOf({ account_user_id: null }).source, /No platform account/);
  assert.equal(kycOf({ account_user_id: 3, kyc_status: '' }).label, 'Not recorded');
  const ok = kycOf({ account_user_id: 3, kyc_status: 'approved' });
  assert.equal(ok.label, 'Approved'); assert.equal(ok.tone, 'ok'); assert.match(ok.source, /linked account/);
  assert.equal(kycOf({ account_user_id: 3, kyc_status: 'in_review' }).tone, 'wait');
});

test('LPA: signed with its date, signed with none recorded, or not signed', () => {
  assert.equal(lpaOf(LP).label, 'Signed 2025-10-20');
  assert.equal(lpaOf({ lpa_signed: 1 }).label, 'Signed · date not recorded');
  assert.equal(lpaOf({ lpa_signed: 0 }).label, 'Not signed');
});

test('each call line carries its own receipts; outstanding floors at zero; a gap stays null', () => {
  const { lines, loose } = callLines(ENTRIES);
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(byId[7].received, 40000000);
  assert.equal(byId[7].outstanding, 32916666);
  assert.equal(byId[7].state, 'Part received');
  assert.equal(byId[5].outstanding, 0);
  assert.equal(byId[5].state, 'Paid');
  assert.equal(byId[3].call, 'Before numbering');
  assert.equal(byId[3].received, null, 'a line marked paid with no receipt has no received figure on record');
  assert.equal(byId[3].outstanding, 0);
  assert.equal(byId[3].state, 'Paid · no receipt recorded');
  assert.deepEqual(loose, []);
  const over = callLines([{ kind: 'line', id: 1, amount_cents: 100 }, { kind: 'receipt', id: 2, capital_call_id: 1, amount_cents: 150 }]);
  assert.equal(over.lines[0].outstanding, 0, 'an overpaid line owes nothing, not a negative');
  const gap = callLines([{ kind: 'line', id: 1, amount_cents: null }]);
  assert.equal(gap.lines[0].owed, null);
  assert.equal(gap.lines[0].outstanding, null);
  assert.equal(callLines([{ kind: 'line', id: 1, amount_cents: 0, status: 'paid' }]).lines[0].state, 'Paid · no receipt recorded');
  assert.equal(callLines([{ kind: 'receipt', id: 9, capital_call_id: 99, amount_cents: 5 }]).loose.length, 1);
});

test('called to date: the owed sum, or null when the ledger was cut short or a figure is missing', () => {
  const { lines } = callLines(ENTRIES);
  assert.equal(calledToDate(lines, false), 72916666 + 50000000 + 12500000);
  assert.equal(calledToDate(lines, true), null);
  assert.equal(calledToDate(callLines([{ kind: 'line', id: 1, amount_cents: null }]).lines, false), null);
  assert.equal(calledToDate([], false), 0, 'no line at all is nothing called, a fact rather than a gap');
});

test('Log a message posts only what the Worker takes, for this LP', () => {
  const svc = read('cloudflare-worker/src/services/fundLpComms.ts');
  const kinds = [...svc.match(/export const COMM_KINDS = \[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const form = html(h(LogMessageForm, { form: { kind: 'update', subject: '', sentOn: '2026-11-14', callId: '', error: '' }, setForm: () => {}, onSubmit: () => {}, lines: [] }));
  const offered = [...form.matchAll(/data-testid="radio-lp-record-kind-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(offered, kinds);
  assert.deepEqual(Object.keys(COMM_KIND_LABELS), kinds);
  assert.deepEqual(commBody(41, { kind: 'call_notice', subject: '  Call 2 notice ', sentOn: '2026-11-02', callId: '7' }).body,
    { lp_id: 41, kind: 'call_notice', subject: 'Call 2 notice', sent_at: '2026-11-02', capital_call_id: 7 });
  assert.equal(commBody(41, { kind: 'update', subject: 'x', sentOn: '2026-11-02', callId: '' }).body.capital_call_id, undefined);
  assert.match(commBody(41, { kind: 'update', subject: '  ', sentOn: '2026-11-02' }).error, /subject/);
  assert.match(commBody(41, { kind: 'update', subject: 'x'.repeat(201), sentOn: '2026-11-02' }).error, /200/);
  assert.match(commBody(41, { kind: 'update', subject: 'x', sentOn: '' }).error, /date/);
  // The drawer posts through the existing client method, which hits the mounted route.
  const drawer = read('frontend/src/pages/investor/InvestorFundLpRecord.jsx');
  assert.match(drawer, /api\.fundsLogComm\(fund\.id, body\)/);
  assert.match(read('cloudflare-worker/src/routes/funds.ts'), /funds\.post\('\/:id\/comms'/);
});

test('a refused log shows its own sentence, and nothing says it was logged', () => {
  const out = text(h(LogMessageForm, { form: { kind: 'update', subject: 'x', sentOn: '2026-11-14', callId: '', error: 'A message cannot be logged as sent in the future.' }, setForm: () => {}, onSubmit: () => {}, lines: [] }));
  assert.match(out, /cannot be logged as sent in the future/);
  assert.doesNotMatch(out, /The body is not stored/);
});

test('the drawer shows commitment, share, paid, called, type, LPA, KYC with source, each line and receipt, comms and statement', () => {
  const out = text(view());
  for (const want of ['$5,000,000', '50.0%', '$1,025,000', '$1,354,166.66', 'Family office', 'Signed 2025-10-20', 'Approved', 'From their linked account.',
    'Call 2', 'Due 2026-12-02', '$729,166.66', '$400,000.00', '2026-11-11 · FO-A-C2-01', '$329,166.66', 'Part received', 'Before numbering', 'Paid · no receipt recorded',
    'Call 2 still open', 'Call reminder', '$62,500.00', 'Return of capital', 'Not recorded · nothing paid in', 'No capital statement has been issued to this LP.']) {
    assert.ok(out.includes(want), `missing "${want}"`);
  }
  assert.match(html(view()), /href="\/funds\/reporting\?fund=12"/);
});

test('each block fails on its own, with Retry', () => {
  const calls = text(view({ ledger: failed }));
  assert.match(calls, /This LP's calls and receipts could not be read\. This is not a claim that no money has moved\. Retry/);
  assert.ok(calls.includes('Call 2 still open'), 'a failed ledger blanked the comms log');
  assert.ok(calls.includes('$62,500.00'), 'a failed ledger blanked the statement');
  assert.match(calls, /Called to date Unavailable/);
  const comms = text(view({ comms: failed }));
  assert.match(comms, /This LP's comms log could not be read\. This is not a claim that nothing was sent\. Retry/);
  assert.ok(comms.includes('$329,166.66'));
  const st = text(view({ report: failed }));
  assert.match(st, /This LP's statement could not be read\./);
  assert.ok(st.includes('Call 2 still open') && st.includes('$329,166.66'));
  for (const key of ['ledger', 'comms', 'report']) {
    const one = html(view({ [key]: loading }));
    assert.equal((one.match(/i6-skeleton/g) || []).length, 1, `${key} loading drew the wrong number of skeletons`);
  }
  assert.doesNotMatch(text(view({ comms: loading })), /Nothing has been logged/, 'a loading log read as empty');
  const all = html(view({ ledger: loading, comms: loading, report: loading }));
  assert.equal((all.match(/i6-skeleton/g) || []).length, 3);
});

test('an LP with no account reads "No account", not pending; empty reads say what is empty', () => {
  const out = text(view({ lp: { ...LP, account_user_id: null, kyc_status: null, lpa_signed: 0 }, ledger: ready({ entries: [], truncated: false }), comms: ready({ items: [] }), report: ready({ performance: [], distributions: [], capital_statements_recorded: false }) }));
  assert.match(out, /KYC No account/);
  assert.doesNotMatch(out, /KYC Pending/i);
  assert.match(out, /Not signed/);
  for (const want of ['No capital call has a line for this LP yet.', 'Nothing has been logged as sent to this LP.', 'No position for this LP came back', 'No distribution to this LP is recorded.', 'The issued statements could not be read.']) {
    assert.ok(out.includes(want), want);
  }
});

test('a truncated ledger does not total called to date', () => {
  const out = text(view({ ledger: ready({ entries: ENTRIES, truncated: true }) }));
  assert.match(out, /Called to date Not recorded/);
  assert.match(out, /Only the newest entries are shown/);
});

test('an id that is not on the register says so', () => {
  const out = text(h(LpRecordSlot, { fund: FUND, lp: null, lpId: 999, totalCommitted: 10, onClose: () => {} }));
  assert.match(out, /No LP with this id is on this fund's register\./);
});

test('the drawer opens by ?lp=, closes by dropping it, and is the shared Sheet (Escape, phone full page)', () => {
  const page = read('frontend/src/pages/investor/InvestorFundLPs.jsx');
  assert.match(page, /const openLpId = lpParam\(params\.get\('lp'\)\)/);
  assert.match(page, /next\.set\('lp', String\(id\)\)/);
  assert.match(page, /next\.delete\('lp'\)/);
  assert.match(page, /button-open-lp-\$\{lp\.id\}/);
  const drawer = read('frontend/src/pages/investor/InvestorFundLpRecord.jsx');
  assert.match(drawer, /<Sheet [^>]*onClose=\{onClose\}/);
  assert.doesNotMatch(drawer, /phone=/, 'the drawer keeps the Sheet\'s full-page phone default');
  assert.match(read('frontend/src/ui/Sheet.jsx'), /Escape/);
});

test('the three per-LP reads are the existing routes, each with the LP id', () => {
  const drawer = read('frontend/src/pages/investor/InvestorFundLpRecord.jsx');
  assert.match(drawer, /api\.fundsLedger\(fund\.id, lp\.id\)/);
  assert.match(drawer, /api\.fundsCommsList\(fund\.id, lp\.id\)/);
  assert.match(drawer, /api\.fundsLpReport\(fund\.id, lp\.id\)/);
  const worker = read('cloudflare-worker/src/routes/funds.ts');
  assert.match(worker, /funds\.get\('\/:id\/ledger'[\s\S]{0,200}?c\.req\.query\('lp'\)/);
  assert.match(worker, /funds\.get\('\/:id\/comms'[\s\S]{0,200}?c\.req\.query\('lp'\)/);
  assert.match(worker, /funds\.get\('\/:id\/lp-report\/:lpId'/);
});

test('an LP name on a call line links to their record; without a link builder it stays text', () => {
  const lines = [{ id: 5, limited_partner_id: 41, lp_name: 'Office A', state: 'pending', owed_cents: 100, received_cents: 0, commitment_cents: 1000 }];
  const linked = html(h(LineTable, { lines, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {}, lpHref: (id) => `/funds/lps?fund=12&lp=${id}` }));
  assert.match(linked, /<a [^>]*data-testid="link-lp-record-5"[^>]*href="\/funds\/lps\?fund=12&amp;lp=41"/);
  const plain = html(h(LineTable, { lines, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {} }));
  assert.doesNotMatch(plain, /link-lp-record/);
  assert.match(read('frontend/src/pages/investor/InvestorFundCalls.jsx'), /lpHref=\{lpHref\}/);
});

test('statement and distribution helpers never print a gap as zero', () => {
  assert.equal(dollarsText(null), 'Not recorded');
  assert.equal(dollarsText(62500), '$62,500.00');
  const st = statementOf({ performance: [{ commitment: '5000000', invested_amount: null }], capital_statements_recorded: true });
  assert.equal(st.paidIn, null);
  assert.equal(st.commitment, 5000000);
  assert.equal(statementOf(null).found, false);
  assert.equal(distributionRow({ amount_cents: null, status: 'pending' }).amount, 'Not recorded');
  assert.equal(distributionRow({ amount_cents: 5, status: 'pending' }).on, 'Not paid yet');
});

test('dark mode: every hover the drawer adds has its dark counterpart', () => {
  const css = read('frontend/src/pages/investor/investorFundLpRecord.css');
  const hovers = [...css.matchAll(/(?:^|[},])\s*(\.[\w.-]+(?:\s+[\w.-]+)?):hover/g)].map((m) => m[1]).filter((sel) => !sel.startsWith('.dark') && !/strong$/.test(sel));
  for (const sel of hovers) {
    const background = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:hover\\{background`).test(css);
    if (background) assert.ok(css.includes(`.dark ${sel}:hover`), `${sel}:hover has no dark value`);
  }
  assert.match(css, /\.dark \.lpr\{/);
});
