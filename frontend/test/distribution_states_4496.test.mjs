/** D4496: recorded cross-tab triggers, safe fixed copy, writer/AI separation and responsive states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { distributionStates, distributionKpis, DISTRIBUTION_COPY } from '../src/pages/cycles/distribution/distributionStates.js';
import DistributionStates, { DistributionReadError, DistributionWaitingNote } from '../src/pages/cycles/distribution/DistributionStates.jsx';
import { mountContracts } from './_contracts_dom.mjs';
const h=React.createElement;
const budget={licence:'founder',daily_microusd:0,monthly_microusd:100,day_spend_microusd:0,month_spend_microusd:0,balance_microusd:0,day_reserved_microusd:0,month_reserved_microusd:0,topup_reserved_microusd:0,held_for_review:[]};
const state=props=>distributionStates({canWrite:true,...props});
const html=model=>renderToStaticMarkup(h(DistributionStates,{model}));

test('AI off, paused and busy affect Ask while manual work remains enabled',()=>{
 const off=state({aiOff:true});assert.deepEqual(off.manual,{disabled:false,reason:null});assert.equal(off.ask.state,'off');assert.equal(off.ask.title,DISTRIBUTION_COPY.off);
 const paused=state({budgetReading:{budget:{...budget,ai_paused:true}}});assert.equal(paused.ask.ariaLabel,'Ask Eadwyn, unavailable: AI is paused for your studio');assert.equal(paused.ask.disabled,true);assert.match(html(paused),/Nothing else changes/);
 const busy=state({running:true});assert.equal(busy.ask.state,'running');assert.equal(busy.ask.title,'Ask Eadwyn · busy');
});
test('only a readable exhausted budget reports out; proposals remain visible and Add tokens is present',()=>{
 const out=state({budgetReading:{budget:{...budget,monthly_microusd:0}}});assert.equal(out.outOfTokens,true);assert.equal(out.ask.disabled,true);
 const markup=renderToStaticMarkup(h(DistributionWaitingNote,{outOfTokens:out.outOfTokens}));assert.match(markup,/the ones below stay/);assert.match(markup,/Add tokens/);
 for(const budgetReading of [{budget:null},{budget:{...budget,monthly_microusd:0},loading:true},{budget:{...budget,monthly_microusd:0},budgetError:true},{budget:{...budget,unlimited:true,monthly_microusd:0}}])assert.equal(state({budgetReading}).outOfTokens,false);
});
test('read-only Admin and advisor use recorded permission; unknown permission never enables a write',()=>{
 const admin=state({role:'admin',canWrite:false});assert.equal(admin.manual.disabled,true);assert.equal(admin.manual.reason,DISTRIBUTION_COPY.admin);assert.equal(admin.ask.disabled,true);assert.match(html(admin),/Eadwyn is off while you read a founder/);
 const advisor=state({role:'founder',canWrite:false});assert.equal(advisor.manual.reason,DISTRIBUTION_COPY.advisor);
 assert.equal(distributionStates({role:'founder'}).manual.disabled,true);
 assert.equal(state({role:'admin'}).manual.disabled,false);
});
test('plan locks use the real Growth/Studio tier check only when a requirement is supplied',()=>{
 const locked=state({requiredTier:'growth',user:{role:'founder',subscription_tier:'free'}});assert.equal(locked.locked,true);assert.match(html(locked),/Growth plan/);assert.match(html(locked),/Upgrade to unlock/);
 assert.equal(state({requiredTier:'growth',user:{role:'founder',subscription_tier:'growth'}}).locked,false);
 assert.equal(state({user:{role:'founder',subscription_tier:'free'}}).locked,false);
});
test('only recorded connection, paused-budget and missing-consent triggers produce their notes',()=>{
 const model=state({connection:{key:'linkedin',status:'not_connected'},campaign:{name:'Synthetic push',status:'paused',budget_used_pct:100},consent:{channel:'whatsapp',basis:'none',name:'Synthetic Ops'}});
 assert.deepEqual(model.notes.map(n=>n.text),['LinkedIn is not connected. Connect it to schedule posts there.','Synthetic push reached its budget and is paused.','Message blocked: Synthetic Ops has not opted into WhatsApp.']);
 assert.deepEqual(state({connection:{key:'meta',status:'suspended'},campaign:{status:'active',budget_used_pct:110},consent:{channel:'whatsapp',basis:'opted_in'}}).notes,[]);
});
test('raw provider/server text never enters a note or form error; unknown providers draw no claim',()=>{
 const secret='raw synthetic upstream detail';
 const model=state({providerFailure:{failed:true,provider:'meta',message:secret},readState:'unreadable',formState:'unreadable',error:new Error(secret)});
 const markup=html(model);assert.doesNotMatch(markup,new RegExp(secret));assert.match(markup,/Meta did not answer. Nothing was posted/);assert.match(markup,/not a claim that there are none/);assert.match(markup,/Type the values/);
 assert.deepEqual(state({providerFailure:{failed:true,provider:secret}}).notes,[]);
});
test('retry is explicit, invokes the supplied reader once and retains manual form children',async()=>{
 let calls=0;
 const m=await mountContracts(h(DistributionReadError,{onRetry:()=>calls++,form:true}));try{assert.equal(calls,0);await m.click('Try again');assert.equal(calls,1);}finally{await m.unmount();}
 assert.match(renderToStaticMarkup(h(DistributionStates,{model:state({formState:'unreadable'})},h('textarea',{defaultValue:'Typed by hand'}))),/Typed by hand/);
});
test('phone/tablet use the required KPI subsets, target floor and shared dark colours',()=>{
 assert.deepEqual(distributionKpis(390),['leads','replies','cost_per_lead','spend_vs_budget']);assert.deepEqual(distributionKpis(768),['leads','cost_per_lead','spend_vs_budget']);assert.equal(distributionKpis(1440),null);
 const css=readFileSync(new URL('../src/pages/cycles/distribution/distributionStates.css',import.meta.url),'utf8');assert.match(css,/min-height:44px/);assert.match(css,/\.dark \.ds-state-note/);assert.match(css,/max-width:639px/);
 assert.match(renderToStaticMarkup(h(DistributionWaitingNote,{outOfTokens:true})),/dark:text-amber-200/);
});

test('mounted Overview draws only four phone KPIs and three tablet KPIs, including null readings',async()=>{
 const {OverviewView}=await import('../src/pages/cycles/distribution/OverviewTab.jsx');
 const {MemoryRouter}=await import('react-router-dom');
 const old=globalThis.window;
 try {for(const [width,keys] of [[390,['leads','replies','cost_per_lead','spend_vs_budget']],[768,['leads','cost_per_lead','spend_vs_budget']]]) {
  globalThis.window={matchMedia:q=>({matches:q.includes('max-width: 639px')?width<640:width>=640&&width<1024,addEventListener(){},removeEventListener(){}})};
  const markup=renderToStaticMarkup(h(MemoryRouter,null,h(OverviewView,{data:{kpis:Object.fromEntries(keys.map(k=>[k,{value:null,sources:[]}]))}})));
  assert.deepEqual([...markup.matchAll(/data-testid="overview-kpi-([^"]+)"/g)].map(m=>m[1]),keys);
  assert.equal((markup.match(/class="ds-not-recorded">Not recorded/g)||[]).length,keys.length);
 }} finally {globalThis.window=old;}
});

test('writer permission ignores stale venture results, retries failures and never exposes their raw error',async()=>{
 const {default:useDistributionAccess}=await import('../src/pages/cycles/distribution/useDistributionAccess.js');
 const pending=[];const read=id=>new Promise((resolve,reject)=>pending.push({id,resolve,reject}));
 function Subject(){const [id,setId]=React.useState(7);const access=useDistributionAccess(id,read);return h(React.Fragment,null,h('output',null,`${id}:${access.state}:${String(access.canWrite)}`),h('button',{onClick:()=>setId(8)},'Other venture'),h('button',{onClick:access.retry},'Retry permission'));}
 const m=await mountContracts(h(Subject));try{
  assert.match(m.text(),/7:loading:null/);await m.click('Other venture');
  await React.act(async()=>pending[0].resolve({can_write:true}));assert.match(m.text(),/8:loading:null/);
  await React.act(async()=>pending[1].resolve({can_write:false}));assert.match(m.text(),/8:ready:false/);
  await m.click('Retry permission');assert.match(m.text(),/8:loading:null/);
  await React.act(async()=>pending[2].reject(new Error('private permission detail')));assert.match(m.text(),/8:unreadable:null/);assert.doesNotMatch(m.text(),/private permission detail/);
 }finally{await m.unmount();}
});

test('read-only campaign empty actions stay disabled in both the list and Overview',async()=>{
 const {MemoryRouter}=await import('react-router-dom');
 const {CampaignsList}=await import('../src/pages/cycles/distribution/CampaignsTab.jsx');
 const {OverviewView}=await import('../src/pages/cycles/distribution/OverviewTab.jsx');
 const list=renderToStaticMarkup(h(MemoryRouter,null,h(CampaignsList,{read:{state:'ready',campaigns:[],counts:{all:0}},canWrite:false,writeReason:DISTRIBUTION_COPY.advisor})));
 assert.match(list,/disabled=""[^>]*>\+ New campaign/);assert.doesNotMatch(list,/href="[^"]*campaigns\/new/);
 const overview=renderToStaticMarkup(h(MemoryRouter,null,h(DistributionStates,{model:state({role:'admin',canWrite:false})},h(OverviewView,{data:{campaigns:{items:[],total:0},channels:{items:[]}}}))));
 assert.match(overview,/disabled=""[^>]*>New campaign/);assert.doesNotMatch(overview,/href="[^"]*campaigns\/new/);assert.match(overview,/No connected channels recorded/);
});

test('mounted shell uses real permission and budget readers; AI off keeps manual creation, pause names its reason',async()=>{
 const {default:DistributionTabs}=await import('../src/pages/cycles/distribution/DistributionTabs.jsx');
 const {cyclesWrite}=await import('../src/lib/api/cycles.js');
 const {aiBudgetApi}=await import('../src/lib/api/aiBudget.js');
 const {askPanelAdapter}=await import('../src/ui/askPanelAdapter.js');
 const {growDistributionAsk}=await import('../src/lib/api/growDistributionAsk.js');
 const {useAskRail,__resetEadwynPanelForTest}=await import('../src/ui/eadwynPanel.js');
 const saved={proposals:growDistributionAsk.proposals,permission:cyclesWrite.formOptions,mine:aiBudgetApi.mine,topUp:aiBudgetApi.topUp,waiting:askPanelAdapter.waiting};
 growDistributionAsk.proposals=async()=>({proposals:[1,2].map(uid=>({uid:String(uid),status:'proposed',rail_option:'draft:distribution'}))});
 const calls=[];cyclesWrite.formOptions=async(...args)=>{calls.push(args);return {can_write:true};};aiBudgetApi.topUp=async()=>({});askPanelAdapter.waiting=async()=>({available:true,data:{count:2}});
 function Rail(){useAskRail(true,'Founder · Grow · Distribution','Distribution');return null;}
 try {for(const paused of [false,true]) {
  aiBudgetApi.mine=async()=>({...budget,ai_paused:paused});__resetEadwynPanelForTest();
  const m=await mountContracts(h(React.Fragment,null,h(Rail),h(DistributionTabs,{search:'?project_id=7',aiOff:!paused,role:'founder',action:{label:'+ New campaign',href:'/grow/distribution/campaigns/new?project_id=7'}})));
  try {const ask=m.nodes().find(n=>m.props(n)?.['data-testid']==='distribution-ask');assert.equal(m.props(ask).disabled,paused);assert.equal(m.nodes().some(n=>n.tagName==='A'&&m.props(n)?.href==='/grow/distribution/campaigns/new?project_id=7'),true);assert.equal(m.props(ask)['aria-label'],paused?'Ask Eadwyn, unavailable: AI is paused for your studio':'Ask Eadwyn, 2 waiting');}finally{await m.unmount();}
 }assert.deepEqual(calls,Array(2).fill(['grow',7,'distribution',{campaign:'permission'}]));
 }finally{growDistributionAsk.proposals=saved.proposals;cyclesWrite.formOptions=saved.permission;Object.assign(aiBudgetApi,{mine:saved.mine,topUp:saved.topUp});askPanelAdapter.waiting=saved.waiting;__resetEadwynPanelForTest();}
});

test('CampaignsTab invalidates the earlier permission request when the venture changes',async()=>{
 const {default:CampaignsTab}=await import('../src/pages/cycles/distribution/CampaignsTab.jsx');
 const pending=[];const permission=id=>new Promise(resolve=>pending.push({id,resolve}));
 const api={campaigns:async()=>({campaigns:[],counts:{all:0}})};
 function Subject(){const [id,setId]=React.useState(7);return h(React.Fragment,null,h('button',{onClick:()=>setId(8)},'Switch venture'),h(CampaignsTab,{projectId:id,role:'founder',api,readPermission:permission}));}
 const m=await mountContracts(h(Subject));try{
  await m.flush();await m.click('Switch venture');await m.flush();
  await React.act(async()=>pending[0].resolve({can_write:true}));
  const action=()=>m.nodes().find(n=>n.tagName==='BUTTON'&&m.props(n)?.children==='+ New campaign');
  assert.equal(m.props(action()).disabled,true);
  await React.act(async()=>pending[1].resolve({can_write:false}));assert.equal(m.props(action()).disabled,true);
  assert.deepEqual(pending.map(p=>p.id),[7,8]);
 }finally{await m.unmount();}
});

// ---- the wizard (#4519 merged): states, reader, unreadable, phone ----------------
const SECRET='upstream said: token sk-live-should-never-show';
async function mountWizard(props,{width=1440,mine}={}){
 const {default:NewCampaignPage}=await import('../src/pages/cycles/distribution/NewCampaignPage.jsx');
 const {aiBudgetApi}=await import('../src/lib/api/aiBudget.js');
 const saved={mine:aiBudgetApi.mine,topUp:aiBudgetApi.topUp,mm:globalThis.matchMedia};
 aiBudgetApi.mine=mine||(async()=>budget);aiBudgetApi.topUp=async()=>({});
 globalThis.matchMedia=q=>({matches:q.includes('max-width: 639px')?width<640:q.includes('min-width: 640px')?width>=640&&width<1024:false,addEventListener(){},removeEventListener(){}});
 const m=await mountContracts(h(NewCampaignPage,{projectId:7,search:'?project_id=7',api:{},publish:{},...props}),'/grow/distribution/campaigns/new?project_id=7');
 await m.flush();await m.flush();
 const by=id=>m.nodes().find(n=>m.props(n)?.['data-testid']===id);
 return {...m,by,async close(){await m.unmount();Object.assign(aiBudgetApi,{mine:saved.mine,topUp:saved.topUp});globalThis.matchMedia=saved.mm;}};
}
const OPTIONS=async()=>({can_write:true,channels:[],segments:[],pieces:[],drafts:[]});

test('wizard: a recorded reader sees the advisor note, not "Unreadable", and no form or raw error',async()=>{
 // Mutation checked: reading can_write:false as unreadable (the pre-#4496 wizard) fails here.
 let asked=0;
 const m=await mountWizard({role:'founder',loadOptions:async()=>{throw new Error(SECRET);},readPermission:async()=>{asked++;return {can_write:false};}});
 try{
  assert.ok(m.by('new-campaign-reader'),'the reader page');
  assert.ok(!m.by('new-campaign-page'),'no form for a reader');
  assert.match(m.text(),new RegExp(DISTRIBUTION_COPY.advisor));
  assert.doesNotMatch(m.text(),/Unreadable/);
  assert.ok(!m.text().includes(SECRET),'no raw error text');
  assert.equal(asked,1);
 }finally{await m.close();}
});

test('wizard: a read-only admin gets the founder-record reason; an unreadable read offers Try again and never its message',async()=>{
 const admin=await mountWizard({role:'admin',loadOptions:async()=>{throw new Error(SECRET);},readPermission:async()=>({can_write:false})});
 try{assert.match(admin.text(),new RegExp(DISTRIBUTION_COPY.admin));assert.match(admin.text(),new RegExp(DISTRIBUTION_COPY.adminAi));}finally{await admin.close();}
 let loads=0;
 const m=await mountWizard({role:'founder',loadOptions:async()=>{loads++;throw new Error(SECRET);},readPermission:async()=>{throw new Error(SECRET);}});
 try{
  assert.ok(m.by('new-campaign-unreadable'));
  assert.match(m.text(),new RegExp(DISTRIBUTION_COPY.readError));
  assert.ok(!m.text().includes(SECRET),'no raw error text');
  // Mutation checked: Try again not wired to a fresh load fails here.
  await m.click('Try again');await m.flush();await m.flush();
  assert.equal(loads,2,'Try again reads again');
 }finally{await m.close();}
});

test('wizard: AI paused shows its note and turns field Ask off; manual Continue still follows the form alone',async()=>{
 // Mutation checked: askOff ignoring the model (field Ask enabled while paused) fails here.
 const m=await mountWizard({role:'founder',loadOptions:OPTIONS,readPermission:async()=>({can_write:true})},{mine:async()=>({...budget,balance_microusd:5_000_000,ai_paused:true})});
 try{
  assert.ok(m.by('new-campaign-page'));
  assert.match(m.text(),/AI is paused for your studio\. Nothing else changes\./);
  const field=m.nodes().find(n=>m.props(n)?.['aria-label']==='Ask Eadwyn about Name');
  assert.equal(m.props(field).disabled,true,'field Ask is off while paused');
  const name=m.nodes().find(n=>n.tagName==='INPUT'&&m.props(n)?.placeholder==='For example: Spring demo push');
  assert.equal(m.props(name).disabled,false,'manual work still works');
 }finally{await m.close();}
});

test('wizard on a 390px phone: full screen, a Back link to Campaigns, and the 48px Back / Continue footer with its reason in view',async()=>{
 // Mutation checked: dropping data-layout on the phone, or the Back link, fails here.
 const m=await mountWizard({role:'founder',loadOptions:OPTIONS,readPermission:async()=>({can_write:true})},{width:390});
 try{
  assert.equal(m.props(m.by('new-campaign-page'))['data-layout'],'phone');
  assert.equal(m.props(m.by('new-campaign-back')).href,'/grow/distribution/campaigns?project_id=7');
  const footer=m.by('new-campaign-footer');assert.ok(footer);
  assert.match(m.text(),/Continue/);
 }finally{await m.close();}
 const desk=await mountWizard({role:'founder',loadOptions:OPTIONS,readPermission:async()=>({can_write:true})},{width:1440});
 try{assert.equal(desk.props(desk.by('new-campaign-page'))['data-layout'],undefined);assert.ok(!desk.by('new-campaign-back'));}finally{await desk.close();}
 const css=readFileSync('frontend/src/pages/cycles/distribution/campaigns.css','utf8');
 assert.match(css,/\.cm-editor\[data-layout=phone\] \.cm-footer \.cm-button,\.cm-editor\[data-layout=phone\] \.cm-footer \.cm-primary\{min-height:48px\}/);
 assert.match(css,/\.cm-editor\[data-layout=phone\]\{min-height:100%/,"fills its container, never the viewport");
 assert.match(css,/\.dark \.cm-editor\[data-layout=phone\] \.cm-footer\{background:#111827/,'dark footer');
});

test('wizard: a blocked state disables Save and Continue with its reason shown',async()=>{
 const {CampaignWizard}=await import('../src/pages/cycles/distribution/NewCampaignPage.jsx');
 const {emptyDraft}=await import('../src/pages/cycles/distribution/campaignModel.js');
 const model=distributionStates({canWrite:false,role:'admin',budgetReading:{budget}});
 const m=await mountContracts(h(CampaignWizard,{draft:{...emptyDraft(),name:'Synthetic push',goal:'leads'},step:0,model,projectId:7,search:'?project_id=7'}),'/grow/distribution/campaigns/new?project_id=7');
 try{
  const tx=n=>n.nodeType===3?n.textContent||'':n.childNodes?.length?n.childNodes.map(tx).join(''):n.textContent||'';
  const continueBtn=m.nodes().find(n=>n.tagName==='BUTTON'&&tx(n)==='Continue');
  const save=m.nodes().find(n=>n.tagName==='BUTTON'&&tx(n)==='Save draft');
  assert.equal(m.props(save).disabled,true);
  assert.equal(m.props(continueBtn).disabled,true);
  // Mutation checked: the footer's reason ignoring the blocked state fails here (the notes alone are not enough).
  const footer=m.nodes().find(n=>m.props(n)?.['data-testid']==='new-campaign-footer');
  assert.equal(tx(footer).includes(DISTRIBUTION_COPY.admin),true,'the reason is in view beside Continue');
 }finally{await m.unmount();}
});
