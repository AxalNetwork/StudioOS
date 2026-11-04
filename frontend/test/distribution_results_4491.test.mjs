/** D4491 — independent Results presentation controls while reporting-window semantics are settled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ResultsTab from '../src/pages/cycles/distribution/ResultsTab.jsx';
import { figure, funnelWidth, costPerLead, money } from '../src/pages/cycles/distribution/resultsModel.js';
const render = state => renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(ResultsTab,{state,onRetry(){}})));
test('missing figures preserve reasons and measured zero remains zero',()=>{
 assert.deepEqual(figure(null,'no UTM tag'),{value:null,reason:'Not recorded: no UTM tag'});
 assert.deepEqual(figure(0),{value:0,reason:null});
 assert.equal(money(null),null);
 assert.equal(money(0),'$0.00');
 assert.equal(costPerLead(null,18),null);
 assert.equal(costPerLead(62000,18),34.44);
 assert.equal(funnelWidth(null,18),null);
 assert.equal(funnelWidth(4,18),4/18*100);
});
test('Results names its Revenue boundary, missing reasons and separate cost sources without writes',()=>{
 const html=render({status:'ready',campaigns:[{uid:'one',name:'Recorded campaign',leads:null,leads_reason:'no UTM tag',spend_cents:null,spend_cents_reason:'no spend entered',cost_per_lead_cents:null,cost_per_lead_cents_reason:'no spend entered',cost_sources:['mercury','attributed']}],sources:[],channels:[]});
 assert.match(html,/Revenue stays on Revenue and traction. Nothing here changes MRR./);
 assert.match(html,/href="\/grow\/revenue-and-traction"/);
 assert.match(html,/Not recorded: no UTM tag/);
 assert.match(html,/Not recorded: no spend entered/);
 assert.match(html,/Mercury.*UTM attribution/);
 assert.doesNotMatch(html,/<form|<input|<button/);
});
test('pending and failed reads never become measured empty results',()=>{
 assert.match(render({status:'loading'}),/Loading Results/);
 const html=render({status:'unreadable'});
 assert.match(html,/Couldn’t be read. This is not a claim that there are none./);
 assert.match(html,/Try again/);
 assert.doesNotMatch(html,/No campaigns recorded/);
});
