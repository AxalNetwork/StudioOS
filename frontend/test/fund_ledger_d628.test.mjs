import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FundLedgerView } from '../src/pages/investor/FundLedgerPanel.jsx';
const render=props=>renderToStaticMarkup(React.createElement(FundLedgerView,props));
const period={id:1,label:'Q1 2024',start_date:'2024-01-01',end_date:'2024-03-31',closed:0};
const fund={id:10,name:'Fixture Fund A',can_manage:true,periods:[period,{...period,id:2,label:'Q2 2024'}],period,
  summary:{entry_count:1,fee_cents:498630,expense_cents:12345,reconciled_lines:1},reason:null,
  journal:[{entry_date:'2024-02-01',description:'Legal invoice',recorded_by:2,lines:[{code:'EXP',name:'Legal expense',debit_cents:12345,credit_cents:0,reconciled_by:2,statement_reference:'Bank Q1',statement_line_reference:'row 9'},
    {code:'CASH',name:'Cash',debit_cents:0,credit_cents:12345,reconciled_by:null}]}],
  trial_balance:[{code:'CASH',name:'Cash',debit_cents:1000000,credit_cents:12345}]};
test('summary shows exact posted fee and expense cents, fund/period and operational boundary',()=>{
  const html=render({items:[fund]});
  for(const value of ['Fixture Fund A','Q1 2024','Q2 2024','2024-01-01 to 2024-03-31','Open','Administrator read','$4,986.30','$123.45','Management fee accrued','Fund expenses','not the fund’s statutory books','No opening balances are inferred']) assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Legal invoice|Actor #|Unreadable|Not recorded/);
});
test('journal and trial balance render signed account lines, recorded actors and statement references',()=>{
  const html=render({items:[fund],view:'journal'});
  for(const value of ['EXP · Legal expense','$123.45','-$123.45','Reconciled','Posted','2024-02-01','Legal invoice','Actor #2','Bank Q1 / row 9','Trial balance · selected period','$9,876.55','Debit $10,000.00 · Credit $123.45']) assert.ok(html.includes(value),value);
});
test('fee view distinguishes recorded accrual from missing collection; explicit zero stays zero',()=>{
  const html=render({items:[{...fund,summary:{...fund.summary,fee_cents:0}}],view:'fees'});
  for(const value of ['Management fee accrued','$0.00','Management fee collected','Not recorded','No fee collection record is linked']) assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Fund expenses|Legal invoice/);
  const missing=render({items:[{...fund,summary:{...fund.summary,fee_cents:null,expense_cents:null}}]});
  assert.match(missing,/Not recorded/);assert.doesNotMatch(missing,/\$0/);
});
test('LP mode forces a summary even when journal is requested and data is accidentally supplied',()=>{
  const html=render({items:[{...fund,can_manage:false}],view:'journal'});
  assert.match(html,/LP summary only/); assert.match(html,/\$4,986\.30/);
  assert.doesNotMatch(html,/Legal invoice|Actor #2|Bank Q1|Trial balance|>Journal<|>Fees</);
});
test('selected fund and period use recorded closed state without blending funds',()=>{
  const html=render({items:[fund,{...fund,id:20,name:'Fixture Fund B',period:{...period,label:'Closed quarter',closed:1},summary:{...fund.summary,fee_cents:55,expense_cents:66}}],fundId:'20'});
  assert.match(html,/Fixture Fund B · Closed quarter/);assert.match(html,/Closed/);assert.match(html,/\$0\.55/);assert.match(html,/\$0\.66/);
  assert.doesNotMatch(html,/\$4,986\.30|\$123\.45/);
});
test('loading, Unreadable/retry and Not recorded states hide stale data',()=>{
  const loading=render({items:[fund],loading:true});assert.match(loading,/aria-busy="true"/);assert.doesNotMatch(loading,/Fixture Fund A|\$4,986/);
  const failed=render({items:[fund],error:'Please retry.'});assert.match(failed,/Unreadable: Please retry\./);assert.match(failed,/Try again|Retry/);assert.doesNotMatch(failed,/Fixture Fund A|\$4,986/);
  const empty=render({items:[]});assert.match(empty,/Not recorded: no accessible fund ledger is recorded/);assert.doesNotMatch(empty,/\$0|Unreadable/);
  const absent=render({items:[{...fund,reason:'Not recorded: no entries for this period.'}]});assert.match(absent,/Not recorded: no entries for this period\./);assert.doesNotMatch(absent,/\$4,986|Legal invoice/);
});
