// D4492: real Prospects route and wizard consent integration, with mutation controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { PROSPECT_COLUMNS } from '../src/pages/cycles/distribution/prospectsModel.js';
const h=React.createElement;
const text=n=>n.childNodes?.length?n.childNodes.map(text).join(''):n.textContent||'';
const source=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const row={uid:'one',name:'Fixture prospect',company:'Fixture venture',email:'private@example.test',source:'manual',status:'new',utm:{}};
const summary={available:true,email_reachable:7,opted_in:{whatsapp:2,sms:1},no_consent:3};
async function setup(Component=CycleRoute,{role='founder',write=role==='founder',permissionFails=false,permissionMalformed=false,tab='prospects',query=''}={}) {
  const before=globalThis.fetch,calls=[];let revision=0,status='new';
  globalThis.fetch=async(url,options={})=>{
    const path=String(url),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({path,method,body});
    let result={};let code=200;
    if(path.includes('/auth/me'))result={id:1,role};
    else if(path.includes('/form-options')){result={can_write:write,channels:[],segments:[{id:3,name:'Recorded segment'},{id:4,name:'Unknown membership'}],pieces:[],drafts:[]};if(permissionFails)code=503;if(permissionMalformed)delete result.can_write;}
    else if(path.includes('/grow/prospects/consent-summary'))result=path.includes('segment=4')?{available:false,email_reachable:null}:summary;
    else if(path.includes('/grow/prospects/settings'))result={settings:null};
    else if(path.includes('/grow/prospects/suppressions/count'))result={count:0,entries:[]};
    else if(path.includes('/grow/prospects/import')){revision++;result={imported:1,errors:[]};}
    else if(path.includes('/grow/prospects/one/status')){status=body.status;revision++;result={ok:true};}
    else if(path.includes('/grow/prospects/one/consent')){revision++;result={ok:true};}
    else if(path.includes('/grow/prospects/one'))result={...row,status,consents:[],replies:[],tasks:[]};
    else if(path.includes('/grow/prospects')&&method==='POST'){revision++;result={uid:'one'};}
    else if(path.includes('/grow/prospects?')){const empty=path.includes('source=website');result={available:true,total:empty?0:1+revision,columns:PROSPECT_COLUMNS.map(([key])=>({status:key,count:key===status&&!empty?1+revision:0,cards:key===status&&!empty?[{...row,status}]:[],more:0}))};}
    else if(path.includes('/cycles/grow/campaigns'))result={campaigns:[]};
    return new Response(JSON.stringify(result),{status:code,headers:{'content-type':'application/json'}});
  };
  let ui;
  try {ui=await mountContracts(h(AuthProvider,null,h(RailPageProvider,{role},h(Component,{projectId:7,cycle:'grow',slug:'distribution',tab,campaignNew:tab==='campaigns'}))),`/grow/distribution/${tab==='campaigns'?'campaigns/new':tab}?project_id=7${query}`,{id:1,role});await ui.flush();return {ui,calls,close:async()=>{await ui.unmount();globalThis.fetch=before;__resetEadwynPanelForTest();}};}
  catch(e){await ui?.unmount();globalThis.fetch=before;__resetEadwynPanelForTest();throw e;}
}
async function routeContract(Component) {
  const {ui,calls,close}=await setup(Component);
  try {
    assert.match(ui.text(),/Fixture prospect/);assert.doesNotMatch(ui.text(),/private@example.test|Coming in this module soon/);
    assert.ok(calls.some(c=>c.path.includes('/grow/prospects?project=7')));
    assert.equal(calls.some(c=>/\/modules\/distribution(?:\?|$)/.test(c.path)),false);
    await ui.click('Website sign-up');await ui.flush();assert.match(ui.text(),/No prospects yet/);
    await ui.click('All sources');await ui.flush();await ui.click('FPFixture prospect');await ui.flush();assert.match(ui.text(),/private@example.test/);
    await ui.click('Move to Invited');await ui.flush();assert.ok(calls.some(c=>c.body?.status==='invited'));assert.match(ui.text(),/2 prospects/);
    await ui.click('Save permission');await ui.flush();assert.match(ui.text(),/3 prospects/);
  } finally {await close();}
}
test('actual Prospects route reads the venture, filters safely and refreshes after sheet edits; mount mutation caught',async()=>{
  await mutationCheck(source('pages/cycles/CycleRoute.jsx'),'pages/cycles/CycleRoute.jsx',m=>routeContract(m.default),[["if (distributionTab === 'prospects' && projectStatus === 'ready')", "if (false && distributionTab === 'prospects' && projectStatus === 'ready')"]]);
});
async function permissionContract(Component=CycleRoute) {
  for(const options of [{role:'advisor'},{role:'founder',write:false},{role:'founder',permissionFails:true},{role:'founder',permissionMalformed:true}]){
    const {ui,calls,close}=await setup(Component,options);
    try {assert.match(ui.text(),/Fixture prospect/);for(const label of ['+ Add a prospect','Import contacts']){const button=ui.nodes().find(n=>n.tagName==='BUTTON'&&text(n)===label);assert.ok(button);assert.equal(ui.props(button).disabled,true);}await ui.click('FPFixture prospect');await ui.flush();const move=ui.nodes().find(n=>n.tagName==='BUTTON'&&text(n)==='Move to Invited');assert.ok(move,ui.text());assert.equal(ui.props(move).disabled,true);assert.equal(calls.some(c=>c.method!=='GET'),false);if(options.permissionFails||options.permissionMalformed)assert.match(ui.text(),/permission to change prospects could not be read/);}finally{await close();}
  }
}
test('server permissions fail closed; deliberately granting writes fails the mounted controls',async()=>{
  await permissionContract();
  await mutationCheck(source('pages/cycles/distribution/ProspectsPage.jsx'),'pages/cycles/distribution/ProspectsPage.jsx',m=>permissionContract(m.default),[['canWrite: data.can_write','canWrite: true'],["{ status: 'unreadable', canWrite: false }","{ status: 'unreadable', canWrite: true }"]]);
});
test('mounted add sheet submits each explicit consent choice and refreshes the pipeline',async()=>{
  for(const [basis,label]of [['none','No consent yet'],['opted_in','Opted in on a form'],['wrote_first','Wrote to you first']]){
    const {ui,calls,close}=await setup();
    try{await ui.click('+ Add a prospect');await ui.fill('name','Added fixture');await ui.fill('email','fixture@example.test');await ui.fill(label,'');if(basis!=='none')await ui.fill('Proof','Form fixture, 2026-11-05');const form=ui.nodes().find(n=>n.tagName==='FORM'&&ui.props(n)?.id==='add-prospect-form');await act(async()=>{await ui.props(form).onSubmit({preventDefault(){}});});await ui.flush();assert.ok(calls.some(c=>c.method==='POST'&&c.body?.basis===basis&&c.body?.project===7));assert.match(ui.text(),/2 prospects/);}finally{await close();}
  }
});
async function importContract(Component=CycleRoute) {
  const {ui,calls,close}=await setup(Component,{query:'&import=1'});
  try{assert.ok(ui.nodes().some(n=>ui.props(n)?.['data-testid']==='prospect-import-sheet'));const input=ui.nodes().find(n=>n.tagName==='INPUT'&&ui.props(n)?.type==='file');await act(async()=>{ui.props(input).onChange({target:{files:[{size:100,text:async()=> 'name,email,consent_basis\nFixture,fixture@example.test,none'}]}});});const submit=ui.nodes().filter(n=>n.tagName==='BUTTON'&&text(n)==='Import contacts').at(-1);await act(async()=>{await ui.props(submit).onClick();});await ui.flush();assert.ok(calls.some(c=>c.method==='POST'&&c.path.endsWith('/grow/prospects/import')&&c.body.project===7));assert.match(ui.text(),/2 prospects/);}finally{await close();}
}
test('wizard import door opens the consent-aware CSV sheet and refreshes after import; missing door fails',async()=>{
  await importContract();
  await mutationCheck(source('pages/cycles/distribution/ProspectsPage.jsx'),'pages/cycles/distribution/ProspectsPage.jsx',m=>importContract(m.default),[["importing={params.get('import') === '1'}",'importing={false}']]);
});
async function wizardContract(Component=CycleRoute) {
  const {ui,calls,close}=await setup(Component,{tab:'campaigns'});
  try {
    await ui.fill('Name','Fixture campaign');await ui.click('DemosBooked demos');await ui.click('Continue');await ui.flush();assert.match(ui.text(),/Consent: 7 can be emailed/);
    await ui.click('An imported listCSV, with consent per row');assert.match(ui.text(),/Consent: Not recorded/);
    await ui.click('A saved segment');await ui.fill('Segment','3');await ui.flush();assert.ok(calls.some(c=>c.path.includes('segment=3')));assert.match(ui.text(),/Consent: 7 can be emailed/);
    await ui.click('Continue');await ui.click('Continue');await ui.click('Continue');await ui.click('Continue');assert.match(ui.text(),/A saved segment · Recorded segment · 7 reachable/);
    for(let n=0;n<4;n++)await ui.click('Back');await ui.fill('Segment','4');await ui.flush();assert.match(ui.text(),/Consent: Not recorded/);assert.doesNotMatch(ui.text(),/7 can be emailed/);
    for(let n=0;n<4;n++)await ui.click('Continue');assert.match(ui.text(),/Unknown membership · Not recorded/);assert.doesNotMatch(ui.text(),/7 reachable/);
    assert.equal(calls.some(c=>c.method!=='GET'),false);
  } finally {await close();}
}
test('real campaign wizard shares the selected consent scope between Audience and Schedule',async()=>{await wizardContract();});

test('removing either wizard consent slot or its selected segment fails the live flow',async()=>{
  await mutationCheck(source('pages/cycles/distribution/NewCampaignPage.jsx').replace("import './campaigns.css';",''),'pages/cycles/distribution/NewCampaignPage.jsx',m=>wizardContract(m.default),[['consentSlot={consentSlot??<ConsentSummaryView state={audienceConsent}/>}','consentSlot={null}'],["['icp','segment'].includes(draft.audience_kind)?draft.segment_id:null",'null'],['reachableLabel:reachableLabel(audienceConsent)',"reachableLabel:'Not recorded'"]]);
});
