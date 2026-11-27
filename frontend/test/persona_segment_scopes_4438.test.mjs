/** D4438 (#4438) — mounted SEG7: scopes, the page blocks, unreadable/missing counts and waiting suggestions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PersonaSegmentsPage } from '../src/pages/admin/segments/PersonaSegments.jsx';
import { ScopeControls, SuggestionsInset, useScopedOverview } from '../src/pages/admin/segments/SegmentScopeControls.jsx';
const h = React.createElement;
const summary=(n=3)=>({
 members:{available:true,total:n+1,in_segment:n,no_segment:1,new_30d:1,profile_differs:0},
 segments:{available:true,rows:[{id:'founder_new',members:n,new_30d:1}]},
 by_profile:{available:true,profiles:['founder','investor','advisor','partner','exploring'].map(profile=>({profile,members:profile==='founder'?n+1:0,no_segment:profile==='founder'?1:0,segments:profile==='founder'?[{id:'founder_new',count:n}]:[]})),other:{members:0,no_segment:0,segments:[]}},
 sub_accounts:{available:true,lp:{total:0,no_segment:0,by_segment:{},definition:'Approved LP applications'},product_tester:{recorded:false,reason:'Not recorded'}},
 how_set:{available:true,counts:{router:n,self_select:0,admin_retag:0,not_recorded:0}},
 confidence:{available:true,over:n,not_recorded:0,bands:['under_50','50_69','70_89','90_up'].map(key=>({key,count:key==='90_up'?n:0}))},
 weekly:{available:true,weeks:[{week_start:'2026-11-02',count:n,to_date:true}],undated:0},moves_30d:{available:true,count:2}
});
const profiles={segments:[{key:'founder_new',name:'Founder — New Venture',profile:'founder',status:'active',who:'A synthetic segment'}]};
const coverage={segments:[{...profiles.segments[0],needs:{recorded:false,reason:'HQ has not written needs yet.'},gap_kinds:[],offers:Object.fromEntries(['programs','perks','events','content','sidebar_links'].map(k=>[k,{available:true,count:0}]))}]};
const scopes={scopes:[{code:'hq',label:'HQ-held accounts'},{code:'fr',label:'France'},{code:'*',label:'All studios'}],registry:{readable:true}};
function fake(overrides={}){
 const calls=[];const record=(name,fn)=>(...args)=>{calls.push([name,...args]);return Promise.resolve().then(()=>fn(...args));};
 return {calls,api:{scopes:record('scopes',()=>scopes),overview:record('overview',(s)=>({summary:summary(s==='fr'?8:s==='*'?11:3),profiles,coverage})),suggestions:record('suggestions',(s)=>({suggestions:[{uid:'s-'+s,text:'Proposal for '+s,origin_code:s,suggested_by_name:'Synthetic admin'}]})),...overrides}};
}
async function mounted(element) {
  const restore = installDocument();
  const prior = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  const render = async (v) => { await act(async () => { root.render(h(MemoryRouter, null, v)); await settle(); }); };
  await render(element);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '';
  const byId = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  return {
    text: () => text(document.body), of: (id) => text(byId(id)), props: (id) => props(byId(id)), has: (id) => !!byId(id), render,
    async change(id, value) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value, checked: value } }); await settle(); }); },
    async clickText(label) { const n=walk(document.body).find((n)=>n.tagName==='BUTTON' && text(n).trim()===label); assert.ok(n, label); await act(async()=>{props(n).onClick();await settle();}); },
    async settle() { await act(settle); },
    async close() { await act(async () => root.unmount()); globalThis.matchMedia = prior; restore(); },
  };
}


async function withPage(api,fn){
 const before=globalThis.fetch;
 globalThis.fetch=async(url)=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>String(url).includes('/admin/segments')?summary():profiles});
 const page=await mounted(h(PersonaSegmentsPage,{superAdmin:true,scopeApi:api}));
 try{await fn(page);}finally{await page.close();globalThis.fetch=before;}
}
test('scope changes re-read counts/cards/charts and pending suggestions, without a remote member-list door',async()=>{
 const {api,calls}=fake();
 await withPage(api,async page=>{
  assert.match(page.of('seg-tile-tagged'),/3.*of 4 members/);
  assert.match(page.of('seg-suggestions-inset'),/Proposal for hq/);
  await page.change('seg-scope-select','fr');
  assert.match(page.of('seg-tile-tagged'),/8.*of 9 members/);
  assert.match(page.of('seg-cards'),/8 members/);
  assert.match(page.of('seg-weekly-summary'),/8 members/);
  assert.match(page.of('seg-suggestions-inset'),/Proposal for fr/);
  assert.equal(page.has('seg-tile-open-unclassified'),false);
  assert.deepEqual(calls.filter(([n])=>n==='overview').map(c=>c[1]),['hq','fr']);
 });
});
test('a missing primary figure reads Not recorded and preserves other readable blocks',async()=>{
 const {api}=fake({overview:async()=>({summary:{...summary(),members:{...summary().members,in_segment:null}},profiles,coverage})});
 await withPage(api,async page=>{assert.match(page.of('seg-tile-tagged'),/Not recorded/);assert.doesNotMatch(page.of('seg-tile-tagged'),/>?0 members/);assert.match(page.of('seg-cards'),/3 members/);});
});
test('a failed scope keeps the selector usable and gives SEG12, never a zero count',async()=>{
 const {api}=fake({overview:async(s)=>{if(s==='fr')throw new Error('offline');return {summary:summary(),profiles,coverage};}});
 await withPage(api,async page=>{await page.change('seg-scope-select','fr');assert.match(page.of('seg-all-failed'),/Persona segments could not be read/);assert.equal(page.props('seg-scope-select').disabled,false);assert.equal(page.has('seg-tile-tagged'),false);await page.change('seg-scope-select','hq');assert.match(page.of('seg-tile-tagged'),/3/);});
});
test('scope list failures say could not be read; retry recovers the real registry',async()=>{
 let n=0;const {api}=fake({scopes:async()=>{if(n++===0)throw new Error('offline');return scopes;}});
 const page=await mounted(h(ScopeControls,{scope:'hq',onChange(){},api}));
 try{assert.match(page.text(),/Could not be read. This is not a claim that there are none/);assert.equal(page.props('seg-scope-select').disabled,true);await page.clickText('Try again');assert.equal(page.props('seg-scope-select').disabled,false);assert.match(page.text(),/France/);}finally{await page.close();}
});
test('waiting suggestions distinguish failure, malformed reply and actual empty scope',async()=>{
 let n=0;const {api}=fake({suggestions:async()=>{n++;if(n===1)throw new Error('offline');if(n===2)return {};return {suggestions:[]};}});
 const page=await mounted(h(SuggestionsInset,{scope:'hq',api}));
 try{assert.match(page.text(),/Could not be read/);assert.doesNotMatch(page.text(),/No suggestions waiting/);await page.clickText('Try again');assert.match(page.text(),/Could not be read/);await page.clickText('Try again');assert.match(page.text(),/No suggestions waiting for HQ in this scope/);}finally{await page.close();}
});
test('late replies from an old scope cannot replace the selected studio',async()=>{
 let finish;const {api}=fake({overview:(s)=>s==='hq'?new Promise(r=>{finish=r;}):Promise.resolve({summary:summary(8),profiles,coverage})});
 function Harness({scope}){const read=useScopedOverview(scope,0,true,api);return h('p',null,read.seg.status==='ready'?read.seg.data.members.in_segment:read.seg.status);}
 const page=await mounted(h(Harness,{scope:'hq'}));
 try{assert.equal(page.text(),'loading');await page.render(h(Harness,{scope:'fr'}));assert.equal(page.text(),'8');await act(async()=>{finish({summary:summary(3),profiles,coverage});});await page.settle();assert.equal(page.text(),'8');}finally{await page.close();}
});

test('all-studio needs are Not recorded instead of an invented combined total',async()=>{
 const {api}=fake({overview:async()=>({summary:summary(11),profiles,coverage:{recorded:false,reason:'Choose one studio to read needs and offers.',segments:[]}})});
 await withPage(api,async page=>{assert.match(page.of('seg-needs-not-recorded'),/Not recorded.*Choose one studio/);assert.match(page.of('seg-tile-tagged'),/11/);});
});
