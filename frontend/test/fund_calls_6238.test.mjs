/**
 * D6238 (#6238) — Fund · Calls: the list of calls, one call's page, its
 * correction and withdrawal, the chase, and the New call preview's KYC flag.
 *
 * The Worker half (the read, the correct and withdraw acts, their gate and
 * the withdraw rule on real SQLite) is in
 * `cloudflare-worker/test/fund_call_amend_6238.test.ts`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_calls_6238.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  callRows, linesBehind, latestCall, withdrawRule, kycFlag, kycFlagged, linesFor, lineStateLabel,
} from '../src/pages/investor/fundCallsModel.js';
import { CallList, CallComposer, ReminderQueue, CALLS_INTRO } from '../src/pages/investor/InvestorFundCalls.jsx';
import { INVESTOR_ZONE_ACTIONS } from '../src/workspaces/investorZoneActions.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const line = (id, o = {}) => ({
  id, limited_partner_id: id * 10, lp_name: `LP ${id}`, state: 'pending', owed_cents: 10_000, received_cents: 0,
  outstanding_cents: 10_000, receipt_count: 0, commitment_cents: 100_000, due_date: '2099-01-31', ...o,
});
const CALL_2 = {
  id: 22, call_number: 2, amount_cents: 30_000, created_at: '2026-11-02 09:00:00', due_date: '2099-01-31', purpose: 'Reserve',
  received_cents: 10_000, outstanding_cents: 20_000, line_count: 3, withdrawn: false,
  amendments: [{ id: 1, kind: 'due_date', old_value: '2099-01-15', new_value: '2099-01-31', at: '2026-11-03 10:00:00', by_name: 'Gee Pee' }],
  lines: [line(1, { state: 'paid', received_cents: 10_000, outstanding_cents: 0, receipt_count: 1 }), line(2), line(3, { state: 'part_received', received_cents: 4_000, outstanding_cents: 6_000, receipt_count: 1 })],
};
const CALL_3_WITHDRAWN = {
  id: 33, call_number: 3, amount_cents: 50_000, created_at: '2026-11-10 09:00:00', due_date: null, purpose: null,
  received_cents: 0, outstanding_cents: 0, line_count: 2, withdrawn: true,
  withdrawal: { at: '2026-11-11 08:00:00', by_name: 'Gee Pee', reason: 'Wrong fund' },
  amendments: [{ id: 2, kind: 'withdrawn', at: '2026-11-11 08:00:00', by_name: 'Gee Pee' }],
  lines: [line(4, { state: 'withdrawn', owed_cents: 0, outstanding_cents: 0 }), line(5, { state: 'withdrawn', owed_cents: 0, outstanding_cents: 0 })],
};
const LEDGER = { calls: [CALL_3_WITHDRAWN, CALL_2], unnumbered: [] };

// ── The list ────────────────────────────────────────────────────────────

test('All calls: one row per call with number, issued, due, amount, collected, outstanding and lines behind', () => {
  const rows = callRows(LEDGER);
  assert.deepEqual(rows.map((r) => r.call_number), [3, 2], 'newest first, as the Worker orders them');
  const two = rows[1];
  assert.equal(two.issued_on, '2026-11-02');
  assert.equal(two.due_date, '2099-01-31');
  assert.equal(two.amount_cents, 30_000);
  assert.equal(two.collected_cents, 10_000);
  assert.equal(two.outstanding_cents, 20_000);
  assert.equal(two.lines_behind, 2, 'the paid line is not behind');
  assert.equal(two.line_count, 3);
  assert.equal(two.corrected, true);
  const three = rows[0];
  assert.equal(three.withdrawn, true);
  assert.equal(three.lines_behind, null, 'a withdrawn call has no figure for lines behind, not 0');
  assert.equal(three.outstanding_cents, null);
  assert.equal(three.corrected, false, 'a withdrawal is not a correction');

  const markup = text(h(CallList, { rows, onOpen: () => {} }));
  for (const col of ['Call', 'Issued', 'Due', 'Amount', 'Collected', 'Outstanding', 'Lines behind']) assert.ok(markup.includes(col), col);
  assert.match(markup, /Call 2 .*2026-11-02 2099-01-31 \$300\.00 \$100\.00 \$200\.00 2 of 3 Open call 2/);
  assert.match(markup, /Call 3 Withdrawn .*No due date recorded \$500\.00 Withdrawn Withdrawn None/);
  assert.match(html(h(CallList, { rows, onOpen: () => {} })), /data-testid="button-open-call-22"/);
  assert.match(text(h(CallList, { rows: [], onOpen: () => {} })), /No numbered call has been issued/);
});

test('the current call skips a withdrawn one, and Outstanding never lists its lines', () => {
  assert.equal(latestCall(LEDGER).call_number, 2);
  assert.deepEqual(linesFor('latest', LEDGER).map((l) => l.id), [1, 2, 3]);
  assert.deepEqual(linesFor('outstanding', LEDGER).map((l) => l.id), [2, 3]);
  assert.deepEqual(linesBehind(CALL_2).map((l) => l.id), [2, 3]);
  assert.deepEqual(linesBehind(CALL_3_WITHDRAWN), []);
  assert.equal(lineStateLabel({ state: 'withdrawn' }), 'Withdrawn');
});

// ── The withdraw rule ───────────────────────────────────────────────────

test('withdraw: allowed only while no line has a receipt; a withdrawn call says who and when', () => {
  const clean = { ...CALL_2, lines: [line(2), line(3)] };
  assert.equal(withdrawRule(clean).allowed, true);
  const r = withdrawRule(CALL_2);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /^2 lines have a receipt recorded/);
  // A receipt is a receipt even before the line is paid.
  assert.equal(withdrawRule({ ...CALL_2, lines: [line(2, { receipt_count: 1, received_cents: 1 })] }).allowed, false);
  // A line marked paid before receipts existed has no receipt row, and still blocks.
  assert.equal(withdrawRule({ ...CALL_2, lines: [line(2, { state: 'paid', receipt_count: 0, received_cents: 0 })] }).allowed, false);
  const w = withdrawRule(CALL_3_WITHDRAWN);
  assert.equal(w.allowed, false);
  assert.equal(w.reason, 'Withdrawn 2026-11-11 by Gee Pee.');
  assert.equal(withdrawRule(null).allowed, false);
});

// ── The KYC flag ────────────────────────────────────────────────────────

const PREVIEW = {
  next_call_number: 4, amount_cents: 30_000, residual_cents: 0, excluded: [],
  lines: [
    { lp_id: 1, name: 'Approved Co', has_account: true, kyc_status: 'approved', commitment_cents: 1, share_cents: 10_000 },
    { lp_id: 2, name: 'Pending Co', has_account: true, kyc_status: 'pending', commitment_cents: 1, share_cents: 10_000 },
    { lp_id: 3, name: 'Paper LP', has_account: false, kyc_status: null, commitment_cents: 1, share_cents: 10_000 },
  ],
};

test('KYC: a pending KYC is called out as a warning before issue; no account is said apart, never as pending', () => {
  const flag = kycFlag(PREVIEW.lines);
  assert.equal(flag.notApproved, 1);
  assert.equal(flag.noAccount, 1);
  assert.match(flag.sentence, /^1 LP has KYC that is not approved: Pending Co\./);
  assert.match(flag.sentence, /1 LP has no platform account, so no KYC record: Paper LP\./);
  assert.doesNotMatch(flag.sentence, /not approved: [^.]*Paper LP/, 'an LP with no account was counted as pending');
  assert.equal(kycFlagged(PREVIEW.lines[2]), false);
  assert.equal(kycFlag([PREVIEW.lines[0]]), null, 'every LP approved: no warning');

  const markup = html(h(CallComposer, { composer: { amount: '300', due: '', purpose: '', preview: PREVIEW, error: '', busy: false }, setComposer: () => {}, onPreview: () => {}, onIssue: () => {}, acts: null }));
  assert.match(markup, /data-testid="warning-call-kyc"[^>]*>⚠ 1 LP has KYC that is not approved: Pending Co\./);
  assert.match(markup, /<b class="if2-kyc-flag">⚠ KYC pending<\/b>/, 'the pending line is not flagged in the table');
  assert.equal((markup.match(/if2-kyc-flag/g) || []).length, 1, 'only the pending line carries the flag');
  const clean = html(h(CallComposer, { composer: { amount: '300', due: '', purpose: '', preview: { ...PREVIEW, lines: [PREVIEW.lines[0]] }, error: '', busy: false }, setComposer: () => {}, onPreview: () => {}, onIssue: () => {}, acts: null }));
  assert.doesNotMatch(clean, /warning-call-kyc/);
});

// ── Send reminders ──────────────────────────────────────────────────────

test('Send reminders: one Eadwyn draft per line behind, each logged only on its own confirm, nothing sent', () => {
  const behind = linesBehind(CALL_2);
  const markup = html(h(ReminderQueue, { fund: { id: 1 }, call: CALL_2, lines: behind, onClose: () => {} }));
  assert.equal((markup.match(/Draft the reminder/g) || []).length, behind.length, 'not one draft per line behind');
  for (const l of behind) {
    assert.match(markup, new RegExp(`data-testid="chase-line-${l.id}"`));
    assert.match(markup, new RegExp(`data-testid="button-chase-log-${l.id}"`));
  }
  assert.doesNotMatch(markup, /chase-line-1"/, 'a paid line is in the chase');
  assert.match(markup, /0 of 2 lines logged/);
  assert.match(markup, /Nothing is sent from here; each is logged as sent only when you confirm it/);
  assert.doesNotMatch(markup, /<textarea[^>]*name="body"|>Send</, 'the chase offers to send');

  const page = read('frontend/src/pages/investor/InvestorFundCalls.jsx');
  const queue = page.slice(page.indexOf('export function ReminderQueue('));
  // The log is written only from the confirm handler, never on render or on draft.
  assert.equal((queue.match(/api\.fundsLogComm\(/g) || []).length, 1);
  assert.match(queue, /async function confirm\(e, line\) \{[\s\S]*api\.fundsLogComm\(fund\.id, \{ lp_id: line\.limited_partner_id, kind: 'call_reminder'/);
  assert.match(queue, /<ZoneDraft\s+surface="funds\/calls"\s+scopeKey=\{String\(line\.id\)\}/, 'the drafts are not the existing funds/calls surface');
  const op = INVESTOR_ZONE_ACTIONS['funds/calls'].find((a) => a.label === 'Send reminders');
  assert.deepEqual([op.kind, op.handler], ['handler', 'sendReminders']);
});

// ── The page ────────────────────────────────────────────────────────────

test('the intro names only what the page holds', () => {
  assert.equal(CALLS_INTRO, 'Numbered capital calls, each LP’s line, the receipts recorded against it and what was logged to each LP.');
  assert.doesNotMatch(CALLS_INTRO, /schedule|letter|delinquen|distribution/i);
  assert.ok(read('frontend/src/pages/investor/InvestorFundCalls.jsx').includes('intro={CALLS_INTRO}'));
});

test('the call page reads the call route, corrects and withdraws through the acts, and names the notice record', async () => {
  const page = read('frontend/src/pages/investor/InvestorFundCalls.jsx');
  assert.match(page, /fundCallsApi\.read\(fund\.id, callId\)/);
  assert.match(page, /<FundActControl access=\{acts\} act="capital_call\.correct"/);
  assert.match(page, /<FundActControl access=\{acts\} act="capital_call\.withdraw"/);
  assert.match(page, /rule\.allowed\s*\?\s*<button[^>]*data-testid="button-withdraw-call"/, 'Withdraw is offered without the rule');
  assert.match(page, /routes\/fund_notices\.ts/);

  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { calls.push([init.method || 'GET', String(url), init.body]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const { fundCallsApi } = await import('../src/lib/api.js');
    await fundCallsApi.read(1, 22);
    await fundCallsApi.correct(1, 22, { field: 'purpose', value: 'X' });
    await fundCallsApi.withdraw(1, 22, {});
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => [m, u.replace(/^.*\/api/, '')]), [
    ['GET', '/funds/1/capital-calls/22'],
    ['POST', '/funds/1/capital-calls/22/correct'],
    ['POST', '/funds/1/capital-calls/22/withdraw'],
  ]);
});

test('phone: calls and lines are cards at 390px, and their buttons are 44px targets', () => {
  const css = read('frontend/src/pages/investor/investorFundCalls.css');
  const phone = css.slice(css.lastIndexOf('@media(max-width:640px)'));
  assert.match(phone, /\.if2-desk\{display:none\}/);
  assert.match(phone, /\.if2-cards\{display:block\}/);
  assert.match(phone, /\.if2-tap,[^{]*\{min-height:44px;min-width:44px\}/);
  const markup = html(h(CallList, { rows: callRows(LEDGER), onOpen: () => {} }));
  assert.match(markup, /class="if2-table-wrap if2-desk"/);
  assert.match(markup, /<ul class="if2-cards"/);
  assert.match(markup, /class="if2-row-action if2-tap"[^>]*>Open call 2</);
});
