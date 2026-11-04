// D4487: campaign plans, their honest figures and the founder's explicit transitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as model from '../src/pages/cycles/distribution/campaignModel.js';
import CampaignCard from '../src/pages/cycles/distribution/CampaignCard.jsx';
import { CampaignConfirm, CampaignDetail } from '../src/pages/cycles/distribution/CampaignSheet.jsx';
import { CampaignStep, ScheduleReview } from '../src/pages/cycles/distribution/CampaignSteps.jsx';
import NewCampaignPage, { CampaignWizard } from '../src/pages/cycles/distribution/NewCampaignPage.jsx';
import CampaignsTab, { CampaignsList } from '../src/pages/cycles/distribution/CampaignsTab.jsx';
import { saveCampaignPlan } from '../src/pages/cycles/distribution/campaignPlan.js';
import { mountContracts } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';

const html = element => renderToStaticMarkup(React.createElement(MemoryRouter, null, element));
const h = React.createElement;
const sample = { uid:'one',name:'Spring demo push',status:'active',goal:'demos',utm_campaign:'spring',starts_on:'2027-01-04',ends_on:'2027-01-31',budget_cents:null,channels:[],items:{content:2,drafts:1},leads:8,demos:3,customers:1 };

test('D4487: state sort, edge colours and goal emphasis use campaign fields', () => {
  assert.deepEqual(model.sortCampaigns(['ended','paused','draft','active'].map(status=>({...sample,status}))).map(x=>x.status), ['active','draft','paused','ended']);
  assert.equal(model.STATE.active.edge, '#10b981');
  assert.equal(model.STATE.paused.edge, '#f59e0b');
  assert.equal(model.STATE.draft.edge, model.STATE.ended.edge);
  assert.equal(model.goalMetric('demos'), 'demos');
  assert.equal(model.goalMetric('sales'), 'customers');
  assert.equal(model.goalMetric('signups'), 'leads');
  assert.match(html(h(CampaignCard,{campaign:sample})), /data-emphasis="demos"/);
});

test('D4487: no tag never invents results, and null budget never becomes dollars zero', () => {
  const out=html(h(CampaignCard,{campaign:{...sample,utm_campaign:null}}));
  assert.equal((out.match(/data-unrecorded="result"/g)||[]).length,3);
  assert.match(out,/Not recorded: no UTM campaign tag/);
  assert.match(out,/Add a UTM tag/);
  assert.match(out,/Budget.*Not set/);
  assert.doesNotMatch(out,/\$0/);
  assert.equal(model.budgetLine({...sample,budget_cents:150000,status:'draft'}),'Budget $1,500 · nothing spent yet');
  assert.equal(model.funnelValue({...sample,status:'draft'},'leads'),'Starts 4 Jan');
});

test('D4487: step gating gives the visible reason and UTM is derived safely', () => {
  const valid={name:'Spring demo push',goal:'demos',audience_kind:'none',utm_campaign:'spring-demo-push',channels:[],starts_on:'2027-01-04',ends_on:'2027-01-31'};
  assert.equal(model.utmSlug('  Spring Démo Push!  '),'spring-demo-push');
  for(const [step,change,reason] of [[0,{goal:''},'Pick a goal'],[1,{audience_kind:''},'Pick an audience, or No segment'],[2,{utm_conflict:true},'Choose another UTM tag'],[3,{ends_on:'2027-01-01'},'Fix the dates first']]) {
    assert.equal(model.stepReason(step,{...valid,...change}),reason);
  }
  assert.equal(model.stepReason(3,valid),null);
});

test('D4487: only explicit allowed transitions; Ended is final and Draft only activates', () => {
  assert.deepEqual(model.transitions('draft'),[{label:'Activate',status:'active'}]);
  assert.deepEqual(model.transitions('active'),[{label:'Pause',status:'paused'}]);
  assert.deepEqual(model.transitions('paused'),[{label:'Resume',status:'active'},{label:'End campaign',status:'ended'}]);
  assert.deepEqual(model.transitions('ended'),[]);
  const out=html(h(CampaignDetail,{campaign:{...sample,status:'draft'},role:'advisor'}));
  assert.match(out,/You can read this venture’s campaigns but not change them\./);
  assert.match(out,/disabled=""[^>]*>Activate/);
  assert.doesNotMatch(out,/>Pause<|>Resume<|>End campaign</);
});

test('D4487: a founder account with read-only venture membership cannot edit a campaign',()=>{
  const out=html(h(CampaignDetail,{campaign:{...sample,status:'draft'},role:'founder',canWrite:false}));
  assert.match(out,/disabled=""[^>]*>Activate/);
  assert.match(out,/You can read this venture’s campaigns but not change them\./);
});

test('D4487: archive/end dialogs preserve the explicit confirmation copy', () => {
  const archive=html(h(CampaignConfirm,{kind:'archive',name:'Spring'}));
  assert.match(archive,/Archive Spring\?/);
  assert.match(archive,/It leaves this list; its links are kept\./);
  const end=html(h(CampaignConfirm,{kind:'end',name:'Spring'}));
  assert.match(end,/End Spring\?/);
  assert.match(end,/Ended campaigns can’t be restarted\. Its results and links are kept\./);
});

test('D4487: Schedule is a draft plan, and money/dates/UTM have no Ask triggers', () => {
  const draft={...sample,status:'draft',audience_kind:'none',channels:[],assets:{},links:[]};
  const out=html(h(ScheduleReview,{draft}));
  assert.match(out,/Saves a Draft plan\. Nothing is posted, sent or spent\./);
  assert.match(out,/Press Activate on the campaign when you are ready/);
  for(const step of [2,3]) {
    const fields=html(h(CampaignStep,{step,draft,onChange(){},options:{channels:[],segments:[],pieces:[],drafts:[]}}));
    assert.doesNotMatch(fields,/Ask Eadwyn to fill|fill-trigger-|>Fill</);
  }
  assert.equal(model.campaignBody(draft).status,undefined);
});

test('D4487: the disabled Continue explains each reason visibly, not only in a tooltip',()=>{
  const valid={...model.emptyDraft(),name:'Spring',goal:'demos',audience_kind:'none',utm_campaign:'spring',starts_on:'2027-01-04',ends_on:'2027-01-31'};
  for(const [step,change,reason] of [[0,{goal:''},'Pick a goal'],[1,{audience_kind:''},'Pick an audience, or No segment'],[2,{utm_conflict:true},'Choose another UTM tag'],[3,{ends_on:'2027-01-01'},'Fix the dates first']]){
    const out=html(h(CampaignWizard,{draft:{...valid,...change},step,options:{channels:[],segments:[]}}));
    assert.match(out,/disabled=""[^>]*>Continue/);
    assert.ok(out.includes(`role="status">${reason}</p>`),reason);
  }
  const fresh=html(h(CampaignStep,{step:0,draft:model.emptyDraft(),options:{},onChange(){}}));
  assert.match(fresh,/aria-label="Ask Eadwyn about Name"/);
  assert.match(fresh,/aria-label="Ask Eadwyn about Goal"/);
  const typed=html(h(CampaignStep,{step:0,draft:valid,options:{},onChange(){}}));
  assert.doesNotMatch(typed,/fill-trigger-/);
});

test('D4487: list counts come from data and empty/loading/unreadable stay distinct',()=>{
  const list=html(h(CampaignsList,{read:{state:'ready',campaigns:[sample],counts:{all:17,active:9,draft:4,paused:3,ended:1}}}));
  assert.match(list,/All · 17/);
  assert.match(list,/Active · 9/);
  const empty=html(h(CampaignsList,{read:{state:'ready',campaigns:[],counts:{all:0}}}));
  assert.match(empty,/No campaigns yet\./);
  assert.match(empty,/A campaign groups your channels, audience, budget and posts toward one goal\./);
  assert.match(html(h(CampaignsList,{read:{state:'loading'}})),/Loading campaigns/);
  assert.match(html(h(CampaignsList,{read:{state:'unreadable'}})),/Unreadable/);
});

test('D4487: Schedule/manual saves retain Draft and retry partial writes without duplicate plans or posts',async()=>{
  const calls=[],journal={uid:null,links:[],assets:{}};let refuseLink=true;
  const api={
    campaign:async(pid,body)=>{calls.push(['create',pid,body]);return {campaign:{...body,uid:'plan',status:'draft'}};},
    campaignUpdate:async(pid,uid,body)=>calls.push(['update',pid,uid,body]),
    campaignChannel:async(...args)=>calls.push(['channel',...args]),
    campaignItem:async(...args)=>{calls.push(['link',...args]);if(refuseLink){refuseLink=false;throw {data:{detail:'Try the link again'}};}},
    campaignItemRemove:async(...args)=>calls.push(['unlink',...args]),
  };
  const publish={createDraft:async body=>{calls.push(['post-draft',body]);return {uid:'post'};},saveDraft:async(...args)=>calls.push(['post-save',...args])};
  const draft={...model.emptyDraft(),name:'Spring',goal:'demos',audience_kind:'none',utm_campaign:'spring',channels:[{uid:'channel',name:'Newsletter',amount:'12.34',budget_type:'daily'}],assets:{channel:'A manual post'}};
  await assert.rejects(()=>saveCampaignPlan({projectId:7,draft,api,publish,journal}));
  assert.equal(journal.uid,'plan');
  assert.equal(journal.assets.channel.uid,'post');
  assert.equal(await saveCampaignPlan({projectId:7,draft,api,publish,journal}),'plan');
  assert.equal(calls.filter(c=>c[0]==='create').length,1);
  assert.equal(calls.filter(c=>c[0]==='post-draft').length,1);
  assert.equal(calls.find(c=>c[0]==='create')[2].status,undefined);
  assert.equal(calls.find(c=>c[0]==='update')[3].status,undefined);
  assert.equal(calls.find(c=>c[0]==='channel')[4].planned_budget_cents,1234);
  assert.deepEqual(calls.find(c=>c[0]==='post-draft')[1],{project_id:7,module:'distribution',text:'A manual post'});
  assert.ok(!calls.some(c=>c[0]==='activate'||c[0]==='send'||c[0]==='confirm'));
});

test('D4487: the mounted wizard finishes six steps with a draft write, and a refusal stays verbatim',async()=>{
  const calls=[];let fail=true;
  const api={campaign:async(pid,body)=>{calls.push({pid,body});if(fail)throw {message:'private synthetic detail',data:{detail:'This UTM campaign tag is already used by this venture',field:'utm_campaign'}};return {campaign:{uid:'plan',status:'draft'}};}};
  const m=await mountContracts(h(NewCampaignPage,{projectId:7,role:'founder',api,publish:{},loadOptions:async()=>({can_write:true,channels:[],segments:[],pieces:[],drafts:[]})}),'/grow/distribution/campaigns/new?project_id=7');
  try{
    await m.flush();await m.fill('Name','Spring');await m.click('DemosBooked demos');await m.click('Continue');
    await m.click('No segmentPlan without a defined audience');await m.click('Continue');await m.click('Continue');await m.click('Continue');await m.click('Continue');
    assert.match(m.text(),/Saves a Draft plan/);await m.click('Schedule');
    assert.match(m.text(),/This UTM campaign tag is already used by this venture/);
    assert.doesNotMatch(m.text(),/private synthetic detail/);
    assert.equal(calls[0].body.status,undefined);
    fail=false;await m.fill('UTM campaign tag','spring-two');await m.click('Continue');await m.click('Continue');await m.click('Continue');await m.click('Schedule');
    assert.equal(calls.length,2);
    assert.equal(calls[1].pid,7);
    assert.equal(calls[1].body.utm_campaign,'spring-two');
    assert.equal(calls[1].body.status,undefined);
  } finally {await m.unmount();}
});

test('D4487: removing a channel unlinks its manual asset, and partial unlink retries do not repeat a deletion',async()=>{
  const calls=[],journal={uid:'plan',links:[{kind:'content_item',uid:'old'},{kind:'content_item',uid:'another'}],assets:{removed:{uid:'post'}}};let fail=true;
  const api={campaignUpdate:async()=>{},campaignItemRemove:async(_pid,_uid,kind,uid)=>{calls.push(uid);if(uid==='another'&&fail){fail=false;throw new Error('transient');}},campaignItem:async()=>{}};
  const draft={...model.emptyDraft(),name:'Plan',goal:'demos'};
  await assert.rejects(()=>saveCampaignPlan({projectId:7,draft,api,publish:{},journal}));
  assert.deepEqual(journal.links,[{kind:'content_item',uid:'another'}]);
  await saveCampaignPlan({projectId:7,draft,api,publish:{},journal});
  assert.equal(calls.filter(uid=>uid==='old').length,1);
  assert.ok(calls.includes('post'));
  assert.deepEqual(journal.assets,{});
});

test('D4487: invalid entered budgets cannot be silently saved as null, and editing preserves an existing state honestly',()=>{
  const draft={...model.emptyDraft(),name:'Plan',goal:'demos',budget:'12.345',audience_kind:'none',utm_campaign:'plan',channels:[]};
  const out=html(h(CampaignWizard,{draft,step:3,options:{}}));
  assert.match(out,/disabled=""[^>]*>Save draft/);
  assert.match(out,/Use a valid budget amount/);
  const edit=html(h(CampaignWizard,{draft:{...draft,budget:'',status:'active'},step:5,options:{}}));
  assert.match(edit,/Save changes/);
  assert.doesNotMatch(edit,/<button[^>]*>Schedule<|Saves a Draft plan/);
  assert.match(edit,/Its status is unchanged/);
});

test('D4487: actual cycle routes mount a full-page wizard without tabs and a uid sheet over Campaigns',async()=>{
  const old=globalThis.fetch,paths=[];
  globalThis.fetch=async url=>{
    const path=String(url);paths.push(path);
    const data=path.includes('/auth/me')?{id:1,role:'founder'}:path.includes('/form-options')?{can_write:true,channels:[],segments:[],pieces:[],drafts:[]}:path.includes('/campaigns/one')?{campaign:{...sample,created_at:null,created_by:null,linked_items:[]}}:path.includes('/cycles/grow/campaigns')?{campaigns:[sample],counts:{all:1,active:1,draft:0,paused:0,ended:0}}:path.includes('/modules/')?{records:{rows:[]},parts:{content_calendar:{state:'ready',items:[]}}}:{};
    return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  };
  const page=newPage=>h(AuthProvider,null,h(RailPageProvider,{role:'founder'},newPage));
  try{
    const wizard=await mountContracts(page(h(CycleRoute,{cycle:'grow',slug:'distribution',tab:'campaigns',campaignNew:true})),'/grow/distribution/campaigns/new?project_id=7',{id:1,role:'founder'});
    try{await wizard.flush();assert.ok(wizard.nodes().some(n=>wizard.props(n)?.['data-testid']==='new-campaign-page'));assert.equal(wizard.nodes().some(n=>wizard.props(n)?.['aria-label']==='Distribution tabs'),false);assert.match(wizard.text(),/What is this campaign for/);}finally{await wizard.unmount();}
    paths.length=0;
    const detail=await mountContracts(page(h(Routes,null,h(Route,{path:'/grow/distribution/campaigns/:uid',element:h(CycleRoute,{cycle:'grow',slug:'distribution',tab:'campaigns'})}))),'/grow/distribution/campaigns/one?project_id=7',{id:1,role:'founder'});
    try{await detail.flush();assert.ok(detail.nodes().some(n=>detail.props(n)?.['data-testid']==='campaign-sheet'));assert.ok(detail.nodes().some(n=>detail.props(n)?.['aria-label']==='Distribution tabs'));assert.ok(paths.some(p=>p.includes('/campaigns/one?project=7')));assert.match(detail.text(),/Campaign · created Not recorded by Not recorded/);}finally{await detail.unmount();}
  }finally{globalThis.fetch=old;__resetEadwynPanelForTest();}
});

test('D4487: campaign and Publish refusals retain their route sentences without exposing thrown messages',async()=>{
  const {campaignRefusal}=await import('../src/pages/cycles/distribution/campaignPlan.js');
  assert.equal(typeof campaignRefusal,'function');
  assert.equal(campaignRefusal({data:{detail:'Campaign sentence'},message:'Private synthetic detail'}),'Campaign sentence');
  assert.equal(campaignRefusal({data:{detail:{message:'Publishing could not finish that request. Nothing was sent.',code:'publish_failed'}},message:'Private synthetic detail'}),'Publishing could not finish that request. Nothing was sent.');
  assert.equal(campaignRefusal(new Error('Private synthetic detail')),'The campaign could not be saved. Try again.');
});

test('D4487: the mounted list/detail uses the server permission and keeps failed permission reads disabled',async()=>{
  const writes=[],api={campaigns:async()=>({campaigns:[sample],counts:{all:1,active:1}}),campaignDetail:async()=>({campaign:{...sample,status:'draft',linked_items:[]}}),campaignUpdate:async()=>writes.push('write')};
  for(const failed of [false,true]){
    const m=await mountContracts(h(CampaignsTab,{projectId:7,role:'founder',campaignUid:'one',api,readPermission:async()=>{if(failed)throw new Error('Private permission detail');return {can_write:false};}}),'/grow/distribution/campaigns/one?project_id=7');
    try{await m.flush();const activate=m.nodes().find(n=>n.tagName==='BUTTON'&&n.textContent==='Activate');assert.ok(activate);assert.equal(m.props(activate).disabled,true);assert.match(m.text(),failed?/Unreadable: permission to change campaigns could not be read/:/You can read this venture’s campaigns but not change them/);assert.doesNotMatch(m.text(),/Private permission detail/);assert.deepEqual(writes,[]);}finally{await m.unmount();}
  }
});
