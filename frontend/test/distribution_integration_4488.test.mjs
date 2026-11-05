/** D4488 (#4488): mounted wizard acceptance preserves manual edits and saves only on explicit Save. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import NewCampaignPage from '../src/pages/cycles/distribution/NewCampaignPage.jsx';
import { mountContracts } from './_contracts_dom.mjs';
import { DistributionAskHeader } from '../src/pages/cycles/distribution/WaitingForYou.jsx';
import { useAskRail } from '../src/ui/eadwynPanel.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
const h=React.createElement;
const originalDispatch=globalThis.dispatchEvent;globalThis.dispatchEvent=()=>true;
test.after(()=>{globalThis.dispatchEvent=originalDispatch;});
const choices={can_write:true,channels:[],segments:[{id:7,name:'Operators',source:'icp_definition'}],pieces:[],drafts:[]};
const proposal=(kind,extra={})=>({uid:'proposal-one',status:'proposed',rail_option:'draft:distribution',payload:{version:1,project:1,campaign_uid:null,target:'form',kind,sources:[],...extra}});
function services(rows){const calls=[];return {calls,quote:async body=>{calls.push(['quote',body]);return {estimate:{hold_microusd:20000,model:'fixture'}};},run:async body=>{calls.push(['run',body]);return {proposals:rows,receipt:{held_microusd:20000,charged_microusd:8000}};},proposals:async()=>({proposals:[]}),decide:async(uid,b)=>{calls.push(['decide',b]);const p=rows.find(p=>p.uid===uid);return {proposal:{...p,status:'edited',decided_payload:b.edited?{...p.payload,...b.edited}:null}};}};}
const settle=async ui=>{for(let i=0;i<5;i++)await ui.flush();};
const button=async(ui,label)=>{const node=ui.nodes().find(n=>n.tagName==='BUTTON'&&ui.props(n)?.['aria-label']===label);if(!node)throw Error('Missing accessible button '+label);await act(async()=>ui.props(node).onClick());await settle(ui);};
const input=(ui,placeholder)=>ui.nodes().find(n=>n.tagName==='INPUT'&&ui.props(n)?.placeholder===placeholder);
test('the real Name Ask places selected fields locally; only Save creates the campaign',async()=>{
 const ask=services([proposal('campaign_fields',{values:{name:'Spring demo push',goal:'demos',segment_id:7}})]),writes=[];
 const api={campaign:async(project,body)=>{writes.push(['create',project,body]);return {uid:'new-one'};}};
 const ui=await mountContracts(h(NewCampaignPage,{projectId:1,loadOptions:async()=>choices,api,askApi:ask}),'/grow/distribution/campaigns/new?project_id=1');
 try{await settle(ui);await button(ui,'Ask Eadwyn about Name');assert.match(ui.text(),/Holds up to \$0.02/);await ui.click('Ask Eadwyn to draft for each channel');await settle(ui);await ui.click('Accept selected (3)');await settle(ui);assert.equal(ui.props(input(ui,'For example: Spring demo push')).value,'Spring demo push');assert.match(ui.text(),/Not saved/);assert.deepEqual(writes,[]);await ui.click('Save draft');await settle(ui);assert.equal(writes[0][2].segment_id,7);assert.equal(writes[0][2].audience_kind,'icp');assert.equal(writes[0][2].goal,'demos');assert.match(ui.text(),/Draft saved/);}
 finally{await ui.unmount();__resetEadwynPanelForTest();}
});

test('accepted text preserves newer manual fields and refuses foreign, closed or removed-channel proposals',async()=>{
 const {acceptCampaignProposals,assetRequests}=await import('../src/pages/cycles/distribution/campaignAskModel.js');
 const base={name:'Manual',goal:'sales',utm_campaign:'manual-utm',utm_typed:true,budget:'600',starts_on:'2027-02-01',ends_on:'2027-02-28',channels:[{uid:'organic',kind:'organic'}],assets:{},creatives:{}};
 const rows=[{...proposal('campaign_fields',{values:{name:'AI title',goal:'demos',segment_id:7,budget:'1',starts_on:'yesterday'}}),status:'edited'}, {...proposal('post',{channel_uid:'organic',text:'Accepted text'}),status:'accepted'}];
 const next=acceptCampaignProposals(base,rows,1,choices);
 assert.deepEqual([next.budget,next.starts_on,next.ends_on,next.utm_campaign],['600','2027-02-01','2027-02-28','manual-utm']);
 assert.equal(next.assets.organic,'Accepted text');
 assert.equal(next.audience_kind,'icp');
 assert.equal(acceptCampaignProposals(base,[{...rows[1],payload:{...rows[1].payload,project:2}}],1),base);
 assert.equal(acceptCampaignProposals(base,[{...rows[1],status:'discarded'}],1),base);
 assert.equal(acceptCampaignProposals(base,[{...rows[1],payload:{...rows[1].payload,campaign_uid:'other'}}],1),base);
 assert.equal(acceptCampaignProposals({...base,channels:[]},[rows[1]],1).askUnsaved,undefined);
 assert.deepEqual(assetRequests([{uid:'mystery',name:'Google Search'}]),[null]);
 assert.deepEqual(assetRequests([{uid:'ad',kind:'ads',name:'Google Search'}]),[null]);
 assert.deepEqual(assetRequests([{uid:'ad',kind:'ads'}],{ad:{placement:'meta_feed_4_5',field:'body'}}),[{kind:'ad_creative',channel_uid:'ad',placement:'meta_feed_4_5',field:'body'}]);
});

test('an edited campaign stages ad text locally and retries the canonical creative save without publishing',async()=>{
 const ask=services([proposal('ad_creative',{campaign_uid:'existing',channel_uid:'ad',placement:'google_search_text',creative_field:'headline',text:'See problems a day early'})]);
 let finishDecision;const decide=ask.decide;ask.decide=(...args)=>new Promise(resolve=>{finishDecision=()=>decide(...args).then(resolve);});
 const writes=[];let fail=true;
 const api={campaignDetail:async()=>({uid:'existing',name:'Manual plan',goal:'demos',status:'draft',utm_campaign:'manual-plan',audience_kind:'none',channels:[{uid:'ad',kind:'ads',name:'Search',planned_budget_cents:9000}],linked_items:[]}),campaignUpdate:async(...args)=>writes.push(['update',...args]),campaignChannel:async(...args)=>writes.push(['channel',...args]),campaignCreative:async(...args)=>{writes.push(['creative',...args]);if(fail){fail=false;throw {data:{code:'unavailable'}};}}};
 const ui=await mountContracts(h(NewCampaignPage,{projectId:1,loadOptions:async()=>({...choices,channels:[{uid:'ad',kind:'ads',name:'Search'}]}),api,askApi:ask,publish:{createDraft(){throw Error('Ad text must not create a Publish draft');}}}),'/grow/distribution/campaigns/new?project_id=1&edit=existing&step=budget');
 try{await settle(ui);await ui.fill('Total budget','80');await ui.click('Continue');await ui.fill('Search placement','google_search_text');await ui.fill('Search text field','headline');await ui.click('Ask Eadwyn to draft for each channel');await settle(ui);
 const run=ui.nodes().filter(n=>n.tagName==='BUTTON'&&ui.props(n)?.children==='Ask Eadwyn to draft for each channel').at(-1);await act(async()=>ui.props(run).onClick());await settle(ui);await ui.click('Accept');await settle(ui);await ui.click('Back');await ui.fill('Total budget','125');await act(async()=>finishDecision());await settle(ui);await ui.click('Continue');
 assert.equal(ask.calls.find(c=>c[0]==='run')[1].target,'form');
 assert.deepEqual(writes,[]);
 assert.match(ui.text(),/Not saved/);
 const creative=ui.nodes().find(n=>n.tagName==='TEXTAREA'&&ui.props(n)?.value==='See problems a day early');assert.ok(Boolean(creative));
 await ui.click('Save draft');await settle(ui);assert.match(ui.text(),/Some changes may already be saved/);await ui.click('Save draft');await settle(ui);
 assert.deepEqual(writes.filter(c=>c[0]==='creative').map(c=>c.slice(1)),[[1,'existing','google_search_text','headline','See problems a day early'],[1,'existing','google_search_text','headline','See problems a day early']]);
 assert.equal(writes.find(c=>c[0]==='update')[3].budget_cents,12500);
 assert.doesNotMatch(ui.text(),/Not saved/);
 }finally{await ui.unmount();__resetEadwynPanelForTest();}
});

test('the project header opens Waiting with existing proposals even when tokens are exhausted',async()=>{
 const ask=services([proposal('post',{text:'Saved proposal'})]),reads=[];
 ask.proposals=async(project,campaign)=>{reads.push([project,campaign]);return {proposals:[proposal('post',{text:'Saved proposal'})]};};
 function Header(){useAskRail(true,'Founder · Grow · Distribution','Distribution');return h(DistributionAskHeader,{projectId:1,api:ask,state:'out'});}
 const ui=await mountContracts(h(Header));
 try{await settle(ui);assert.deepEqual(reads,[[1,undefined]]);const trigger=ui.nodes().find(n=>ui.props(n)?.['data-testid']==='distribution-ask');assert.equal(ui.props(trigger)['aria-label'],'Ask Eadwyn, 1 waiting');assert.equal(ui.props(trigger).disabled,false);await act(async()=>ui.props(trigger).onClick());await settle(ui);assert.match(ui.text(),/You are out of AI tokens. New proposals pause; the ones below stay/);assert.match(ui.text(),/Saved proposal/);assert.match(ui.text(),/Accept all safe \(1\)/);}
 finally{await ui.unmount();__resetEadwynPanelForTest();}
});

test('a new wizard header lists only proposals for unsaved campaigns',async()=>{
 const ask=services([]);ask.proposals=async()=>({proposals:[proposal('post'),{...proposal('post',{campaign_uid:'another-campaign'}),uid:'other'}]});
 function Header(){useAskRail(true,'Founder · Grow · Distribution','Distribution');return h(DistributionAskHeader,{projectId:1,campaignUid:null,api:ask});}
 const ui=await mountContracts(h(Header));
 try{await settle(ui);const trigger=ui.nodes().find(n=>ui.props(n)?.['data-testid']==='distribution-ask');assert.equal(ui.props(trigger)['aria-label'],'Ask Eadwyn, 1 waiting');await act(async()=>ui.props(trigger).onClick());await settle(ui);assert.match(ui.text(),/DISTRIBUTION · 1 PROPOSALS/);}
 finally{await ui.unmount();__resetEadwynPanelForTest();}
});

test('read-only access disables the scoped Waiting trigger while preserving its count and reason',async()=>{
 const ask=services([]);ask.proposals=async()=>({proposals:[proposal('post')]});
 function Header(){useAskRail(true,'Founder · Grow · Distribution','Distribution');return h(DistributionAskHeader,{projectId:1,api:ask,disabled:true,title:'Read only: you are reading a founder’s record'});}
 const ui=await mountContracts(h(Header));
 try{await settle(ui);const trigger=ui.nodes().find(n=>ui.props(n)?.['data-testid']==='distribution-ask');assert.equal(ui.props(trigger).disabled,true);assert.equal(ui.props(trigger)['aria-label'],'Ask Eadwyn, 1 waiting');assert.equal(ui.props(trigger).title,'Read only: you are reading a founder’s record');}
 finally{await ui.unmount();__resetEadwynPanelForTest();}
});
