// D6250: issued documents use frozen facts, safe prose and explicit absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PeriodReader } from '../src/pages/FundReportPeriodPage.jsx';
import { issuedFundRows, frozenSections } from '../src/lib/quarterlyReportViewModel.js';
import { readFileSync } from 'node:fs';
import { mountForm, mutationCheck, sourceModule } from './_form_d695.mjs';
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
  for (const date of ['Apr 1, 2026', 'Jun 30, 2026', 'May 3, 2026', 'Jul 1, 2026', 'Jul 8, 2026, 10:00 AM UTC']) assert.ok(html.includes(date), date);
  for (const id of [1, 3]) assert.ok(html.includes(`/funds/7/reporting/${id}`));
  assert.doesNotMatch(html, /<script|<input|<textarea|Save draft|Issue a correcting period|9,999/);
  assert.match(render({ ...data, can_manage: true, period: {...data.period,corrected_by_period_id:null} }), /Issue a correcting period/);
  assert.doesNotMatch(render({...data,can_manage:true}), /Issue a correcting period|Your capital statement and PDF/);
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
  assert.deepEqual(rows[0].v, frozenSections({ figures, exactMoney:true }).headline[0].v);
  assert.equal(rows[0].v, '$1,250.00');
  assert.ok(rows.every(row => !row.k.startsWith('Your ')));
  assert.equal(new Set(rows.map(row=>row.k)).size,rows.length);
});
test('Print invokes the browser print action', async () => {
  const view = await mountForm(React.createElement(PeriodReader, { data }));
  const previous = window.print; let calls = 0; window.print = () => { calls += 1; };
  try { await view.click('Print'); assert.equal(calls, 1); } finally { window.print = previous; await view.unmount(); }
});

test('reader mutations prove figure, attribution, narrative, correction and manager boundaries',async()=>{
 const source=readFileSync(new URL('../src/pages/FundReportPeriodPage.jsx',import.meta.url),'utf8').replace("import './fundPage.css';",'');
 const verify=async module=>{
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(module.PeriodReader,{data})));
  for(const text of ['$123.45','Recorded issuer','&lt;script&gt;','/funds/7/reporting/3'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/Issue a correcting period/);
  const manager=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(module.PeriodReader,{data:{...data,can_manage:true,period:{...data.period,corrected_by_period_id:null}}})));
  assert.match(manager,/Issue a correcting period/);
  assert.doesNotMatch(manager,/Your capital statement and PDF/);
 };
 await mutationCheck(source,'pages/FundReportPeriodPage.jsx',verify,[
  ['const figures = issuedFundRows(report.figures);','const figures = issuedFundRows(null);'],
  ['value={report.issued_by_name}','value={report.issued_by}'],
  ['link(report.corrected_by_period_id)','link(report.corrects_period_id)'],
  ['<p key={index}>{entry}</p>','<p key={index}>Removed</p>'],
  ["data.can_manage && user?.role !== 'admin' && !report.corrected_by_period_id","!data.can_manage && user?.role !== 'admin' && !report.corrected_by_period_id"],
  ['!data.can_manage && <Link to="/spinout-lab/investor-workspace#reports"','data.can_manage && <Link to="/spinout-lab/investor-workspace#reports"'],
 ]);
});

test('admins retain the pack correction process without a direct GP correction link',async()=>{
 const source=readFileSync(new URL('../src/pages/FundReportPeriodPage.jsx',import.meta.url),'utf8').replace("import './fundPage.css';",'').replace('const { user } = useAuth();',"const user = {role:'admin'};");
 const module=await sourceModule(source,'pages/FundReportPeriodPage.jsx');
 const html=renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(module.PeriodReader,{data:{...data,can_manage:true,period:{...data.period,corrected_by_period_id:null}}})));
 assert.doesNotMatch(html,/href="[^"]*new\?corrects=/);
 assert.match(html,/Quarterly pack/);
});
