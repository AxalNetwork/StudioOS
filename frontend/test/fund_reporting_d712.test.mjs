// D712 (#1777) — a period issued through the reporting queue prints its
// frozen figures and nothing from the fund model; each line it does not carry
// says Not recorded; the PDF draws every empty section as Not recorded, inside
// the sheet; the client, the screens and the admin gates say what the Worker does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPdfStub } from './_pdf-stub.mjs';
import { renderQuarterlyReport } from '../src/lib/quarterlyReportPdf.js';
import { quarterlyReportModel, quarterOf } from '../src/lib/quarterlyReportViewModel.js';
import { fundModel } from '../src/lib/spinoutFundModel.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const Q3 = { ...quarterOf(new Date(2026, 7, 15)), label: 'Q3 2026' };
const NR = 'Not recorded: the Fund has no bank account on record';

const statement = {
  schema: 'lp_capital_statement/1',
  commitment: { cents: 100000 }, called_to_date: { cents: 30000 }, unfunded: { cents: 70000 },
  called_in_quarter: { cents: 30000 }, contributed_in_quarter: { cents: 30000 }, paid_in: { cents: 30000 },
  distributions_to_date: { cents: 5000 }, distributions_in_quarter: { cents: 5000 }, distributions_basis: 'date recorded when marked paid',
  ties: { ties: true, receipts_cents: 30000, recorded_invested_cents: 30000 },
  allocated: {
    investment_value: { cents: 33333 }, cash: { cents: null, reason: NR },
    expenses: { cents: null, reason: "Not recorded: the fund's books for Q3 2026 are not closed" },
    management_fee: { cents: null, reason: "Not recorded: the fund's books for Q3 2026 are not closed" },
    liabilities: { cents: null, reason: "Not recorded: the fund's books for Q3 2026 are not closed" },
  },
  nav: { cents: null, reason: NR },
  ratios: { dpi: { value: 0.1667 }, rvpi: { value: null, reason: 'x' }, tvpi: { value: null, reason: 'x' }, xirr: { value: null, reason: 'x' } },
};
const figures = {
  schema: 'lp_quarterly_report/1', lp_count: 2, books_closed: false, nav_basis: 'before carried interest, which is not accrued',
  totals: { commitments: { cents: 300000 }, called_to_date: { cents: 30000 }, contributed_in_quarter: { cents: 30000 }, distributions_in_quarter: { cents: 5000 } },
  fund_figures: { investment_value: { cents: 100001 }, cash: { cents: null, reason: NR }, nav: { cents: null, reason: NR },
    liabilities: { cents: null, reason: 'closed' }, expenses: { cents: null, reason: 'closed' }, management_fee: { cents: null, reason: 'closed' } },
};
const payload = {
  recipient: { name: 'Lena LP', email: 'lena@example.test' },
  performance: [{ lp_id: 101, fund_id: 10, fund_name: 'Fund A', commitment: 1000, invested_amount: 300, returns: 0 }],
  capital_calls: [{ limited_partner_id: 101, amount: 300, created_at: '2026-08-01', paid_date: '2026-08-10' }],
  distributions: [], funds: { 10: { name: 'Fund A', gp: { name: 'Gus GP' }, providers: {} } },
};

const frozen = () => quarterlyReportModel({
  payload, fundId: 10, period: Q3, issuedAt: new Date('2026-10-20T09:00:00Z'),
  narrative: { letter: ['The GP letter.'] }, issued: true, statement, figures,
});

test('a queue-issued period prints its frozen figures and nothing from the fund model', () => {
  const vm = frozen();
  assert.equal(vm.ok, true);
  const text = JSON.stringify(vm);
  for (const p of fundModel().positions) assert.equal(text.includes(p.company), false, `${p.company} comes from the model`);
  assert.doesNotMatch(text, /Mercury|First Republic|MOIC/);
  assert.deepEqual([vm.portfolio, vm.deployBars, vm.cohorts, vm.exposure, vm.progression, vm.concentration, vm.keyDates], [[], [], [], [], [], [], []]);
  const account = Object.fromEntries(vm.capitalAccount.map((r) => [r.k, r.v]));
  assert.equal(account.Commitment, '$1,000');
  assert.equal(account['Share of investment value'], '$333');
  assert.equal(account['Share of fund cash'], 'Not recorded');
  assert.equal(account['Net asset value'], 'Not recorded');
  assert.equal(vm.capitalAccount.find((r) => r.k === 'Net asset value').why, NR);
  assert.equal(vm.headline.find((h) => h.k === 'Net asset value').note, NR);
  assert.equal(vm.meta.issued, 'Oct 20, 2026', 'the recorded issue date, not today');
  assert.equal(vm.meta.marksNote, null);
});

test('a queue-issued period with no statement for this LP prints every capital-account line as Not recorded', () => {
  const vm = quarterlyReportModel({ payload, fundId: 10, period: Q3, issuedAt: new Date('2026-10-20T09:00:00Z'), issued: true, figures });
  assert.ok(vm.capitalAccount.every((r) => r.v === 'Not recorded'));
});

test('the PDF draws the empty sections as Not recorded, inside the sheet', () => {
  const doc = createPdfStub();
  const r = renderQuarterlyReport(doc, frozen());
  const drawn = doc.calls.filter((c) => c.op === 'text').map((c) => c.text).join(' | ');
  assert.match(drawn, /Not recorded: this report was issued from the fund records/);
  assert.ok(r.pages >= 4);
  assert.ok(doc.maxX <= 612);
  assert.doesNotMatch(drawn, /NaN|Infinity|undefined/);
});

test('the client calls only the queue\'s routes, and the screens follow the admin gates', () => {
  const client = src('lib/api/fundReporting.js');
  for (const route of ['/fund-reporting/drafts', '/fund-reporting/build', '/rebuild', '/prepare', '/return', '/correct', '/issue', '/export']) assert.ok(client.includes(route), route);
  assert.match(src('lib/api.js'), /export \* from '\.\/api\/fundPerformance\.js';\nexport \* from '\.\/api\/fundReporting\.js';\nexport \* from '\.\/api\/fundReports\.js';/);
  const period = src('pages/FundReportPeriodPage.jsx');
  assert.match(period, /A Super Admin issues this period\./);
  assert.match(period, /The fund&apos;s GP of record issues this period\./);
  assert.match(period, /Build this quarter&apos;s pack/);
  assert.match(period, /\{!admin && <button type="button" disabled=\{pending\} onClick=\{\(\) => setConfirm\(true\)\}>Issue<\/button>\}/, 'an admin has no Issue button on the period');
  // LPReportingPage.jsx was removed with /lp-reports (owner, 2026-10-20), and
  // with it the last client of the unqueued publish.
  assert.doesNotMatch(src('lib/api.js'), /lpReportPublish/);
  const workspace = src('pages/SpinoutLabLpWorkspacePage.jsx');
  assert.doesNotMatch(workspace.slice(workspace.indexOf('const generateReport'), workspace.indexOf('const kpis')), /issuedAt: new Date\(\),/, 'an issued period never prints today');
  assert.match(workspace, /fundReportingApi\.read\(draft\.uid\)/, "an admin's live draft opens through the audited read");
});
