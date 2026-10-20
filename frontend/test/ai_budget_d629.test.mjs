import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiBudgetUsage } from '../src/ui/AiBudgetUsage.jsx';
const budget={licence:'founder:growth',daily_microusd:5000000,monthly_microusd:50000000,
  day_spend_microusd:250000,month_spend_microusd:1234567,balance_microusd:9876543,
  day_reserved_microusd:0,month_reserved_microusd:0,topup_reserved_microusd:0};
const reading={budget,product:{configured:true,state:'ready',product:{price_id:'price_owner',currency:'usd',unit_amount:2000}},loading:false,budgetError:false,productError:false,reload:()=>{}};
const render=value=>renderToStaticMarkup(React.createElement(AiBudgetUsage,{reading:{...reading,...value}}));
// D750: spends sit in a <span title> holding the exact figure, so text checks read the words.
// Tags stripped until none is left, so one split by another (`<a<b>>`)
// cannot come back together after a single pass (as _founder_tool_checks.mjs).
const stripTags=s=>{let out=s;for(let prev=null;prev!==out;){prev=out;out=out.replace(/<[^>]*>/g,'');}return out;};
const text=value=>stripTags(render(value));
test('paid balance preserves one micro-dollar and the largest safe recorded integer',()=>{
 assert.ok(render({budget:{...budget,balance_microusd:1}}).includes('Top-up balance · $0.000001'));
 assert.ok(render({budget:{...budget,balance_microusd:Number.MAX_SAFE_INTEGER}}).includes('Top-up balance · $9,007,199,254.740991'));
});
test('D629 rail shows this licence allowance and exact separate sub-cent paid balance',()=>{
 const html=render({}),words=text({});
 for(const t of ['founder / growth','Today · $0.25 of $5.00','This month · $1.23 of $50.00','Top-up balance · $9.876543','Add tokens']) assert.ok(words.includes(t),t);
 for(const t of ['/pricing/products#token-packs','width:2.469134%','title="$1.234567"']) assert.ok(html.includes(t),t);
 assert.doesNotMatch(html,/Unreadable|isn&#x27;t available|Runs in progress/);
});
test('an explicitly zero allowance and zero balance remain recorded zeros with no division-by-zero meter',()=>{
 const html=render({budget:{...budget,daily_microusd:0,monthly_microusd:0,day_spend_microusd:0,month_spend_microusd:0,balance_microusd:0}});
 assert.match(stripTags(html),/Today · \$0\.00 of \$0\.00/);assert.match(html,/Top-up balance · \$0\.00/);
 assert.doesNotMatch(html,/width:|NaN|Infinity|Unreadable/);
});
// D642 (#1435) — the card's one link opens the Usage page; what these tests
// forbid is a CHECKOUT action, so they name the checkout href.
test('unconfigured or not-ready top-up never shows a checkout action or Retry; known allowance is retained',()=>{
 for(const product of [{configured:false},{configured:true,state:'not_ready'}]) {
  const html=render({product});
  assert.match(html,/Top-up isn&#x27;t available yet\./);assert.match(html,/\$1\.234567/);
  assert.doesNotMatch(html,/Add tokens|href="\/checkout|Unreadable|Retry|<button/);
  assert.match(html,/href="\/account\/usage"[^>]*>See usage</,'the compact card links to the Usage page');
 }
});
test('loading hides all stale budget, balance and checkout figures',()=>{
 const html=render({loading:true});assert.match(html,/Loading AI allowance/);assert.match(html,/aria-busy="true"/);
 assert.doesNotMatch(html,/\$|Add tokens|href=|founder/);
});
test('failed or malformed budget reads are Unreadable with retry and no guessed figures/action',()=>{
 for(const value of [{budget:null,budgetError:true},{budget:{...budget,balance_microusd:null}},{budget:{...budget,month_spend_microusd:1.5}}]) {
  const html=render(value);assert.match(html,/Unreadable/);assert.match(html,/Retry|Try again/);assert.doesNotMatch(html,/\$|Add tokens|href=/);
 }
});
test('product read failure is independent: show known allowance/balance, no checkout action',()=>{
  const html=render({product:null,productError:true});assert.match(html,/Unreadable/);assert.match(html,/\$9\.876543/);assert.doesNotMatch(html,/Add tokens|href="\/checkout/);
  assert.doesNotMatch(render({productError:true}),/Add tokens|href="\/checkout/);
});
test('holds remain labelled as reservations, separate from recorded spend and available balance',()=>{
 const html=render({budget:{...budget,day_reserved_microusd:100000,month_reserved_microusd:100000,topup_reserved_microusd:250000}});
 const words=stripTags(html);assert.match(words,/Runs in progress reserve \$0\.10 of allowance and \$0\.25 of top-up/);assert.match(words,/This month · \$1\.23 of/);
});
