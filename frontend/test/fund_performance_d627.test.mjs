import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundPerformanceView, PerformanceMetric } from '../src/pages/FundPerformancePage.jsx';
const render = (props) => renderToStaticMarkup(React.createElement(FundPerformanceView, props));
const fund = { id:10,name:'Fixture Fund A',vintage_year:2021,status:'active',as_of:'2023-01-01',nav_basis:'Investments only; cash excluded.',nav_cents:12101,paid_in_cents:10000,distributed_cents:1000,rvpi:1.2101,tvpi:1.3101,dpi:.1,irr:.15,unavailable:{} };
test('recorded per-fund figures use cents, multiples and rates and say the basis', () => {
  const html = render({items:[fund]});
  for (const text of ['Fixture Fund A','2021 vintage','As of 2023-01-01','$121.01','$100.00','$10.00','1.21x','1.31x','0.10x','15.0%','NAV · investments only','IRR · called-capital basis','Paid-in · capital called','cash excluded.']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/Not recorded|Unreadable|Blended|Net IRR/);
});
test('a null value displays its server reason, while a recorded zero stays zero', () => {
  const missing = renderToStaticMarkup(React.createElement(PerformanceMetric,{fund:{nav_cents:null,unavailable:{nav_cents:'A recorded position mark is missing.'}},field:'nav_cents',label:'NAV'}));
  assert.match(missing,/Not recorded/);
  assert.match(missing,/A recorded position mark is missing\./);
  assert.doesNotMatch(missing,/\$0/);
  const zero = renderToStaticMarkup(React.createElement(PerformanceMetric,{fund:{nav_cents:0,unavailable:{}},field:'nav_cents',label:'NAV'}));
  assert.match(zero,/\$0\.00/);
  assert.doesNotMatch(zero,/Not recorded/);
});
test('loading, failed reads and empty funds are distinct and never expose stale figures', () => {
  const loading = render({items:[fund],loading:true});
  assert.match(loading,/aria-busy="true"/);
  assert.doesNotMatch(loading,/Fixture Fund A|\$121/);
  const failed = render({items:[fund],error:'Please retry.'});
  assert.match(failed,/Unreadable: Please retry\./);
  assert.match(failed,/Try again|Retry/);
  assert.doesNotMatch(failed,/Fixture Fund A|\$121/);
  const empty = render({items:[]});
  assert.match(empty,/Not recorded: no funds are available/);
  assert.doesNotMatch(empty,/Unreadable|\$0/);
});
