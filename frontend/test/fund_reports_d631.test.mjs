import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FundPage, { fundMoney } from '../src/pages/FundPage.jsx';
import FundReportPeriodPage from '../src/pages/FundReportPeriodPage.jsx';
import { readableFund, readablePeriod } from '../src/hooks/useFundReport.js';
import { fundReportsApi } from '../src/lib/api/fundReports.js';
import { ReportContents } from '../src/pages/investor/InvestorFundReporting.jsx';
export const page = { currency: 'USD', can_manage: true, periods: [], fund: { id: 10, name: 'Recorded Fund', status: 'investing', vintage_year: 2026, size_cents: 1000000, lp_count: 2,
  gp: { name: 'Recorded GP', title: null, entity: 'GP entity', email: 'gp@example.test' }, providers: { fund_admin: 'Recorded administrator', auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } },
  totals: { committed_cents: 200000, invested_cents: 22222, invested_reason: null }, lpa: { status: 'signed', version: 3, updated_at: '2026-07-01' } };
export const period = { id: 1, period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', status: 'draft', revision: 'receipt', corrects_period_id: null,
  narrative: { letter: ['Recorded letter.'], developments: [{ date: '2026-05-12', title: 'Milestone', body: 'Recorded development.' }], outlook: ['Next quarter.'], subsequent: [{ d: '2026-07-08', e: 'Recorded event.' }] } };
const render = (Component, reading) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/10'] }, React.createElement(Component, { reading })));
const ready = (data) => ({ loading: false, error: null, data, reload() {} });
test('real F1 renders recorded cents, live count, GP, LPA and missing providers with reasons', () => {
  const html = render(FundPage, ready(page));
  for (const text of ['Recorded Fund', '$10,000.00', '$2,000.00', '$222.22', 'LPs · live count', 'Recorded GP', 'GP entity', 'gp@example.test', 'Recorded administrator', 'Auditor has not been recorded for this fund.', 'Custodian has not been recorded for this fund.', 'Valuation policy has not been recorded for this fund.', 'Not recorded', 'signed', 'Open LPA', 'New reporting period']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/funds\/10\/reporting\/new"/);
  assert.match(html, /LPs · live count.*?<span>2<\/span>/);
  assert.match(html, /Version.*?<span>3<\/span>/);
  assert.match(html, /<b>Not recorded<\/b><small>Auditor has not been recorded/);
  assert.doesNotMatch(html, /€|\[Firm\]|\[12\]/);
});
test('real F1 loading, Unreadable, denied and corrupt reads cannot expose stale totals', () => {
  for (const Component of [FundPage, FundReportPeriodPage]) {
    const data = { ...page, period };
    const loading = render(Component, { ...ready(data), loading: true });
    assert.match(loading, /aria-busy="true"/); assert.doesNotMatch(loading, /\$2,000|Recorded letter|Recorded Fund|Q2 2026/);
    const failed = render(Component, { ...ready(data), error: { status: 503 } });
    assert.match(failed, /Unreadable/); assert.match(failed, /Try again/); assert.doesNotMatch(failed, /\$2,000|Recorded letter|Recorded Fund|Q2 2026/);
    const refused = render(Component, { ...ready(data), error: { status: 404 } });
    assert.match(refused, /Fund not available/); assert.doesNotMatch(refused, /\$2,000|Recorded letter|Save draft/);
  }
  const corrupt = render(FundPage, ready({ ...page, totals: { committed_cents: '200000', invested_cents: null } }));
  assert.match(corrupt, /Unreadable/); assert.doesNotMatch(corrupt, /\$2,000/);
});
test('real F1 empty LP state, absent amounts, absent LPA and LP actions stay honest', () => {
  const html = render(FundPage, ready({ ...page, can_manage: false, fund: { ...page.fund, lp_count: 0, size_cents: null }, totals: { committed_cents: 0, invested_cents: null, invested_reason: 'No attributed positions are recorded.' }, lpa: null,
    periods: [{ id: 7, period: 'Issued Q1', status: 'issued' }] }));
  for (const text of ['No LP has committed yet.', '$0.00', 'No attributed positions are recorded.', 'No LPA is attached to this fund.', 'The fund size has not been recorded.', 'Issued Q1']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/funds\/10\/reporting\/7"/);
  assert.doesNotMatch(html, /New reporting period|Open LPs|Open LPA/);
});
test('real F2 draft renders all narrative sections and editable controls', () => {
  const html = render(FundReportPeriodPage, ready({ ...page, period }));
  for (const text of ['Period label', '2026-04-01', '2026-06-30', 'Recorded letter.', 'Milestone', 'Recorded development.', 'Next quarter.', 'Recorded event.', 'Save draft', 'Issue', 'Add letter paragraph', 'Add development', 'Add outlook paragraph', 'Add subsequent event']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="Period label"[^>]*readOnly/);
  assert.doesNotMatch(html, /Issued · read-only|Issue a correcting period|role="dialog"/);
});
test('real F2 issued report is read-only, identifies issue and links its separate correction', () => {
  const issued = { ...period, status: 'issued', issued_at: '2026-07-15T10:00:00Z', issued_by: 2 };
  const html = render(FundReportPeriodPage, ready({ ...page, period: issued }));
  for (const text of ['Issued · read-only', '2026-07-15T10:00:00Z', 'Issued by', 'Issuing cannot be undone.', 'Issue a correcting period']) assert.ok(html.includes(text), text);
  assert.match(html, /href="\/funds\/10\/reporting\/new\?corrects=1"/);
  for (const field of html.matchAll(/<(?:input|textarea)\b[^>]*>/g)) assert.match(field[0], /readOnly/, field[0]);
  assert.doesNotMatch(html, /Save draft|Add letter|Remove letter|>Issue<|>Confirm issue</);
  const lp = render(FundReportPeriodPage, ready({ ...page, can_manage: false, period: issued }));
  assert.doesNotMatch(lp, /Issue a correcting period|Save draft|Add development/);
  const hidden = render(FundReportPeriodPage, ready({ ...page, can_manage: false, period }));
  assert.match(hidden, /Fund not available/); assert.doesNotMatch(hidden, /Recorded letter|Save draft/);
});
test('real F2 new empty sections give reasons and correction points to the original', () => {
  const html = render(FundReportPeriodPage, ready({ ...page, period: { ...period, id: null, period: '', period_start: '', period_end: '', corrects_period_id: 7, corrects_period: 'Original Q2', narrative: { letter: [], developments: [], outlook: [], subsequent: [] } } }));
  assert.match(html, /This period has no content yet/); assert.match(html, /The start date has not been set/); assert.match(html, /The end date has not been set/);
  assert.match(html, /No paragraphs have been recorded in this section/);
  assert.match(html, /No entries have been recorded in this section/);
  assert.match(html, /Original Q2/); assert.match(html, /href="\/funds\/10\/reporting\/7"/);
  assert.match(html, /The original remains issued/); assert.doesNotMatch(html, /aria-label="Period label"[^>]*readOnly/);
});
test('payload validators reject missing or invalid values; exact cents never round or fabricate zero', () => {
  assert.ok(readableFund(page)); assert.ok(readablePeriod(period));
  assert.ok(!readableFund({ ...page, fund: { ...page.fund, providers: { ...page.fund.providers, auditor: {} } } }));
  assert.ok(!readableFund({ ...page, fund: { ...page.fund, gp: { ...page.fund.gp, name: {} } } }));
  for (const value of [null, {}, { ...page, currency: 'EUR' }, { ...page, fund: { ...page.fund, lp_count: -1 } }, { ...page, totals: { committed_cents: NaN } }, { ...page, can_manage: false, periods: [{ id: 1, period: 'Draft', status: 'draft' }] }]) assert.ok(!readableFund(value));
  for (const value of [null, { ...period, status: 'lost' }, { ...period, narrative: { ...period.narrative, developments: ['bad'] } }, { ...period, narrative: { ...period.narrative, letter: [4] } }]) assert.ok(!readablePeriod(value));
  assert.deepEqual([fundMoney(null), fundMoney(-1), fundMoney(1.1), fundMoney('100'), fundMoney(0), fundMoney(1), fundMoney(Number.MAX_SAFE_INTEGER)], [null, null, null, null, '$0.00', '$0.01', '$90,071,992,547,409.91']);
  for (const id of ['0', '-1', '10x', '1/2', '9007199254740992']) { assert.throws(() => fundReportsApi.fund(id), /Choose a recorded/); assert.throws(() => fundReportsApi.period('10', id), /Choose a recorded/); }
});
test('legacy report dates can be unrecorded and the existing archive renders structured narrative safely', () => {
  const html = render(FundReportPeriodPage, ready({ ...page, period: { ...period, period_start: null, period_end: null } }));
  assert.match(html, /The start date has not been set/); assert.match(html, /The end date has not been set/);
  assert.doesNotMatch(html, /Unreadable/);
  const contents = row => renderToStaticMarkup(React.createElement(ReportContents, { row }));
  assert.equal(contents({ narrative: period.narrative }), 'Recorded narrative');
  assert.equal(contents({ narrative: 'Existing narrative.' }), 'Existing narrative.');
  assert.equal(contents({ note: 'Existing note.' }), 'Existing note.');
  assert.equal(contents({}), 'Source contents not recorded');
});
