// D6130 part 2 (#6130): the Axal VC Fund workspace's first screen follows the
// reader's standing (canvas boards VF-01 to VF-05, VF-15, VF-16A).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import {
  firstScreenKind, sectionOrder, onboardingFirst, dueLines, callWord, signItems, arrivedItems, commitmentFigures, dayLabel,
} from '../src/lib/fundFirstScreenModel.js';
import FundFirstScreen from '../src/pages/investor/fund/FundFirstScreen.jsx';
import FundWorkspaceNavigation from '../src/pages/investor/fund/FundWorkspaceNavigation.jsx';
import SpinoutLabLpWorkspacePage from '../src/pages/SpinoutLabLpWorkspacePage.jsx';

const TODAY = '2026-11-14';
const PORTAL = {
  lp_holdings: [{ id: 7, fund_id: 3, fund_name: 'Axal VC Spin-Out Fund I', commitment_amount: 150000, lpa_signed: 1, lpa_signed_at: '2026-09-03 10:00:00', commitment_date: '2026-09-03' }],
  performance: [{ lp_id: 7, fund_id: 3, commitment: 150000, tvpi: null, dpi: null, lpa_signed: true }],
  capital_calls_recorded: true,
  capital_calls: [
    { id: 11, fund_id: 3, limited_partner_id: 7, call_number: 1, owed_cents: 3_000_000, received_cents: 3_000_000, status: 'paid', paid_date: '2026-09-28', due_date: '2026-09-30', created_at: '2026-09-15 09:00:00', pay_instructions: null },
    { id: 12, fund_id: 3, limited_partner_id: 7, call_number: 2, owed_cents: 2_250_000, received_cents: 0, status: 'pending', due_date: '2026-12-01', created_at: '2026-11-10 09:00:00',
      pay_instructions: { available: true, bank_name: 'Bank', beneficiary_name: 'Fund I', account_masked: '•••• 4821', reference: 'AXF1-C2-0417' } },
  ],
  distributions: [],
  capital_statements_recorded: true,
  capital_statements: [{ uid: 's1', fund_id: 3, period_label: 'Q3 2026', issued_at: '2026-10-20 12:00:00', revision: 1 }],
  fee_statements_recorded: true,
  fee_statements: [],
  report_periods: [{ id: 4, fund_id: 3, period: 'Q2 2026', issued_at: '2026-07-22 12:00:00' }],
  funds: {},
};
const NOTICES = { status: 'ready', list: [
  { uid: 'n2', type: 'capital_call_notice', call_number: 2, notice_date: '2026-11-10', amount_cents: 2_250_000 },
  { uid: 'n0', type: 'capital_call_notice', call_number: 2, notice_date: '2026-11-09', superseded: true },
] };
const BOOKLET_DONE = { status: 'ready', view: { status: 'submitted', submitted_at: '2026-09-02 08:00:00', signing: { state: 'accepted', signed_at: '2026-09-02T09:00:00Z', accepted_at: '2026-09-04T09:00:00Z' } } };

test('the first screen is chosen by standing, and never a lower one before or after a failed read', () => {
  assert.equal(firstScreenKind({ loading: true, state: 'visitor' }), 'loading');
  assert.equal(firstScreenKind({ portalFailed: true, state: 'visitor' }), 'unreadable', 'a failed position read is not a visitor');
  assert.equal(firstScreenKind({ state: 'visitor' }), 'visitor');
  assert.equal(firstScreenKind({ state: 'pending', applicationStatus: 'pending' }), 'applicant');
  assert.equal(firstScreenKind({ state: 'pending', applicationStatus: 'approved' }), 'approved_no_position');
  assert.equal(firstScreenKind({ state: 'pending', applicationStatus: 'approved', holdings: 1 }), 'position_unsigned');
  assert.equal(firstScreenKind({ state: 'approved' }), 'approved');
  assert.equal(firstScreenKind({ state: 'committed' }), 'committed');
  assert.equal(firstScreenKind({ state: 'voting' }), 'full');
});

test('a committed reader never meets the sales page before their own sections; an applicant meets onboarding first', () => {
  for (const k of ['approved', 'committed', 'full']) {
    assert.deepEqual(sectionOrder(k), ['participation', 'reports', 'fund', 'onboarding']);
    assert.equal(onboardingFirst(k), false);
  }
  for (const k of ['applicant', 'approved_no_position', 'position_unsigned']) {
    assert.ok(sectionOrder(k).indexOf('onboarding') < sectionOrder(k).indexOf('fund'), k);
    assert.equal(onboardingFirst(k), true);
  }
  assert.equal(sectionOrder('visitor')[0], 'fund');
  assert.equal(sectionOrder('unreadable')[0], 'fund', 'Fund and terms still works when the position cannot be read');
});

test('the section links follow the same order', () => {
  const nav = (onboarding) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/x'] },
    createElement(FundWorkspaceNavigation, { hasPosition: false, showReports: true, onboardingFirst: onboarding })));
  const hrefs = (html) => [...html.matchAll(/href="(#[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs(nav(true)), ['#overview', '#apply', '#fund', '#reports']);
  assert.deepEqual(hrefs(nav(false)), ['#overview', '#reports', '#fund', '#apply']);
});

test('What is due lists open lines soonest first and says when the calls could not be read', () => {
  const due = dueLines(PORTAL, TODAY);
  assert.equal(due.known, true);
  assert.deepEqual(due.lines.map((l) => l.id), [12], 'a paid line is not due');
  assert.equal(due.lines[0].word, 'Due · in 17 days');
  assert.deepEqual(dueLines({ ...PORTAL, capital_calls_recorded: false, capital_calls: [] }, TODAY), { known: false, lines: [] });
  assert.equal(callWord({ state: 'overdue', due_date: '2026-11-11' }, TODAY), 'Overdue · 3 days');
  assert.equal(callWord({ state: 'pending', due_date: null }, TODAY), 'Due · no due date recorded');
  const two = dueLines({ ...PORTAL, capital_calls: [
    { id: 20, fund_id: 3, limited_partner_id: 7, owed_cents: 100, received_cents: 0, status: 'pending', due_date: '2026-12-20' },
    { id: 21, fund_id: 3, limited_partner_id: 7, owed_cents: 100, received_cents: 0, status: 'pending', due_date: '2026-11-20' },
  ] }, TODAY);
  assert.deepEqual(two.lines.map((l) => l.id), [21, 20]);
});

test('What to sign reads the booklet and the LPA, and never says "nothing left" over a failed read', () => {
  const done = signItems({ booklet: BOOKLET_DONE, holdings: PORTAL.lp_holdings });
  assert.deepEqual(done.items.map((i) => [i.key, i.word]), [['booklet', 'Complete'], ['lpa', 'Signed']]);
  assert.equal(done.left, 0);
  assert.equal(done.complete, true);
  assert.match(done.items[1].sub, /signed 3 Sep 2026/);
  const open = signItems({ booklet: { status: 'ready', view: { status: 'open', signing: { state: 'not_sent' } } }, holdings: [{ lpa_signed: 0 }] });
  assert.equal(open.left, 2);
  assert.equal(open.items[0].href, '#subscription-booklet');
  const failed = signItems({ booklet: { status: 'unreadable' }, holdings: PORTAL.lp_holdings });
  assert.equal(failed.items[0].tone, 'unavailable');
  assert.equal(failed.complete, false);
  assert.equal(signItems({ booklet: { status: 'loading' }, holdings: [] }).complete, false);
  assert.equal(signItems({ booklet: { status: 'none' }, holdings: [] }).items[0].word, 'None on the platform');
  assert.equal(signItems({ booklet: { status: 'ready', view: { status: 'submitted', signing: { state: 'awaiting_gp' } } } }).items[0].left, false);
});

test('What arrived is the latest three, newest first, and names each source it could not read', () => {
  const a = arrivedItems({ portal: PORTAL, notices: NOTICES });
  assert.deepEqual(a.items.map((i) => i.key), ['notice-n2', 'statement-s1', 'report-4'], 'the superseded notice is left out');
  assert.equal(a.items[0].title, 'Capital call notice #2');
  assert.equal(a.items[0].date, 'issued 10 Nov 2026');
  assert.deepEqual(a.unreadable, []);
  const b = arrivedItems({ portal: { ...PORTAL, capital_statements_recorded: false, capital_statements: [] }, notices: { status: 'unreadable' } });
  assert.deepEqual(b.unreadable, ['Notices', 'Capital statements']);
  const many = arrivedItems({ portal: { ...PORTAL, report_periods: [1, 2, 3].map((i) => ({ id: i, period: `Q${i}`, issued_at: `2026-0${i}-01` })) }, notices: NOTICES });
  assert.equal(many.items.length, 3);
  assert.equal(many.total, 5);
});

test('the commitment figures are the record\'s, and a figure it cannot support is not a zero', () => {
  const c = commitmentFigures(PORTAL, { fundId: 3, today: TODAY });
  const by = Object.fromEntries(c.figures.map((f) => [f.key, f]));
  assert.equal(by.committed.cents, 15_000_000);
  assert.equal(by.called.cents, 5_250_000);
  assert.equal(by.paid.cents, 3_000_000);
  assert.equal(by.paid.label, 'Received on calls (to date)', 'not "Paid in", which My commitment uses for the invested amount');
  assert.equal(by.uncalled.cents, 9_750_000);
  assert.equal(by.tvpi.multiple, null, 'nothing paid in on the record: no multiple, not 0.00×');
  const unread = commitmentFigures({ ...PORTAL, capital_calls_recorded: false, capital_calls: [] }, { fundId: 3, today: TODAY });
  const u = Object.fromEntries(unread.figures.map((f) => [f.key, f]));
  assert.equal(u.called.cents, null);
  assert.equal(u.called.unreadable, true);
  assert.equal(commitmentFigures(PORTAL, { fundId: 99, today: TODAY }), null);
  assert.equal(dayLabel('2026-11-10 09:00:00'), '10 Nov 2026');
});

const render = (props) => renderToStaticMarkup(createElement(MemoryRouter, null,
  createElement(FundFirstScreen, { P: { live: false, graduates: 'Not recorded', onTime: 'Not recorded', alumni: 'Not recorded' }, today: TODAY, ...props })));

test('a committed reader sees What is due, What to sign and What arrived before their figures, and no sales page', () => {
  const html = render({ kind: 'committed', portal: PORTAL, booklet: BOOKLET_DONE, notices: NOTICES, fundId: 3 });
  assert.match(html, /id="overview"/);
  assert.match(html, /data-first-screen="committed"/);
  const at = (s) => html.indexOf(s);
  assert.ok(at('data-testid="first-due"') > 0 && at('data-testid="first-due"') < at('data-testid="first-sign"'));
  assert.ok(at('data-testid="first-sign"') < at('data-testid="first-arrived"'));
  assert.ok(at('data-testid="first-arrived"') < at('data-testid="first-figures"'));
  assert.match(html, /Wire details for call #2/);
  assert.match(html, /\$22,500\.00/);
  assert.match(html, /AXF1-C2-0417/);
  assert.match(html, /No multiple yet/);
  assert.match(html, /data-testid="first-increase"/);
  assert.doesNotMatch(html, /Request an increase|co-invest|allocation/i, 'no control that sends nothing; D6138 and D6140 stand');
  assert.doesNotMatch(html, /Back the companies|Explore the Spin-Out Lab|Fund brief/, 'the sales page is not the first screen');
});

test('full rights drops the increase line; a failed calls read is Unavailable, not "nothing due"', () => {
  const full = render({ kind: 'full', portal: { ...PORTAL, capital_calls_recorded: false, capital_calls: [] }, booklet: { status: 'unreadable' }, notices: NOTICES, fundId: 3 });
  assert.doesNotMatch(full, /data-testid="first-increase"/);
  assert.match(full, /data-testid="first-due-unreadable"/);
  assert.doesNotMatch(full, /Nothing is due/);
  assert.doesNotMatch(full, /nothing left|Nothing waits for your signature/, 'a booklet not read is not "nothing to sign"');
});

test('an unreadable position says it is not a $0 commitment and draws no standing', () => {
  const html = render({ kind: 'unreadable', portal: null, err: 'Could not load your LP position.' });
  assert.match(html, /data-testid="first-unreadable"/);
  assert.match(html, /This is not a \$0 commitment\./);
  assert.match(html, /Could not load your LP position\./);
  assert.doesNotMatch(html, /You are viewing by invitation|data-first-screen="visitor"/);
});

test('each pre-commitment standing has its own first screen', () => {
  const app = { status: 'pending', created_at: '2026-11-09 10:00:00', target_commitment: 100000, review_note: '' };
  const applicant = render({ kind: 'applicant', application: app });
  assert.match(applicant, /Application in review/);
  assert.match(applicant, /Sent 9 Nov 2026 · target commitment \$100,000\.00/);
  assert.match(applicant, /aria-current="step"[^>]*>1 · Review/);
  assert.match(applicant, /Start KYC \/ AML in Trust/);
  assert.doesNotMatch(render({ kind: 'applicant', application: app, kyc: { loaded: true, status: 'approved' } }), /Start KYC/, 'no KYC action once Trust has approved it');
  assert.match(render({ kind: 'approved_no_position', application: { ...app, status: 'approved', reviewed_at: '2026-11-12' } }), /Approved\. Your fund position is being set up\./);
  assert.match(render({ kind: 'position_unsigned', portal: { lp_holdings: [{ id: 1, lpa_signed: 0 }] } }), /Sign the LPA to continue/);
  const approved = render({ kind: 'approved', portal: { ...PORTAL, lp_holdings: [{ ...PORTAL.lp_holdings[0], commitment_amount: 0 }] }, booklet: { status: 'ready', view: { status: 'open', signing: {} } }, fundId: 3 });
  assert.match(approved, /What to do next/);
  assert.match(approved, /To sign/);
  assert.match(approved, /To commit/);
  assert.match(approved, /Email the GP of record/);
  assert.match(render({ kind: 'visitor' }), /Ready to talk to the fund\?/);
});

test('loading holds the standing back on the standalone page', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/spinout-lab/investor-workspace'] },
    createElement(SpinoutLabLpWorkspacePage)));
  assert.match(html, /data-testid="lp-standing-loading"/);
  assert.match(html, /Reading your standing…/);
  assert.doesNotMatch(html, /data-testid="lp-standing"|Visitor · viewing by invitation|Fund workspace sections/);
});

// D9006 (#9006): the chip's amount is the record's commitment, in cents, summed per row.
test('D9006: the standing carries the record\'s commitment in cents, and none when nothing is recorded', async () => {
  const { lpAccessState } = await import('../src/lib/spinoutFundModel.js');
  const { standingWords } = await import('../src/pages/investor/fund/FundWorkspaceSupport.jsx');
  const committed = lpAccessState(PORTAL, null);
  assert.equal(committed.state, 'committed');
  assert.equal(committed.commitmentCents, 15_000_000);
  assert.equal(standingWords(committed.state, committed.commitmentCents), 'Committed LP · $150,000.00');
  const two = lpAccessState({ lp_holdings: [{}, {}], performance: [{ commitment: 200000.10 }, { commitment: 100000.20 }] }, null);
  assert.equal(two.state, 'voting');
  assert.equal(two.commitmentCents, 30_000_030, 'summed in whole cents per row');
  assert.equal(standingWords(two.state, two.commitmentCents), 'Full rights · $300,000.30');
  const odd = lpAccessState({ lp_holdings: [{}], performance: [{ commitment: 150000.02 }] }, null);
  assert.equal(odd.commitmentCents, 15_000_002, 'a dollar figure with cents is not truncated by float error');
  const unsigned = lpAccessState({ lp_holdings: [{}], performance: [{ commitment: null, lpa_signed: false }] }, null);
  assert.equal(unsigned.commitmentCents, null, 'no commitment recorded is null, not 0');
  assert.equal(lpAccessState(null, null).commitmentCents, null);
  assert.equal(standingWords('committed', unsigned.commitmentCents), 'Committed LP', 'a previewed committed standing with no record prints no $0');
});

test('the page draws the first screen, then the sections in the standing\'s order, and stays under 500 lines', () => {
  const page = readFileSync(new URL('../src/pages/SpinoutLabLpWorkspacePage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<FundFirstScreen\s/);
  assert.match(page, /\{sectionOrder\(kind\)\.map\(\(key\) => <React\.Fragment key=\{key\}>\{sections\[key\]\}<\/React\.Fragment>\)\}/);
  assert.ok(page.indexOf('<FundFirstScreen') < page.indexOf('sectionOrder(kind).map'));
  assert.ok(page.split('\n').length < 500);
});
