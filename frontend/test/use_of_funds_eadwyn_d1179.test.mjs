import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import UseOfFundsEadwyn, { UseOfFundsMilestoneWording, milestonePlacement } from '../src/workspaces/UseOfFundsEadwyn.jsx';
import { useOfFundsApi } from '../src/lib/api/useOfFunds.js';
const item = { text: 'The recorded plans differ.', citations: [
  {ref:'plan',label:'Base plan',source:'Typed',quote:'raise 150000000 cents',href:'/raise/use-of-funds?project=7'},
  {ref:'deck',label:'Pitch deck Ask slide',source:'Recorded',quote:'Raising $1.2M',href:'/raise/pitch?project=7'},
] };
const proposal = { reading:{mode:'check',items:[item],gaps:[],cost_micro_usd:10}, receipt:{payload:'synthetic-receipt',signature:'synthetic-signature'} };
async function mounted(overrides = {}) {
  const restore = installDocument();
  const saved = { ...useOfFundsApi }; const calls = [];
  const previousMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = tag => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  useOfFundsApi.readings = async p => { calls.push(['read', p]); return overrides.read ? overrides.read(p) : { items: [] }; };
  useOfFundsApi.previewReading = async (p, body, headers) => { calls.push(['preview',p,body,headers]); return overrides.preview ? overrides.preview(p,body) : proposal; };
  useOfFundsApi.keepReading = async (p, receipt) => { calls.push(['keep', p, receipt]); return overrides.keep ? overrides.keep(p, receipt) : {reading:{...proposal.reading,uid:'kept-one',captured_at:'2026-10-26'}}; };
  useOfFundsApi.readingRoadmap=async p=>{calls.push(['roadmap',p]);return {items:[{id:1,objective:'Product milestone'}]};};
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const fields=[{parts:[{name:'milestone_label.product'},{name:'milestone_label.reserve'}]}];
  const render=async(projectId,values={})=>{await act(async()=>root.render(React.createElement(overrides.wording?UseOfFundsMilestoneWording:UseOfFundsEadwyn,{projectId,fields,values,setValue:(...a)=>calls.push(['placed',...a])})));await flush();};
  await render(7);
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = n => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '';
  const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return { calls, render, flush, async choose(label,value){const n=walk(container).find(n=>n.tagName?.toUpperCase()==='SELECT'&&props(n)['aria-label']===label);assert.ok(n);await act(async()=>props(n).onChange({target:{value}}));await flush();}, text: () => text(container),
    async start(label) { const node = walk(container).find(n => n.tagName?.toUpperCase() === 'BUTTON' && text(n) === label); assert.ok(node); let pending; await act(async () => { pending = props(node).onClick(); }); return { pending }; },
    async click(label) { const node = walk(container).find(n => n.tagName?.toUpperCase() === 'BUTTON' && text(n) === label); assert.ok(node, `Button missing: ${label}`); await act(async () => { await props(node).onClick(); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(useOfFundsApi, saved); globalThis.matchMedia = previousMatch; restore(); },
  };
}
test('UF14 mount spends nothing; check cites both records and Dismiss keeps nothing',async()=>{
 const ui=await mounted();try{
  assert.deepEqual(ui.calls,[['read',7]]);await ui.click('Check this plan');
  assert.match(ui.text(),/Proposal · plan check/);assert.match(ui.text(),/Base plan/);assert.match(ui.text(),/Pitch deck Ask slide/);assert.match(ui.text(),/Source: Typed/);assert.match(ui.text(),/Raising \$1.2M/);
  assert.deepEqual(ui.calls[1][2],{mode:'check'});assert.equal(decodeURIComponent(ui.calls[1][3]['X-Rail-Option']),'draft:raise/use-of-funds-check');
  await ui.click('Dismiss');assert.equal(ui.calls.some(c=>c[0]==='keep'),false);assert.doesNotMatch(ui.text(),/The recorded plans differ/);
 }finally{await ui.close();}
});
test('Keep sends only the signed receipt, records the reading and closes its write dialog',async()=>{
 const ui=await mounted();try{await ui.click('Check this plan');assert.match(ui.text(),/Keep saves this reading/);await ui.click('Keep this reading');assert.deepEqual(ui.calls.find(c=>c[0]==='keep'),['keep',7,proposal.receipt]);assert.match(ui.text(),/Kept plan check/);assert.doesNotMatch(ui.text(),/Proposal · plan check/);}finally{await ui.close();}
});
test('Explain the runway has its own option and never submits a financial value',async()=>{
 const ui=await mounted();try{await ui.click('Explain the runway');const c=ui.calls.find(c=>c[0]==='preview');assert.deepEqual(c[2],{mode:'runway'});assert.equal(decodeURIComponent(c[3]['X-Rail-Option']),'draft:raise/use-of-funds-runway');assert.match(ui.text(),/changes no plan value/);}finally{await ui.close();}
});
test('failed kept reads and failed Keep stay Unreadable, never show raw errors or a fake saved result',async()=>{
 const ui=await mounted({read:async()=>{throw new Error('private-source-business-text');},keep:async()=>{throw new Error('private-source-business-text');}});try{assert.match(ui.text(),/Kept readings · Unreadable/);await ui.click('Check this plan');await ui.click('Keep this reading');assert.match(ui.text(),/This reading is Unreadable/);assert.match(ui.text(),/Keep this reading/);assert.doesNotMatch(ui.text(),/private-source-business-text|Kept plan check/);}finally{await ui.close();}
});
test('late previews and kept reads from another venture are dropped',async()=>{
 const resolvers=new Map();const ui=await mounted({preview:p=>new Promise(done=>resolvers.set(p,done))});try{
  const pending=await ui.start('Check this plan');await ui.render(8);const current=await ui.start('Check this plan');
  await act(async()=>{resolvers.get(7)({...proposal,reading:{...proposal.reading,items:[{...item,text:'Previous venture private reading.'}]}});await pending.pending;});
  assert.doesNotMatch(ui.text(),/Previous venture private reading/);assert.equal(ui.calls.some(c=>c[0]==='keep'),false);
  await act(async()=>{resolvers.get(8)({...proposal,reading:{...proposal.reading,items:[{...item,text:'Current venture reading.'}]}});await current.pending;});assert.match(ui.text(),/Current venture reading/);
 }finally{await ui.close();}
});
test('milestone Accept places only a blank name from the roadmap; Dismiss and preview never save',async()=>{
 const ui=await mounted({wording:true,preview:async()=>({reading:{mode:'wording',items:[{text:'Launch the product',citations:[{ref:'roadmap',label:'Build roadmap',source:'Recorded',quote:'Product milestone',href:'/build/product-roadmap?project=7'}]}],gaps:[]}})});
 try{assert.deepEqual(ui.calls,[['roadmap',7]]);await ui.choose('Build roadmap item','1');await ui.click('Suggest wording from your roadmap');assert.deepEqual(ui.calls.find(c=>c[0]==='preview')[2],{mode:'wording',okr_id:1});assert.equal(ui.calls.some(c=>c[0]==='placed'),false);assert.match(ui.text(),/Source: Recorded/);await ui.click('Dismiss');assert.equal(ui.calls.some(c=>c[0]==='placed'),false);
 await ui.click('Suggest wording from your roadmap');await ui.click('Accept');assert.deepEqual(ui.calls.find(c=>c[0]==='placed'),['placed','milestone_label.product','Launch the product']);assert.equal(ui.calls.some(c=>c[0]==='keep'),false);
 }finally{await ui.close();}
});
test('milestone placement refuses every financial target and never overwrites typed wording',()=>{
 for(const name of ['amount_to_raise','pct.product','runway_months','cost_cents','annual_cents','milestone_by.product'])assert.equal(milestonePlacement(name,'Launch product',''),null,name);
 assert.equal(milestonePlacement('milestone_label.product','New wording','My words'),null);
 assert.deepEqual(milestonePlacement('milestone_label.product','Launch product',''),{field:'milestone_label.product',value:'Launch product'});
});
test('typed wording arriving while Eadwyn runs is never replaced by Accept',async()=>{
 let done;const ui=await mounted({wording:true,preview:()=>new Promise(r=>done=r)});try{
  await ui.choose('Build roadmap item','1');const pending=await ui.start('Suggest wording from your roadmap');await ui.render(7,{'milestone_label.product':'Typed while running'});
  await act(async()=>{done({reading:{mode:'wording',items:[{text:'Proposed name',citations:[]}],gaps:[]}});await pending.pending;});
  await ui.click('Accept');assert.equal(ui.calls.some(c=>c[0]==='placed'),false);assert.match(ui.text(),/Your milestone name stays/);
 }finally{await ui.close();}
});
test('missing source reasons survive a failed preview without showing an invented reading',async()=>{
 const ui=await mounted({preview:async()=>{throw Object.assign(new Error('raw private diagnostic'),{status:409,data:{gaps:[{label:'Base plan',state:'not_recorded',reason:'Initialize the plan before reading it.'}]}});}});try{await ui.click('Check this plan');assert.match(ui.text(),/Base plan · Not recorded/);assert.match(ui.text(),/Initialize the plan before reading it/);assert.doesNotMatch(ui.text(),/raw private diagnostic|The recorded plans differ/);}finally{await ui.close();}
});
test('a check without a supported mismatch names its sources and never certifies the plan',async()=>{
 const ui=await mounted({preview:async()=>({...proposal,reading:{...proposal.reading,items:[],source_refs:[{ref:'plan',label:'Base plan source',source:'Typed',href:'/raise/use-of-funds',as_of:'2026-10-25'}]}})});
 try{await ui.click('Check this plan');assert.match(ui.text(),/does not certify the plan/);assert.match(ui.text(),/Sources read/);assert.match(ui.text(),/Base plan source/);}finally{await ui.close();}
});
