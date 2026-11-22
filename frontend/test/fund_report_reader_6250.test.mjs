// D6250: issued documents use frozen facts, safe prose and explicit absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PeriodReader } from '../src/pages/FundReportPeriodPage.jsx';
import { issuedFundRows, frozenSections } from '../src/lib/quarterlyReportViewModel.js';
import { mountForm } from './_form_d695.mjs';
const data = { can_manage: false, fund: { id: 7, name: 'Recorded fund' }, totals: { committed_cents: 999999 }, period: {
  id: 2, period: 'Q2 2026', status: 'issued', period_start: '2026-04-01', period_end: '2026-06-30',
  issued_at: '2026-07-08T10:00:00Z', issued_by_name: 'Recorded issuer', corrects_period_id: 1, corrected_by_period_id: 3,
  narrative: { letter: ['<script>untrusted</script>'], developments: [{ date: '2026-05-03', title: 'Launch', body: 'Recorded development.' }], outlook: ['Next quarter.'], subsequent: [{ d: '2026-07-01', e: 'Recorded event.' }] },
  figures: { source: 'issue_snapshot', totals: { committed_cents: 12345, invested_cents: null, invested_reason: 'No frozen investments.' } },
} };
const render = d => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PeriodReader, { data: d })));
test('reader typesets safe narrative with issuer, frozen amounts and reciprocal correction links', () => {
  const html = render(data);
  for (const text of ['Recorded fund', 'Recorded issuer', '2026-07-08T10:00:00Z', 'Launch', 'Recorded development.', 'Next quarter.', 'Recorded event.', '$123.45', 'No frozen investments.', 'Not recorded', '&lt;script&gt;']) assert.ok(html.includes(text), text);
  for (const id of [1, 3]) assert.ok(html.includes(`/funds/7/reporting/${id}`));
  assert.doesNotMatch(html, /<script|<input|<textarea|Save draft|Issue a correcting period|9,999/);
  assert.match(render({ ...data, can_manage: true }), /Issue a correcting period/);
});
test('legacy missing snapshot and issuer stay absent; no live totals or fabricated actor', () => {
  const html = render({ ...data, period: { ...data.period, figures: null, figures_reason: 'No snapshot was recorded.', issued_by_name: null } });
  assert.match(html, /No snapshot was recorded/);
  assert.match(html, /The issuer’s name was not recorded/);
  assert.doesNotMatch(html, /\$|Recorded issuer/);
  assert.equal(issuedFundRows({ source: 'issue_snapshot', totals: { committed_cents: 0 } })[0].v, '$0.00');
  assert.equal(issuedFundRows({ source: 'issue_snapshot', totals: { committed_cents: '0' } })[0].v, 'Not recorded');
});
test('report-pack reader uses the existing PDF frozen model without LP-specific rows', () => {
  const figures = { source: 'report_pack', lp_count: 2, totals: { commitments: { cents: 125000 } }, books_closed: true };
  const rows = issuedFundRows(figures);
  assert.deepEqual(rows[0].v, frozenSections({ figures }).headline[0].v);
  assert.equal(rows[0].v, '$1,250');
  assert.ok(rows.every(row => !row.k.startsWith('Your ')));
});
test('Print invokes the browser print action', async () => {
  const view = await mountForm(React.createElement(PeriodReader, { data }));
  const previous = window.print; let calls = 0; window.print = () => { calls += 1; };
  try { await view.click('Print'); assert.equal(calls, 1); } finally { window.print = previous; await view.unmount(); }
});
