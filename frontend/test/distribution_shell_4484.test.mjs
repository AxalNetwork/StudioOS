// D4484: real router ranking, shared Distribution frame and honest Ask states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { MemoryRouter, Route, createRoutesFromElements, matchRoutes } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import growDistributionRoutes from '../src/routes/growDistribution.jsx';
import { readRoutesSource, lazyImports } from './_routesSource.mjs';
import { mountContracts } from './_contracts_dom.mjs';
import CycleRoute, { primaryForModule } from '../src/pages/cycles/CycleRoute.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { isCyclePath } from '../src/pages/cycles/cyclePaths.js';
import DistributionTabs, { DistributionAsk } from '../src/pages/cycles/distribution/DistributionTabs.jsx';
import { Card, KpiCard, NotRecorded, SourceChip, ProposalBlock, HoldLine, ComingSoon } from '../src/pages/cycles/distribution/DistributionParts.jsx';
import { DISTRIBUTION_PAGE, DISTRIBUTION_TABS, distributionAskState } from '../src/pages/cycles/distribution/distributionModel.js';
import HeaderAsk from '../src/ui/HeaderAsk.jsx';
import { useAskRail, __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
const h=React.createElement;
const html=(el)=>renderToStaticMarkup(h(MemoryRouter,null,el));
const labelText=(text)=>text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
function Rail(){useAskRail(true,'different page','Distribution');return null;}
const BUDGET={licence:'founder',daily_microusd:0,monthly_microusd:100,day_spend_microusd:0,month_spend_microusd:0,balance_microusd:0,day_reserved_microusd:0,month_reserved_microusd:0,topup_reserved_microusd:0,held_for_review:[]};

test('every explicit tab route reaches CycleRoute with the same founder/admin guard',()=>{
 const guards=[];const fragment=growDistributionRoutes({guard:(roles,element)=>{guards.push(roles);return element;}});
 const routes=createRoutesFromElements(fragment);
 const paths=['channels','campaigns','campaigns/new','campaigns/c1','calendar','ads','newsletter','prospects','inbox','results'];
 const got=paths.map(path=>{const route=matchRoutes(routes,`/grow/distribution/${path}`)?.at(-1).route;return [path,route?.path,route?.element.props.cycle,route?.element.props.slug,route?.element.props.tab];});
 assert.deepEqual(got,paths.map(path=>[path,`/grow/distribution/${path==='campaigns/c1'?'campaigns/:uid':path}`,'grow','distribution',path.startsWith('campaigns')?'campaigns':path]));
 assert.deepEqual(guards,paths.map(()=>['admin','founder']));
 assert.equal(lazyImports().some(r=>r.name==='CycleRoute'&&r.source==='frontend/src/routes/growDistribution.jsx'&&r.target==='frontend/src/pages/cycles/CycleRoute'),true);
});

test('Overview and ordinary Distribution record uids retain the original routes and campaign pages keep the cycle frame',()=>{
 const source=readRoutesSource();
 assert.match(source,/<Route path="\/grow\/:slug\/:id" element=\{guard\(\['admin', 'founder'\], <CycleRoute cycle="grow" record \/>\)\}/);
 const routes=createRoutesFromElements(h(React.Fragment,null,growDistributionRoutes({guard:(_roles,node)=>node}),h(Route,{path:'/grow/:slug/:id',element:h('output',{'data-record':true})}),h(Route,{path:'/grow/:slug',element:h('output',{'data-overview':true})})));
 assert.deepEqual(['/grow/distribution','/grow/distribution/channel-uid'].map(path=>matchRoutes(routes,path)?.at(-1).route.path),['/grow/:slug','/grow/:slug/:id']);
 assert.deepEqual(['/grow/distribution/campaigns/new','/grow/distribution/campaigns/c1','/grow/distribution/campaigns/c1/extra'].map(isCyclePath),[true,true,false]);
});

test('only Distribution replaces the Grow primary and all links retain the project',()=>{
 const actions=MODULES.grow.map(m=>[m.slug,primaryForModule('grow',m.slug,'?project_id=7',()=>{})]);
 assert.deepEqual(actions.filter(([slug])=>slug!=='distribution').map(([,a])=>[a.label,a.href]),Array(6).fill(['Share an update','/grow/update?project_id=7']));
 assert.deepEqual(primaryForModule('grow','distribution','?project_id=7&filter=other'),{label:'+ New campaign',href:'/grow/distribution/campaigns/new?project_id=7'});
});

test('tab order, active state, unknown Inbox count and honest pending/coming-soon states',()=>{
 const labels=['Overview','Channels','Campaigns','Calendar','Ads','Newsletter','Prospects','Inbox','Results'];
 assert.deepEqual(DISTRIBUTION_TABS.map(t=>t.label),labels);
 const out=html(h(DistributionTabs,{tab:'campaigns',search:'?project_id=7',action:primaryForModule('grow','distribution','?project_id=7')},h(ComingSoon)));
 assert.match(out,/aria-current="page"[^>]*href="\/grow\/distribution\/campaigns\?project_id=7"/);
 assert.doesNotMatch(out,/ds-count|\bFill\b/);
 assert.match(labelText(out),/Coming in this module soon/);
 const pending=html(h(DistributionTabs,{loading:true},h(Card,null,'existing channels')));
 assert.match(pending,/aria-label="Loading Overview"/);assert.doesNotMatch(pending,/existing channels/);
 const counted=html(h(DistributionTabs,{inboxCount:4},h(Card,null,'existing channels')));
 assert.match(counted,/class="ds-count">4/);assert.match(counted,/existing channels/);
});

test('Ask counts come from the explicit Distribution page; null, zero and failed reads draw no chip',async()=>{
 const saved=askPanelAdapter.waiting;
 try{for(const count of [null,0,'failed']){
  __resetEadwynPanelForTest();askPanelAdapter.waiting=async()=>count==='failed'?{available:false}:{available:true,data:{count}};
  const m=await mountContracts(h(React.Fragment,null,h(Rail),h(HeaderAsk,{page:DISTRIBUTION_PAGE,testId:'distribution-ask'})));
  try{assert.equal(m.nodes().some(n=>m.props(n)?.['data-testid']==='distribution-ask-waiting'),false);}finally{await m.unmount();}
 }
 __resetEadwynPanelForTest();const pages=[];askPanelAdapter.waiting=async page=>{pages.push(page);return {available:true,data:{count:3}};};
 const m=await mountContracts(h(React.Fragment,null,h(Rail),h(HeaderAsk,{page:DISTRIBUTION_PAGE,testId:'distribution-ask'})));
 try{const button=m.nodes().find(n=>m.props(n)?.['data-testid']==='distribution-ask');assert.deepEqual(pages,[DISTRIBUTION_PAGE]);assert.equal(m.props(button)['aria-label'],'Ask Eadwyn, 3 waiting');
  await act(async()=>m.props(button).onClick());assert.equal(m.props(button)['aria-expanded'],true);assert.match(m.props(button).className,/bg-axal-lavender/);
 }finally{await m.unmount();}
 }finally{askPanelAdapter.waiting=saved;__resetEadwynPanelForTest();}
});

test('Ask off/out retain access to existing proposals with the specified tooltip and Add tokens; unknown budget is not out',async()=>{
 assert.deepEqual([distributionAskState(false,{budget:null}),distributionAskState(false,{budget:{...BUDGET,monthly_microusd:0}}),distributionAskState(true,{budget:BUDGET}),distributionAskState(false,{budget:{...BUDGET,monthly_microusd:0,unlimited:true}})],['rest','out','off','rest']);
 const saved={mine:aiBudgetApi.mine,topUp:aiBudgetApi.topUp,waiting:askPanelAdapter.waiting};
 aiBudgetApi.mine=async()=>({...BUDGET,monthly_microusd:0});aiBudgetApi.topUp=async()=>({});askPanelAdapter.waiting=async()=>({available:false});
 try{for(const aiOff of [true,false]){
  __resetEadwynPanelForTest();const m=await mountContracts(h(React.Fragment,null,h(Rail),h(DistributionAsk,{aiOff})));
  try{const button=m.nodes().find(n=>m.props(n)?.['data-testid']==='distribution-ask');assert.equal(m.props(button).disabled,false);assert.equal(m.props(button).title,aiOff?'AI is switched off. Everything manual still works.':'Not enough AI tokens');assert.equal(m.text().includes('Add tokens'),!aiOff);}finally{await m.unmount();}
 }}finally{Object.assign(aiBudgetApi,{mine:saved.mine,topUp:saved.topUp});askPanelAdapter.waiting=saved.waiting;__resetEadwynPanelForTest();}
});

test('shared parts preserve unknowns and proposals decide only on a press',async()=>{
 const out=html(h(React.Fragment,null,h(KpiCard,{label:'Revenue'}),h(SourceChip,{source:'mercury'}),h(HoldLine,{microusd:null}),h(NotRecorded)));
 assert.match(labelText(out),/Not recorded/);assert.doesNotMatch(out,/\$0/);
 const calls=[];const m=await mountContracts(h(ProposalBlock,{proposal:{uid:'p',status:'proposed',eyebrow:'Proposal',text:'Synthetic proposal'},onAccept:()=>calls.push('accept'),onEdit:()=>calls.push('edit'),onDiscard:()=>calls.push('discard')}));
 try{assert.deepEqual(calls,[]);await m.click('Accept');await m.click('Edit');await m.click('Discard');assert.deepEqual(calls,['accept','edit','discard']);}finally{await m.unmount();}
 const route=readFileSync('frontend/src/pages/cycles/CycleRoute.jsx','utf8');assert.match(route,/header=\{distribution \? null : undefined\}/);assert.match(route,/distributionTab === 'campaigns' \? <CampaignsTab[^\n]+: <ComingSoon/);
});


test('the mounted Overview keeps its legacy table and tool doors while an unlanded tab makes no module read',async()=>{
 const original=globalThis.fetch;const paths=[];
 globalThis.fetch=async(url)=>{
  const path=String(url);paths.push(path);
  const data=path.includes('/auth/me') ? {id:1,role:'founder'} : path.includes('/cycles/grow/modules/distribution') ? {module:{slug:'distribution',name:'Distribution'},card:{slug:'distribution',name:'Distribution',state:'empty',series:[]},records:{cols:[{key:'name',label:'Channel'}],rows:[{id:1,cells:{name:'Synthetic existing channel'}}],total:1,page:1,page_size:25},parts:{}} : path.includes('/ai-budget/me') ? BUDGET : path.includes('/rail/proposals') ? {proposals:[]} : {};
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const m=await mountContracts(h(AuthProvider,null,h(RailPageProvider,{role:'founder'},h(CycleRoute,{cycle:'grow',slug:'distribution'}))),'/grow/distribution?project_id=7',{id:1,role:'founder'});
  try{await m.flush();assert.match(m.text(),/Synthetic existing channel/);assert.match(m.text(),/Open landing-page builder/);assert.match(m.text(),/Open launch calendar/);assert.equal(m.nodes().filter(n=>m.props(n)?.['data-testid']==='distribution-ask').length,1);}finally{await m.unmount();}
  paths.length=0;
  const other=await mountContracts(h(AuthProvider,null,h(RailPageProvider,{role:'founder'},h(CycleRoute,{cycle:'grow',slug:'distribution',tab:'ads'}))),'/grow/distribution/ads?project_id=7',{id:1,role:'founder'});
  try{await other.flush();assert.match(other.text(),/Coming in this module soon/);assert.equal(paths.some(p=>p.includes('/cycles/grow/modules/distribution')||p.includes('/cycles/grow/campaigns')),false);}finally{await other.unmount();}
 }finally{globalThis.fetch=original;__resetEadwynPanelForTest();}
});
