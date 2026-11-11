// D4492: seven real contact stages, safe cards and explicit permission controls; no fabricated audience counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import ProspectsTab,{ProspectCard,ProspectsView,ProspectSettingsSheet} from '../src/pages/cycles/distribution/ProspectsTab.jsx';
import ProspectSheet from '../src/pages/cycles/distribution/ProspectSheet.jsx';
import AddProspectSheet,{ConsentFields} from '../src/pages/cycles/distribution/AddProspectSheet.jsx';
import { ConsentSummaryView } from '../src/pages/cycles/distribution/ProspectConsentSummary.jsx';
import { CONSENT_CHOICES,PROSPECT_COLUMNS,SOURCE_CHIPS,consentLine,prospectRefusal,reachableLabel } from '../src/pages/cycles/distribution/prospectsModel.js';

const h=React.createElement;
const html=el=>renderToStaticMarkup(h(MemoryRouter,null,el));
const flat=s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const row={uid:'contact-1',name:'Synthetic prospect',company:'Synthetic company',title:null,email:'private@example.test',source:'import',status:'new',utm:{utm_campaign:'campaign-a'}};
const pipeline=source=>({available:true,total:source==='website'?0:1,columns:PROSPECT_COLUMNS.map(([status])=>({status,count:status==='new'&&source!=='website'?1:0,cards:status==='new'&&source!=='website'?[row]:[],more:0}))});

test('seven contact statuses and source chips follow MK7 in order',()=>{
  assert.deepEqual(PROSPECT_COLUMNS.map(x=>x[1]),['New','Invited','Contacted','Replied','Qualified','Active','Passed']);
  assert.deepEqual(SOURCE_CHIPS.map(x=>x[1]),['All sources','Import','LinkedIn CSV','Website sign-up','Lovable sign-up','Added by hand','Update ask']);
  const view=html(h(ProspectsView,{state:{status:'ready',data:pipeline('')},canWrite:true}));
  const labels=[...view.matchAll(/<section[^>]*aria-label="([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(labels,['New','Invited','Contacted','Replied','Qualified','Active','Passed']);
  assert.match(flat(view),/1 prospects/);
});

test('cards contain names, source and recorded attribution, but never the email property',()=>{
  const view=html(h(ProspectCard,{row}));
  assert.match(flat(view),/Synthetic prospect/);assert.match(flat(view),/Title not recorded/);assert.match(flat(view),/Import campaign-a/);
  assert.doesNotMatch(view,/@|private|"email"/);
  assert.match(view,/min-h-11/);assert.match(view,/dark:/);
});

test('empty/loading/unreadable pipeline states are distinct and keep both manual actions',()=>{
  const empty=html(h(ProspectsView,{state:{status:'ready',data:pipeline('website')},canWrite:true}));
  assert.match(flat(empty),/No prospects yet\./);assert.match(flat(empty),/Import contacts/);assert.match(flat(empty),/Add a prospect/);
  const loading=html(h(ProspectsView,{state:{status:'loading'}}));assert.match(loading,/Loading prospects/);
  const failed=html(h(ProspectsView,{state:{status:'unreadable'}}));assert.match(flat(failed),/pipeline could not be read/);assert.doesNotMatch(flat(failed),/0 prospects|No prospects yet/);
});

test('consent radios keep their exact proof/blocked copy and have no Ask trigger',()=>{
  assert.deepEqual(CONSENT_CHOICES.map(x=>x.label),['Opted in on a form','Wrote to you first','No consent yet']);
  const fields=html(h(ConsentFields,{basis:'none',proof:'',onBasis(){},onProof(){}}));
  assert.equal((fields.match(/type="radio"/g)||[]).length,3);
  for(const text of ['Keep the form and date as proof','Their message is the proof','Steps stay blocked until they agree'])assert.ok(flat(fields).includes(text));
  assert.doesNotMatch(fields,/Ask|textarea/);
  assert.match(html(h(ConsentFields,{basis:'opted_in',proof:'Form fixture',onBasis(){},onProof(){}})),/textarea[^>]*required/);
  const sheet=html(h(AddProspectSheet,{projectId:7,ventureName:'Synthetic venture',api:{},campaigns:{status:'ready',rows:[]},canWrite:true,onClose(){}}));
  assert.match(flat(sheet),/Shown only in this prospect’s own sheet/);
});

test('wizard Audience and Schedule words use recorded counts or Not recorded, never made-up zero',()=>{
  const state={status:'ready',data:{available:true,email_reachable:212,opted_in:{whatsapp:64,sms:12},no_consent:31}};
  assert.equal(consentLine(state),'Consent: 212 can be emailed · 64 opted into WhatsApp · 12 into SMS · 31 have no consent recorded and are left out of messaging.');
  assert.equal(reachableLabel(state),'212 reachable');
  assert.match(flat(html(h(ConsentSummaryView,{state}))),/212 can be emailed/);
  for(const state of [{status:'unreadable'},{status:'ready',data:{available:false,email_reachable:null}},{status:'ready',data:{available:true,email_reachable:null}}]){
    assert.equal(consentLine(state),'Consent: Not recorded');assert.equal(reachableLabel(state),'Not recorded');
  }
});

test('suppression empty state and unreadable settings never expose an address or claim a saved quiet window',()=>{
  const view=html(h(ProspectSettingsSheet,{projectId:7,api:{},settings:{status:'ready',data:{settings:null}},suppressions:{status:'ready',data:{count:0,entries:[]}},canWrite:false,onClose(){},onChanged(){}}));
  assert.match(flat(view),/suppression list is empty/);assert.match(flat(view),/quiet hours have not been saved/);assert.match(flat(view),/keyed hashes/);
  assert.doesNotMatch(view,/@/);
  const failed=flat(html(h(ProspectSettingsSheet,{projectId:7,api:{},settings:{status:'unreadable'},suppressions:{status:'unreadable'},canWrite:false,onClose(){},onChanged(){}})));
  assert.match(failed,/Quiet hours could not be read/);assert.doesNotMatch(failed,/quiet hours have not been saved|suppression list is empty/);
});

test('refusals use the route detail and never Error.message',()=>{
  assert.equal(prospectRefusal(new Error('private cell')),'This could not be saved. Reload before trying again.');
  assert.equal(prospectRefusal({data:{detail:'Choose a recorded source.'}}),'Choose a recorded source.');
});

test('mounted source chips request filtered pipeline data without rendering contact emails',async()=>{
  const seen=[];
  const api={list:async params=>{seen.push(params);return pipeline(params.source);},settings:async()=>({settings:null}),suppressions:async()=>({count:0,entries:[]})};
  const old=globalThis.matchMedia;globalThis.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){}});
  let ui;
  try{
    ui=await mountContracts(h(ProspectsTab,{projectId:7,ventureName:'Synthetic',canWrite:false,api,campaignApi:{campaigns:async()=>({campaigns:[]})}}),'/grow/distribution/prospects',{id:1,role:'founder'});
    await ui.flush();assert.equal(seen.at(-1).source,'');assert.doesNotMatch(ui.text(),/@/);
    await ui.click('Import');await ui.flush();assert.equal(seen.at(-1).source,'import');
    await ui.click('Website sign-up');await ui.flush();assert.equal(seen.at(-1).source,'website');assert.match(ui.text(),/No prospects yet/);
    await ui.click('All sources');await ui.flush();assert.equal(seen.at(-1).source,'');assert.match(ui.text(),/Synthetic prospect/);
  }finally{await ui?.unmount();globalThis.matchMedia=old;}
});


test('individual sheet refuses malformed detail and keeps advisor changes disabled',async()=>{
  const old=globalThis.matchMedia;globalThis.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){}});
  let ui;
  try{
    ui=await mountContracts(h(ProspectSheet,{uid:'contact-1',projectId:7,api:{detail:async()=>({})},onClose(){}}));
    await ui.flush();assert.match(ui.text(),/This prospect could not be read/);await ui.unmount();ui=null;
    ui=await mountContracts(h(ProspectSheet,{uid:'contact-1',projectId:7,api:{detail:async()=>({...row,consents:[],replies:[],tasks:[]})},canWrite:false,onClose(){}}));
    await ui.flush();assert.match(ui.text(),/private@example.test/);
    for(const node of ui.nodes().filter(n=>n.tagName==='BUTTON'&&['Move to Invited','Save permission'].includes(n.childNodes.map(x=>x.textContent).join(''))))assert.equal(ui.props(node).disabled,true);
    assert.match(ui.text(),/read this venture’s prospects but not change them/);
  }finally{await ui?.unmount();globalThis.matchMedia=old;}
});
