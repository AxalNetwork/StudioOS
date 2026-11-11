import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import AdsTab, { AdsContent, SpendChart } from '../src/pages/cycles/distribution/AdsTab.jsx';
import { AD_MONEY_BANNER, sliderAmount, amountSlider, budgetTotal, chartMonths } from '../src/pages/cycles/distribution/adsModel.js';
const h=React.createElement;
const campaign={uid:'a',name:'Launch',budget_cents:10000,starts_on:'2026-09-01',ends_on:'2026-11-30'};
const channel={uid:'g',name:'Google Search',planned_budget_cents:6000,budget_type:'lifetime',months:[{month:'2026-09',spend_cents:2000,source:'manual'},{month:'2026-11',spend_cents:3000,source:'mercury'}]};
test('banner is present even without a campaign',()=>{assert.ok(html(h(AdsTab,{})).includes(AD_MONEY_BANNER));});
test('a missing month has no bar, has its label, and is never a zero',()=>{
 const rows=chartMonths(channel,campaign);
 assert.deepEqual(rows[1],{label:'2026-10',blank:true,values:[],source:null,note:'2026-10: Not recorded — no spend was entered.'});
 const out=html(h(SpendChart,{channel,campaign}));assert.match(out,/2026-10: Not recorded/);
 const empty={...channel,months:[]};const chart=html(h(SpendChart,{channel:empty,campaign}));assert.doesNotMatch(chart,/<rect[^>]*height="0"/);
 assert.equal(chartMonths(channel,{}) .length,0);
});
test('slider amounts round to cents, clamp, and total known budgets',()=>{
 assert.equal(sliderAmount(60,10000),6000);assert.equal(amountSlider(6000,10000),60);assert.equal(sliderAmount(150,10000),10000);assert.equal(sliderAmount(-1,10000),0);assert.equal(sliderAmount(50,null),null);
 assert.equal(budgetTotal([channel,{planned_budget_cents:4000}]),10000);assert.equal(budgetTotal([{planned_budget_cents:null}]),null);
});
test('platform cards, Later copy, source chips and creative drafts are honest',()=>{
 const out=html(h(AdsContent,{data:{campaign,channels:[channel],can_write:true},creatives:[]}));
 assert.equal((out.match(/Not offered yet/g)||[]).length,4);assert.doesNotMatch(out,/Connected/);
 assert.match(out,/Creating ads, pausing them and rules are not offered yet/);assert.match(out,/Create and edit ads from here/);assert.match(out,/Pause a channel from here/);
 assert.match(out,/Entered by hand/);assert.match(out,/Mercury/);assert.match(out,/nothing runs from here/);
 assert.equal((out.match(/Write it, or ask Eadwyn/g)||[]).length,4);assert.match(out,/Creative proposals and their price quote are not offered yet/);
});
