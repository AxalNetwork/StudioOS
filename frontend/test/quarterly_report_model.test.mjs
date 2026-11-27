// Guards the quarterly LP report's data contract.
//
// The design export built this document for a mock LP: `meta.lp = 'Helena Kaur'`
// and a capital account derived entirely from `FUND.lpCommitK = 250`. The
// shipped version builds it from the real limited partner's rows, so the failure
// this file exists to catch is a figure quietly reverting to a fund-level
// constant, or — worse — the document asserting something about a fiduciary or a
// service provider that the database has never been told.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quarterlyReportModel, quarterlyReportFilename, quarterOf, lastClosedQuarter,
  selectHolding, usd, fmtDate,
} from '../src/lib/quarterlyReportViewModel.js';

const Q2 = quarterOf(new Date(2026, 4, 15)); // Apr–Jun 2026
const ISSUED_AT = new Date(2026, 6, 15);

/** A payload in the exact shape /funds/lp-portal and /lp-report both return. */
function payload(over = {}) {
  return {
    recipient: { name: 'Helena Kaur', email: 'helena@example.com' },
    performance: [{
      lp_id: 7, fund_id: 3, fund_name: 'Axal VC Spin-Out Fund I', fund_slug: 'spinout-fund-i',
      commitment: 250_000, invested_amount: 87_500, returns: 0,
      distributions_dollars: 0, lpa_signed: true,
    }],
    capital_calls: [
      { limited_partner_id: 7, amount: 12_775, due_date: '2025-10-15', paid_date: '2025-10-20', status: 'paid' },
      { limited_partner_id: 7, amount: 20_037, due_date: '2026-01-20', paid_date: '2026-01-25', status: 'paid' },
      { limited_partner_id: 7, amount: 29_138, due_date: '2026-04-18', paid_date: '2026-04-22', status: 'paid' },
      { limited_partner_id: 7, amount: 25_550, due_date: '2026-06-30', paid_date: '2026-06-30', status: 'paid' },
    ],
    distributions: [],
    funds: {
      3: {
        fund_id: 3, name: 'Axal VC Spin-Out Fund I', slug: 'spinout-fund-i', vintage_year: 2026,
        management_fee: 0.02, carried_interest: 0.2,
        gp: { name: 'Guillaume Lauzier', title: 'General Partner', email: 'gp@axal.vc', entity: 'Axal VC GP LLC' },
        providers: {
          fund_admin: 'Carta Fund Admin', auditor: null, legal_counsel: null,
          custodian: null, valuation_policy: 'ASC 820 · GP-reviewed quarterly',
        },
      },
    },
    ...over,
  };
}

const build = (over = {}, opts = {}) => quarterlyReportModel({
  payload: payload(over), fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT, ...opts,
});

const line = (vm, k) => vm.capitalAccount.find((r) => r.k === k);

/* --------------------------------------------------------------- periods */

test('quarterOf brackets the calendar quarter containing a date', () => {
  const q = quarterOf(new Date(2026, 4, 15));
  assert.equal(q.label, 'Q2 2026');
  assert.equal(q.start, '2026-04-01');
  assert.equal(q.end, '2026-06-30');
  assert.equal(q.range, 'Apr 1 – Jun 30, 2026');
  assert.equal(quarterOf(new Date(2026, 0, 1)).end, '2026-03-31', 'Q1 ends on the 31st');
  assert.equal(quarterOf(new Date(2024, 1, 3)).end, '2024-03-31', 'a leap year does not shift the quarter end');
  assert.equal(quarterOf(new Date(2026, 11, 31)).label, 'Q4 2026');
});

test('lastClosedQuarter never reports a quarter that has not ended', () => {
  assert.equal(lastClosedQuarter(new Date(2026, 6, 15)).label, 'Q2 2026');
  assert.equal(lastClosedQuarter(new Date(2026, 0, 5)).label, 'Q4 2025', 'January looks back across the year');
  assert.equal(lastClosedQuarter(new Date(2026, 3, 1)).label, 'Q1 2026');
});

test('fmtDate refuses to invent a date it cannot read', () => {
  assert.equal(fmtDate('2026-07-15'), 'Jul 15, 2026');
  assert.equal(fmtDate('2026-07-15T09:00:00Z'), 'Jul 15, 2026');
  assert.equal(fmtDate(null), '—');
  assert.equal(fmtDate('soon'), '—');
});

test('usd renders negatives in accounting parentheses', () => {
  assert.equal(usd(250_000), '$250,000');
  assert.equal(usd(-3_440), '($3,440)');
  assert.equal(usd(0), '$0');
  assert.equal(usd('nonsense'), '$0');
});

/* -------------------------------------------------------- fund selection */

test('the report refuses to guess which fund it is about', () => {
  const two = payload();
  two.performance = [
    two.performance[0],
    { ...two.performance[0], lp_id: 9, fund_id: 4, fund_slug: 'other-fund', fund_name: 'Other Fund' },
  ];
  assert.equal(selectHolding(two, {}), null, 'ambiguous without a fund named');
  assert.equal(selectHolding(two, { fundSlug: 'other-fund' }).fund_id, 4);
  assert.equal(selectHolding(two, { fundId: 3 }).fund_id, 3);
  assert.equal(selectHolding(two, { fundSlug: 'not-a-fund' }), null);
  // A single holding needs no naming.
  assert.equal(selectHolding(payload(), {}).fund_id, 3);
  assert.equal(selectHolding({ performance: [] }, {}), null);
});

test('a viewer with no position in the named fund gets no document', () => {
  const vm = quarterlyReportModel({ payload: payload(), fundSlug: 'some-other-fund', period: Q2 });
  assert.equal(vm.ok, false);
  assert.equal(vm.reason, 'no-holding');
});

/* ------------------------------------------ the LP's own numbers, not a mock */

test('the capital account is this LP, not the design mock', () => {
  const vm = build();
  assert.equal(vm.meta.lp, 'Helena Kaur');
  assert.equal(line(vm, 'Commitment').v, '$250,000');
  // 12,775 + 20,037 + 29,138 + 25,550, all called on or before Jun 30.
  assert.equal(line(vm, 'Capital called to date').v, '$87,500');
  assert.equal(line(vm, 'Unfunded commitment').v, '$162,500');
  assert.equal(line(vm, 'Paid-in capital').v, '$87,500');
});

test('a different LP produces a different account — nothing is pinned to a constant', () => {
  const vm = build({
    recipient: { name: 'A. Different', email: 'a@example.com' },
    performance: [{
      lp_id: 7, fund_id: 3, fund_name: 'Axal VC Spin-Out Fund I', fund_slug: 'spinout-fund-i',
      commitment: 1_000_000, invested_amount: 350_000, returns: 0, distributions_dollars: 0, lpa_signed: true,
    }],
  });
  assert.equal(vm.meta.lp, 'A. Different');
  assert.equal(line(vm, 'Commitment').v, '$1,000,000');
  assert.equal(line(vm, 'Paid-in capital').v, '$350,000');
  // The allocation scales with the LP's share, so a 4× position is a 4× NAV.
  const small = build();
  const navOf = (v) => Number(String(v).replace(/[$,()]/g, ''));
  assert.ok(navOf(line(vm, 'Net asset value').v) > navOf(line(small, 'Net asset value').v) * 3.5);
});

test('capital calls after the period end are not counted as called', () => {
  const late = payload();
  late.capital_calls = [
    ...late.capital_calls,
    { limited_partner_id: 7, amount: 50_000, due_date: '2026-08-01', paid_date: '2026-08-05', status: 'paid' },
  ];
  const vm = quarterlyReportModel({ payload: late, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(line(vm, 'Capital called to date').v, '$87,500', 'an August call is not in a Q2 statement');
  assert.ok(!vm.calls.some((c) => c.k.includes('Aug')), 'nor in the call history');
});

test('contributions are the calls PAID inside the period, not merely called', () => {
  assert.equal(line(build(), 'Contributed this quarter').v, '$54,688', 'the two Q2 calls');
  const unpaid = payload();
  unpaid.capital_calls = unpaid.capital_calls.map((c) => ({ ...c, paid_date: null, status: 'pending' }));
  const vm = quarterlyReportModel({ payload: unpaid, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(line(vm, 'Contributed this quarter').v, '$0');
  assert.equal(line(vm, 'Capital called to date').v, '$87,500', 'still called, just not paid');
  // The line that makes that $0 legible instead of alarming.
  assert.equal(line(vm, 'Capital called this quarter').v, '$54,688');
});

test('a call noticed in-period but settled after it splits across the two period lines', () => {
  const straddle = payload();
  straddle.capital_calls = [
    { limited_partner_id: 7, amount: 40_000, due_date: '2026-06-25', paid_date: '2026-07-03', status: 'paid' },
  ];
  const vm = quarterlyReportModel({ payload: straddle, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(line(vm, 'Capital called this quarter').v, '$40,000', 'called in June');
  assert.equal(line(vm, 'Contributed this quarter').v, '$0', 'settled in July, so not a Q2 contribution');
});

test('distributions are counted as of the period end', () => {
  const withDists = payload({
    distributions: [
      { fund_id: 3, amount_cents: 1_500_000, distributed_at: '2026-05-02' },
      { fund_id: 3, amount_cents: 9_900_000, distributed_at: '2026-09-30' }, // after the period
      { fund_id: 4, amount_cents: 7_700_000, distributed_at: '2026-05-02' }, // another fund
    ],
  });
  const vm = quarterlyReportModel({ payload: withDists, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(line(vm, 'Distributions to date').v, '$15,000');
});

test('a call history that does not tie to paid-in capital is reported, not hidden', () => {
  assert.equal(build().reconciliation.ties, true);
  const off = payload();
  off.performance[0].invested_amount = 60_000; // the calls say 87,500
  const vm = quarterlyReportModel({ payload: off, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(vm.reconciliation.ties, false);
  assert.equal(vm.reconciliation.paidCallsTotal, 87_500);
  assert.equal(vm.reconciliation.investedAmount, 60_000);
});

test('every capital-account line declares whether it is record or allocated', () => {
  const vm = build();
  for (const r of vm.capitalAccount) {
    assert.ok(['record', 'allocated'].includes(r.source), `${r.k} has no source`);
  }
  assert.equal(line(vm, 'Commitment').source, 'record');
  assert.equal(line(vm, 'Net asset value').source, 'allocated');
});

/* ------------------------------------------------- fiduciary and providers */

test('the signer is the fund GP of record', () => {
  const vm = build();
  assert.equal(vm.signer.name, 'Guillaume Lauzier');
  assert.equal(vm.signer.title, 'General Partner');
  assert.equal(vm.signer.recorded, true);
});

test('with no GP of record the report says so instead of naming one', () => {
  const noGp = payload();
  noGp.funds[3].gp = { name: null, title: null, email: null, entity: null };
  const vm = quarterlyReportModel({ payload: noGp, fundSlug: 'spinout-fund-i', period: Q2, issuedAt: ISSUED_AT });
  assert.equal(vm.signer.recorded, false);
  assert.equal(vm.signer.name, null);
  // The design mock's name must not reappear anywhere in the document.
  assert.ok(!JSON.stringify(vm).includes('Guillaume'), 'a mock signer leaked into the document');
});

test('unset service providers read as "not recorded", never as an invented firm', () => {
  const vm = build();
  const admin = (k) => vm.admin.find((a) => a.k === k);
  assert.equal(admin('Fund administrator').v, 'Carta Fund Admin');
  assert.equal(admin('Fund administrator').missing, false);
  assert.equal(admin('Auditor').v, 'Not recorded');
  assert.equal(admin('Auditor').missing, true);
  assert.equal(admin('Legal counsel').v, 'Not recorded');
  // The design mock's firms are not in the document unless the fund names them.
  assert.ok(!JSON.stringify(vm.admin).includes('Deloitte'));
  assert.ok(!JSON.stringify(vm.admin).includes('Ashurst'));
});

/* ------------------------------------------------------- draft vs issued */

test('a report with no GP letter is a draft, whatever the period says', () => {
  assert.equal(build().meta.draft, true, 'unissued and unwritten');
  assert.equal(build({}, { issued: true }).meta.draft, true, 'issued but no letter is still a draft');
  assert.equal(
    build({}, { issued: true, narrative: { letter: ['A word from the GP.'] } }).meta.draft,
    false,
  );
  assert.equal(
    build({}, { issued: false, narrative: { letter: ['A word from the GP.'] } }).meta.draft,
    true, 'a written but unissued letter is still a draft',
  );
});

test('authored sections stay empty rather than being generated', () => {
  const vm = build();
  assert.equal(vm.letter.authored, false);
  assert.deepEqual(vm.letter.paragraphs, []);
  assert.deepEqual(vm.developments, []);
  assert.deepEqual(vm.outlook, []);
  assert.deepEqual(vm.subsequent, []);
  assert.match(vm.letter.placeholder, /authored by the GP/i);

  const written = build({}, {
    issued: true,
    narrative: {
      letter: ['One.', 'Two.'],
      developments: [{ date: 'Apr 18', title: 'A round closed', body: 'Details.' }],
      outlook: ['Demo day in August.'],
      subsequent: [{ d: 'Jul 8', e: 'Cohort 4 commenced.' }],
    },
  });
  assert.deepEqual(written.letter.paragraphs, ['One.', 'Two.']);
  assert.equal(written.developments.length, 1);
  assert.equal(written.outlook.length, 1);
  assert.equal(written.subsequent.length, 1);
});

/* ------------------------------------------------- fund-level consistency */

test('the progression table ties to the portfolio table', () => {
  const vm = build();
  const current = vm.progression[vm.progression.length - 1];
  assert.match(current.q, /current$/);
  // Fund NAV = marked portfolio + undeployed cash − fees, and the portfolio
  // total is the same position list, so the two must move together.
  assert.equal(vm.portfolioTotals.count, String(vm.portfolio.length));
  assert.match(vm.portfolioTotals.moic, /^\d+\.\d{2}×$/);
  assert.notEqual(current.nav, '$0.00M');
});

test('the marks caveat appears whenever the period closed before the issue date', () => {
  assert.match(build().meta.marksNote, /marks are as of/i);
  const live = quarterlyReportModel({
    payload: payload(), fundSlug: 'spinout-fund-i',
    period: quarterOf(ISSUED_AT), issuedAt: ISSUED_AT,
  });
  assert.equal(live.meta.marksNote, null, 'a current-quarter report needs no caveat');
});

test('the filename names the fund, the period and the LP, and marks drafts', () => {
  assert.equal(
    quarterlyReportFilename(build()),
    'axal-vc-spin-out-fund-i-q2-2026-helena-kaur-draft.pdf',
  );
  assert.equal(
    quarterlyReportFilename(build({}, { issued: true, narrative: { letter: ['x'] } })),
    'axal-vc-spin-out-fund-i-q2-2026-helena-kaur.pdf',
  );
});
