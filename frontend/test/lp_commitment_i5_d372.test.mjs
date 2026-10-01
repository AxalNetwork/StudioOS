/**
 * D372 — the LP workspace's My-commitment section (I5), and the two routes it
 * retires. The Worker half is pinned on real SQLite in
 * `cloudflare-worker/test/lp_portal_commitment_d372.test.ts`.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lp_commitment_i5_d372.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  commitmentsByFund, commitmentBar, callState, onboardingStatus,
} from '../src/lib/lpCommitmentModel.js';
import {
  scheduledLabel, schedulePassed, formatScheduleDate, PROCESS_STEPS,
} from '../src/lib/spinoutFundModel.js';
import { MyCommitment } from '../src/pages/SpinoutLabLpCommitment.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TODAY = '2026-09-28';

const PORTAL = {
  lp_holdings: [
    { id: 100, fund_id: 1, fund_name: 'Fund I', commitment_amount: 1000, invested_amount: 150, returns: 0,
      lpa_signed: 1, lpa_signed_at: '2026-03-02', status: 'committed' },
    { id: 101, fund_id: 2, fund_name: 'Fund II', commitment_amount: 500, invested_amount: 0, returns: 0, lpa_signed: 0 },
  ],
  performance: [
    { lp_id: 100, fund_id: 1, tvpi: 1.167, dpi: 0.167 },
    { lp_id: 101, fund_id: 2, tvpi: null, dpi: null },
  ],
  capital_calls_recorded: true,
  capital_calls: [
    { id: 10, fund_id: 1, call_number: 1, owed_cents: 30000, received_cents: 10000, status: 'pending', due_date: '2026-12-01', created_at: '2026-09-01' },
    { id: 12, fund_id: 1, call_number: null, owed_cents: 5000, received_cents: 0, status: 'paid', paid_date: '2026-01-10', created_at: '2026-01-01' },
    { id: 13, fund_id: 2, call_number: 1, owed_cents: 20000, received_cents: 0, status: 'pending', due_date: '2026-09-01', created_at: '2026-08-01' },
  ],
  distributions: [{ id: 1, fund_id: 1, amount_cents: 2500, status: 'paid', distributed_at: '2026-06-30' }],
  funds: { 1: { gp: { name: 'Grace GP', contact_email: 'gp@fund.example' } }, 2: { gp: { contact_email: null } } },
};

// ── The model ───────────────────────────────────────────────────────────

test('called, due and uncalled are summed per fund in cents', () => {
  const [f1, f2] = commitmentsByFund(PORTAL, TODAY);
  assert.equal(f1.commitment_cents, 100000);
  assert.equal(f1.called_cents, 35000);
  // The part-received line owes 20,000; the older paid line owes nothing.
  assert.equal(f1.due_cents, 20000);
  assert.equal(f1.uncalled_cents, 65000);
  // A line marked paid before receipts existed is settled for the LP.
  assert.equal(f1.settled_cents, 15000);
  assert.equal(f1.next_due, '2026-12-01');
  assert.equal(f1.distributed_cents, 2500);
  assert.equal(f1.gp.contact_email, 'gp@fund.example');
  assert.equal(f2.calls[0].state, 'overdue');
  assert.equal(f2.tvpi, null);
});

test('a calls read that failed leaves called, due and uncalled unknown, never zero', () => {
  const [f1] = commitmentsByFund({ ...PORTAL, capital_calls_recorded: false, capital_calls: [] }, TODAY);
  assert.equal(f1.calls_known, false);
  assert.equal(f1.called_cents, null);
  assert.equal(f1.due_cents, null);
  assert.equal(f1.uncalled_cents, null);
  assert.equal(commitmentBar(f1), null);
});

test('calls beyond the commitment are said, not hidden behind a zero', () => {
  const [f1] = commitmentsByFund({
    ...PORTAL,
    capital_calls: [{ id: 1, fund_id: 1, owed_cents: 150000, received_cents: 0, status: 'pending' }],
  }, TODAY);
  assert.equal(f1.over_called, true);
  assert.equal(f1.uncalled_cents, 0);
});

test('an absent figure is never read as zero: no call number, and owed falls back to dollars', () => {
  const [f1] = commitmentsByFund({
    ...PORTAL,
    capital_calls: [{ id: 7, fund_id: 1, call_number: null, owed_cents: null, amount: 42.5, received_cents: null, status: 'pending' }],
  }, TODAY);
  assert.equal(f1.calls[0].call_number, null, 'a missing call number read as call 0');
  assert.equal(f1.calls[0].owed_cents, 4250, 'a missing owed_cents read as 0 instead of the dollar amount');
  assert.equal(f1.due_cents, 4250);
});

test('a line is overdue only once its due date has passed', () => {
  assert.equal(callState({ status: 'pending', due_date: '2026-09-27', received_cents: 0 }, TODAY), 'overdue');
  assert.equal(callState({ status: 'pending', due_date: '2026-09-28', received_cents: 0 }, TODAY), 'pending');
  assert.equal(callState({ status: 'pending', due_date: null, received_cents: 5 }, TODAY), 'part_received');
  assert.equal(callState({ status: 'paid', due_date: '2020-01-01' }, TODAY), 'paid');
});

// ── Onboarding status from records ──────────────────────────────────────

test('KYC reads Trust\'s record, and a failed read is not a status', () => {
  const ctx = (status, loaded = true) => ({ kyc: { loaded, status }, application: null, applicationLoaded: true, holdings: [] });
  assert.deepEqual(onboardingStatus('KYC / AML', ctx('approved')), ['green', 'Approved']);
  assert.deepEqual(onboardingStatus('KYC / AML', ctx('pending')), ['amber', 'In review']);
  assert.deepEqual(onboardingStatus('KYC / AML', ctx('not_started')), ['gray', 'Not started']);
  assert.deepEqual(onboardingStatus('KYC / AML', ctx(null, false)), ['gray', 'Not read']);
});

test('accreditation is self-certified, never shown as verified or complete', () => {
  const [, label] = onboardingStatus('Accredited status', {
    kyc: { loaded: true }, application: { accredited: 1 }, applicationLoaded: true, holdings: [],
  });
  assert.match(label, /self-certified/i);
  assert.doesNotMatch(label, /^Complete|^Verified/);
});

test('rows with no store say so; the LPA reads the holdings', () => {
  const base = { kyc: { loaded: true }, application: null, applicationLoaded: true };
  assert.deepEqual(onboardingStatus('Subscription documents', { ...base, holdings: [] }), ['gray', 'Not recorded']);
  assert.deepEqual(onboardingStatus('Banking + capital call setup', { ...base, holdings: [] }), ['gray', 'Not recorded']);
  assert.deepEqual(onboardingStatus('Limited partnership agreement', { ...base, holdings: [{ lpa_signed: true }] }), ['green', 'Signed']);
  assert.deepEqual(onboardingStatus('Limited partnership agreement', { ...base, holdings: [{ lpa_signed: false }] }), ['amber', 'Not signed']);
  assert.deepEqual(onboardingStatus('Limited partnership agreement', { ...base, holdings: [] }), ['gray', 'No position yet']);
});

test('the page takes its onboarding status from the records, not the access ladder', () => {
  const src = codeOnly(read('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx'));
  assert.match(src, /const status = onboardingStatus\(name, \{/);
  assert.doesNotMatch(src, /committed: 5, voting: 5/, 'the ladder-derived status is back');
  assert.match(src, /api\.kycStatus\(\)/);
});

// ── Stale and false copy ────────────────────────────────────────────────

test('a scheduled date that has passed says so', () => {
  assert.equal(formatScheduleDate('2026-09-15'), 'Sep 15, 2026');
  assert.equal(schedulePassed('2026-09-15', '2026-09-28'), true);
  assert.equal(scheduledLabel('2026-09-15', '2026-09-28'), 'Sep 15, 2026 (date passed; outcome not recorded)');
  assert.equal(scheduledLabel('2026-12-01', '2026-09-28'), 'Dec 1, 2026');
});

test('no page claims Parallel Markets, a countersignature it cannot see, or verified accreditation', () => {
  const page = read('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx');
  assert.doesNotMatch(page, /Parallel Markets/);
  assert.doesNotMatch(page, /Committed = countersigned subscription/);
  assert.doesNotMatch(page, /activate once your commitment is countersigned/);
  assert.ok(!PROCESS_STEPS.some((s) => s.join(' ').includes('Parallel Markets')));
});

// ── The section ─────────────────────────────────────────────────────────

const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(MyCommitment, { onReload: () => {}, ...props })));

test('the section draws each fund\'s committed, called, due and uncalled, and its calls', () => {
  const html = render({ portal: PORTAL, failed: false });
  assert.match(html, /id="my-commitment"/);
  assert.match(html, /\$1,000\.00/);
  assert.match(html, /\$350\.00(?:<!-- -->)? called/);
  assert.match(html, /\$200\.00(?:<!-- -->)? due/);
  assert.match(html, /\$650\.00(?:<!-- -->)? uncalled/);
  assert.match(html, /data-testid="commitment-call-10"/);
  assert.match(html, /\$150\.00(?:<!-- -->)? paid/, 'the violet share is what was paid, and it was labelled "called"');
  assert.doesNotMatch(html, /Call 0/, 'a line with no call number was drawn as call 0');
  assert.match(html, /data-testid="commitment-totals"/, 'two funds, no totals row');
  assert.match(html, /data-testid="button-sign-lpa-101"/, 'an unsigned LPA offers a signature action');
  assert.doesNotMatch(html, /data-testid="button-sign-lpa-100"/, 'a signed LPA is offered for signing again');
  assert.match(html, /Co-invest offers/);
});

test('a failed portal read is Unreadable, and a failed calls read is too', () => {
  assert.match(render({ portal: null, failed: true }), /data-testid="status-commitment-unreadable"/);
  const html = render({ portal: { ...PORTAL, capital_calls_recorded: false, capital_calls: [] }, failed: false });
  assert.match(html, /data-testid="status-calls-unreadable"/);
  assert.doesNotMatch(html, /\$0\.00(?:<!-- -->)? called/);
});

test('Message the GP writes to the GP of record\'s account, and /help only when there is none', () => {
  const src = codeOnly(read('frontend/src/pages/SpinoutLabLpCommitment.jsx'));
  assert.match(src, /api\.messageStartThread\(\{\s*to_email: target\.gp\.contact_email,/);
  const page = codeOnly(read('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx'));
  assert.match(page, /<MessageGp portal=\{portal\} \/>/);
  assert.doesNotMatch(page, /<Link to="\/help"[^>]*>\s*<MessageSquare/);
});

// ── The retirements ─────────────────────────────────────────────────────

test('/lp-portal and /funds/lp-workspace redirect to the one workspace, and the old page is gone', () => {
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /path="\/lp-portal" element=\{<LpPortalRedirect \/>\}/);
  assert.match(app, /path="\/funds\/lp-workspace" element=\{<FundLpWorkspaceRedirect \/>\}/);
  assert.doesNotMatch(app, /LPPortalPage/);
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/LPPortalPage.jsx')));
  const fundsPage = codeOnly(read('frontend/src/pages/FundsPage.jsx'));
  assert.doesNotMatch(fundsPage, /LPPortalView/);
  assert.match(fundsPage, /export function LPADrawer\(/);
  const fundOps = codeOnly(read('frontend/src/pages/FundOpsWorkspace.jsx'));
  assert.doesNotMatch(fundOps, /SpinoutLabLpWorkspacePage|lp-workspace/);
  // Nothing in the app links a retired path.
  for (const f of ['frontend/src/pages/SpinoutLabLpWorkspacePage.jsx', 'frontend/src/pages/investor/InvestorFundCalls.jsx']) {
    assert.doesNotMatch(codeOnly(read(f)), /to="\/lp-portal"/, `${f} links the retired portal`);
  }
});

// ── The I5 artboard ─────────────────────────────────────────────────────

test('the artboard\'s My-commitment elements are on the section', () => {
  const canvas = read('design/canvases/backlog/Investor LP Canvas.dc.html');
  const from = canvas.indexOf('<section class="ab" id="i5">');
  const to = canvas.indexOf('<section class="ab" id="i6">', from);
  assert.ok(from > 0 && to > from, 'the I5 artboard was not found between its neighbours');
  const art = canvas.slice(from, to);
  for (const el of ['My commitment', 'called', 'due', 'uncalled', 'callSchedule', 'Co-invest offers', 'Ask the report']) {
    assert.ok(art.includes(el), `the artboard no longer draws ${el}`);
  }
  const src = read('frontend/src/pages/SpinoutLabLpCommitment.jsx');
  for (const el of ['My commitment', ' called', ' due', ' uncalled', 'commitment-call-', 'Co-invest offers', 'Ask the report']) {
    assert.ok(src.includes(el), `the section does not draw ${el}`);
  }
});
