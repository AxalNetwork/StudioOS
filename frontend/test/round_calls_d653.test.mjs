/** D653: real React views and isolated behavioral mutation/restoration probes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { renderedText } from './_renderedText.mjs';
import * as sheet from '../src/pages/founder/RoundCallSheet.jsx';
import * as page from '../src/pages/founder/RoundCallPage.jsx';
import * as parts from '../src/pages/founder/roundCallParts.jsx';
import { SentUpdateView } from '../src/pages/founder/SentUpdatePage.jsx';

const on=new Proxy({}, {get:()=>()=>{}});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(Component,props)));
const call={uid:'call',project_id:1,name:'Recorded seed',amount_cents:10000000,instrument:'safe',terms:'Recorded terms',minimum_cheque_cents:100000,target_close:'2099-01-15',state:'sent',deck_version:2,data_room_project_uid:'venture'};
const readiness=[['round','Round target'],['terms','Round terms'],['deck','Pitch deck version'],['data_room','Data room'],['use_of_funds','Use of funds'],['traction','Traction'],['close','Target close']].map(([key,label])=>({key,label,ready:true}));
const founder={call,viewer:'founder',read_only:false,counsel_approved:true,recipients:[],questions:[],progress:{received:0,opened:0,data_room_requests:0,commitments:0,committed_cents:0,target_cents:10000000}};
const investor={call,viewer:'investor',read_only:false,deck:null,questions:[],recipient:{},data_room:{recorded:false,nda_signed:false,has_grant:false,path:null}};
const sheetBase={step:0,fields:{name:'Recorded seed',amount:'100000',instrument:'safe',terms:'Recorded terms',minimum:'1000',target:'2099-01-15',deck_id:'',room:false},
  context:{project:{id:1,name:'Venture'},round:null,scenario:null,decks:[],chosen:[],data_room:null},chosen:[],includeMatches:false,matches:null,page:{...founder,readiness},
  busy:false,error:'',outcome:null,uid:'call',editing:null,choosing:false,note:null,projectId:1};
const pageBase={data:founder,busy:false,error:'',message:'',recipientPage:0,reference:'',target:'',amount:'',question:'',answers:{}};
const sheetHtml=(m,s={})=>render(m.sheet.RoundCallSheetView,{state:{...sheetBase,...s},on});
const pageHtml=(m,data,extra={})=>render(m.page.RoundCallPageView,{state:{...pageBase,data,...extra},on});
// These views render plain-text button labels. Compare them literally, so a
// label cannot become a regular expression or silently match a different button.
function button(html,label) {
  let from=0;
  for (;;) {
    const start=html.indexOf('<button',from);
    if(start<0)return 'MISSING';
    const end=html.indexOf('>',start+7);
    if(end<0)return 'MISSING';
    if(html[start+7]!==' '&&html[start+7]!=='>' ){from=end+1;continue;}
    const close=html.indexOf('</button>',end+1);
    if(close<0)return 'MISSING';
    if(html.slice(end+1,close)===label)return html.slice(start+7,end);
    from=close+9;
  }
}
const actual={sheet,page,parts,SentUpdateView};
const checks={
  steps(m){const html=sheetHtml(m);assert.deepEqual([m.sheet.ROUND_CALL_STEPS,html.includes('aria-current="step"'),html.includes('value="Recorded seed"')],[['The round','Materials','Audience','Preview','Send'],true,true]);},
  footer(m){const first=sheetHtml(m),second=sheetHtml(m,{step:1});
    assert.deepEqual([renderedText(first).includes('Step 1 of 5'),button(first,'Back'),renderedText(second).includes('Step 2 of 5'),button(second,'Back')==='MISSING'],[true,'MISSING',true,false]);},
  rows(m){const text=renderedText(sheetHtml(m,{fields:{...sheetBase.fields,amount:'1000000',minimum:'',target:'2099-01-15'}}));
    const editing=sheetHtml(m,{editing:'minimum'});
    assert.deepEqual([text.includes('Filled from your round planner'),text.includes('$1,000,000'),text.includes('Not recorded'),text.includes('15 Jan'),button(editing,'Done')!=='MISSING',m.sheet.firstMissingRow({...sheetBase.fields,minimum:''}),m.sheet.firstMissingRow(sheetBase.fields)],[true,true,true,true,true,'minimum',null]);},
  seed(m){const context={project:{name:'Venture'},round:null,scenario:{inputs_json:JSON.stringify({rounds:[{name:'Real equity',investment:32100,pre_money:800000}]})}};
    const inferred=m.sheet.recordedRoundFields(context);const explicit=m.sheet.recordedRoundFields({...context,round:{name:'Planner seed',target_amount:42000,notes:'Recorded planner terms'}});
    assert.deepEqual([inferred.name,inferred.amount,inferred.instrument,inferred.terms,explicit.name,explicit.amount,explicit.terms],['Real equity','32100','equity','Pre-money $800k','Planner seed','42000','Recorded planner terms']);
    const safe=s=>m.sheet.recordedRoundFields({project:{name:'V'},round:null,scenario:{inputs_json:JSON.stringify({safes:[s]})}}).terms;
    assert.deepEqual([safe({cap:8000000}),safe({instrument:'note',cap:8000000,discount:0.2}),m.sheet.recordedRoundFields({project:{name:'V'},round:null,scenario:{inputs_json:JSON.stringify({rounds:[{pre_money:12000000}]})}}).terms],['Cap $8M','Cap $8M · discount 20%','Pre-money $12M']);},
  preselect(m){const decks=[{id:7,version:3,is_current:0},{id:9,version:4,is_current:0},{id:5,version:2,is_current:1}];
    const fresh=m.sheet.recordedRoundFields({project:{name:'V'},decks,data_room:{project_uid:'v'}});
    const highest=m.sheet.recordedRoundFields({project:{name:'V'},decks:decks.map(d=>({...d,is_current:0})),data_room:null});
    const kept=m.sheet.recordedRoundFields({project:{name:'V'},decks,data_room:{project_uid:'v'}},{...call,deck_id:7,data_room_project_uid:null});
    assert.deepEqual([fresh.deck_id,fresh.room,highest.deck_id,highest.room,kept.deck_id,kept.room],['5',true,'9',false,'7',false]);},
  materials(m){const text=renderedText(sheetHtml(m,{step:1}));assert.deepEqual([text.includes('no pitch deck version exists'),text.includes('No data room yet'),text.includes('Create a data room')],[true,true,true]);},
  audience(m){const none=sheetHtml(m,{step:2,choosing:true,matches:{data:{matched:0,match_reasons:[]}}}),some=sheetHtml(m,{step:2,matches:{data:{matched:3,match_reasons:['Thesis fits fintech']}}});
    assert.deepEqual([renderedText(none).includes('No matching investors yet'),button(none,'Include'),renderedText(none).includes('No verified investor from this venture'),renderedText(some).includes('3 verified investors match · Thesis fits fintech. Names appear only once they respond.'),button(some,'Include').includes('aria-pressed="false"'),renderedText(sheetHtml(m,{step:2,matches:{error:{}}})).includes('Matches are unreadable')],[true,'MISSING',true,true,true,true]);},
  preview(m){const text=renderedText(sheetHtml(m,{step:3,page:{...founder,readiness,call:{...call,deck_version:null,data_room_project_uid:null},progress:{...founder.progress,received:4}}}));assert.deepEqual([text.includes('no version linked'),text.includes('no room linked'),text.includes('As an investor sees it')],[true,true,true]);},
  counsel(m){const html=sheetHtml(m,{step:4,page:{...founder,counsel_approved:false,readiness}});assert.deepEqual([button(html,'Send the call').includes(' disabled='),renderedText(html).includes('Counsel has not approved the terms yet'),button(html,'Check again')!=='MISSING'],[true,true,true]);},
  readiness(m){const items=readiness.map((r,i)=>({...r,ready:i>2}));
    const html=sheetHtml(m,{step:4,page:{...founder,readiness:items,recipients:[{origin:'chosen'},{origin:'match'},{origin:'match'}]}});
    assert.deepEqual([renderedText(html).includes('3 of 7 call readiness items are missing'),renderedText(html).includes('Readiness — 4 of 7 items in place'),button(html,'Send anyway').includes(' disabled='),html.includes('type="checkbox"'),renderedText(html).includes('To 1 chosen investors and 2 matching investors'),button(html,'Finish them first')!=='MISSING',m.sheet.readinessTarget('deck',1),m.sheet.readinessTarget('use_of_funds',1)],[true,true,false,false,true,true,{step:1},{href:'/raise/use-of-funds?project_id=1'}]);},
  resume(m){const p=(o)=>({call:{...call,target_close:'2099-01-15'},counsel_approved:false,recipients:[],...o});
    assert.deepEqual([m.sheet.resumeStep(p({}),'2098-01-01').step,m.sheet.resumeStep(p({recipients:[{origin:'chosen'}]}),'2098-01-01').step,m.sheet.resumeStep(p({counsel_approved:true}),'2098-01-01').step,m.sheet.resumeStep(p({counsel_approved:true}),'2100-01-01').step],[1,3,4,0]);
    const items=[{uid:'d',state:'draft'},{uid:'old',state:'sent',target_close:'2097-01-01'},{uid:'w',state:'awaiting_counsel',name:'Seed',target_close:'2099-01-15'}];
    assert.deepEqual([m.sheet.openCallOf(items,'2098-01-01')?.uid,m.sheet.openCallOf(items.slice(0,2),'2098-01-01')],['w',null]);
    assert.match(renderedText(render(m.sheet.OpenCallNotice,{call:items[2]})),/This venture has an open call · Seed · closes .*Open the call/);},
  outcome(m){const text=renderedText(sheetHtml(m,{step:4,outcome:{recipients:4,notified:3,not_delivered:1}}));assert.match(text,/available to 4 verified recipients; 3 notified, 1 not delivered/);},
  reads(m){const read=(state)=>render(m.parts.CallReadState,{read:{...state,retry:on.retry},children:React.createElement('p',null,'No calls are recorded')});
    assert.deepEqual([renderedText(read({loading:true})),renderedText(read({error:{code:'round_calls_disabled'}})),renderedText(read({error:{code:'unavailable'}})),renderedText(read({loading:false,error:null}))],['Loading…','Coming soon. Round calls are not enabled.','Unreadable. Try again','No calls are recorded']);},
  money(m){assert.deepEqual([m.parts.moneyCents(null),m.parts.moneyCents(0),m.parts.dollarsToCents('12.34'),m.parts.dollarsToCents('12.345'),m.parts.dollarsToCents('0'),m.parts.dollarsToCents('9007199254740992')],['Not recorded','$0',1234,null,null,null]);},
  recipients(m){const recipients=[{origin:'match',opened_at:'2098-01-01',commitment_cents:null},{origin:'match',name:'Real responder',email:'real@example.test',commitment_cents:0}];
    const text=renderedText(pageHtml(m,{...founder,recipients}));
    assert.deepEqual([text.includes('identity private until a response'),text.includes('Real responder · real@example.test'),text.includes('No commitment recorded'),text.includes('No recipients are recorded yet')],[true,true,true,false]);},
  closed(m){const text=renderedText(pageHtml(m,{...investor,call:{...call,state:'closed'},read_only:true}));
    const owner=renderedText(pageHtml(m,{...founder,call:{...call,state:'closed'},read_only:true,questions:[{uid:'q',question:'A question'}]}));
    assert.deepEqual([text.includes('read-only'),text.includes('Commit with an amount'),text.includes('Ask a question'),owner.includes('Extend the date'),owner.includes('Close the call'),owner.includes('Answer in place')],[true,false,false,false,false,false]);},
  waiting(m){const c={...call,state:'awaiting_counsel'},readonly={...investor,call:c,read_only:true};
    const text=renderedText(pageHtml(m,readonly)),hq=renderedText(pageHtml(m,{...founder,call:c,viewer:'counsel',read_only:true,counsel_approved:false},{reference:'Counsel renewed approval'}));
    assert.deepEqual([text.includes('paused until counsel'),text.includes('Commit with an amount'),hq.includes('Record approved terms')],[true,false,true]);},
  changedDeck(m){const text=renderedText(render(m.page.RecordedCallDeck,{deck:{unreadable:true}}));assert.deepEqual([text.includes('deck changed after approval'),text.includes('restore the approved deck')],[true,true]);},
  nda(m){const invalid=pageHtml(m,{...investor,data_room:{recorded:true,nda_signed:false,has_grant:true,path:'/research/diligence/private'}});
    const valid=pageHtml(m,{...investor,data_room:{recorded:true,nda_signed:true,has_grant:true,path:'/research/diligence/private'}});
    assert.deepEqual([invalid.includes('href="/research/diligence/private"'),renderedText(invalid).includes('Request the NDA'),valid.includes('href="/research/diligence/private"')],[false,true,true]);},
  deck(m){const missing=render(m.page.RecordedCallDeck,{deck:null}),bad=render(m.page.RecordedCallDeck,{deck:{slides:'invalid'}}),
      recorded=render(m.page.RecordedCallDeck,{deck:{title:'Actual deck',version:2,slides:JSON.stringify([{title:'Actual evidence',traction:{mrr:0}}])}});
    assert.deepEqual([renderedText(missing).includes('no linked deck version could be read'),renderedText(bad).includes('Unreadable'),renderedText(recorded).includes('Actual evidence'),renderedText(recorded).includes('0')],[true,true,true,true]);},
  update(m){const html=render(m.SentUpdateView,{data:{title:'Actual update',sent_at:'2098-01-01',audience:'investor',asks:[{uid:'ask',kind:'capital',text:'Join',link_ref:'call'}]}});
    const off=render(m.SentUpdateView,{data:{title:'Actual update',asks:[{uid:'ask',kind:'capital',text:'Join',link_ref:null,link_reason:'Coming soon. Round calls are not enabled.'}]}});
    assert.deepEqual([html.includes('href="/round-calls/call"'),renderedText(off).includes('Coming soon'),off.includes('href="/round-calls/')],[true,true,false]);},
};
for(const [name,check]of Object.entries(checks))test('D653 rendered view: '+name,()=>check(actual));

// Transform the actual JSX with Vite, preserving the production dependencies.
// Only the isolated data-URL module changes; all other tests read original files.
async function altered(path,old,replacement,index) {
  let source=readFileSync(path,'utf8');if(!source.includes(old))throw Error('Stale mutation: '+old);
  source=source.replace(old,replacement);
  const {code}=await transformWithOxc(source,resolve(path),{jsx:{runtime:'automatic'}});
  const req=createRequire(pathToFileURL(resolve(path)));
  const js=code.replace(/from (['"])([^'"]+)\1/g,(_m,q,spec)=>{
    let target;if(spec.startsWith('.')){target=resolve(dirname(path),spec);if(existsSync(target)&&statSync(target).isDirectory())target=['.jsx','.js','.ts','.tsx'].map(ext=>resolve(target,'index'+ext)).find(existsSync);else if(!existsSync(target))target=['.jsx','.js','.ts','.tsx'].map(ext=>target+ext).find(existsSync);if(!target)throw Error('Missing dependency '+spec);}else target=req.resolve(spec);
    return 'from '+q+pathToFileURL(target).href+q;
  });
  return import('data:text/javascript;base64,'+Buffer.from(js+'\n// d653-render-'+index).toString('base64'));
}
const probes=[
  ['waiting','page',"['draft','awaiting_counsel'].includes(c.state)","c.state==='draft'"],
  ['changedDeck','page',"if(deck?.unreadable)return", "if(false)return"],
  ['steps','sheet',"'The round','Materials','Audience','Preview','Send'","'The round','Audience','Materials','Preview','Send'"],
  ['footer','sheet',"Step {s.step+1} of 5","Step {s.step} of 5"],
  ['footer','sheet',"{s.step>0&&<button","{true&&<button"],
  ['rows','sheet',"{value??'Not recorded'}","{value??''}"],
  ['rows','sheet',"return ROUND_ROWS.find(row=>!row.show(fields))?.key??null;","return null;"],
  ['seed','sheet',"'Cap '+shortUsd(safe.cap)","'Valuation cap USD '+safe.cap"],
  ['seed','sheet',"'discount '+percent(safe.discount)","'discount '+safe.discount"],
  ['preselect','sheet',"decks.find(d=>d.is_current)||","null||"],
  ['preselect','sheet',":!!context.data_room}",":false}"],
  ['audience','sheet',":data.matched>0?<>",":true?<>"],
  ['resume','sheet',"if(page.counsel_approved)return","if(false)return"],
  ['resume','sheet',"c.state==='awaiting_counsel'||","false||"],
  ['seed','sheet',"priced?.investment!=null?String(priced.investment)","priced?.investment!=null?'0'"],
  ['seed','sheet',"round?.target_amount!=null?String(round.target_amount)","round?.target_amount!=null?'0'"],
  ['materials','sheet',"No data room yet.","Data room ready."],
  ['materials','sheet',"no pitch deck version exists","deck linked"],
  ['audience','sheet',"No matching investors yet ·","Matching investors ready ·"],
  ['preview','sheet',"no version linked","version exists"],
  ['counsel','sheet',"disabled={s.busy||!approved}","disabled={s.busy}"],
  ['readiness','sheet',"{missing.length} of {total} call readiness","{0} of {total} call readiness"],
  ['readiness','sheet',"if(key==='deck')return {step:1};",""],
  ['outcome','sheet',"{s.outcome.notified} notified","{s.outcome.recipients} notified"],
  ['reads','parts',"if(read.loading)return","if(false)return"],
  ['reads','parts',"read.error.code==='round_calls_disabled'","false"],
  ['money','parts',"if(value==null)return 'Not recorded';","if(value==null)return '$0';"],
  ['money','parts',"cents>0","cents>=0"],
  ['recipients','page',"identity private until a response","identity shared"],
  ['closed','page',"!d.read_only&&<section className=\"space-y-3\"","true&&<section className=\"space-y-3\""],
  ['closed','page',"['sent','awaiting_counsel'].includes(c.state)","true"],
  ['nda','page',"d.data_room.path&&d.data_room.nda_signed&&d.data_room.has_grant","d.data_room.path"],
  ['deck','page',"no linked deck version could be read","deck available"],
  ['deck','page',"Unreadable · the recorded deck could not be decoded.","Deck ready."],
  ['update','SentUpdateView',"{a.kind==='capital'&&(a.link_ref?","{false&&(a.link_ref?"],
];
for(const [index,[name,kind,old,replacement]]of probes.entries())test('D653 rendered mutation/restoration '+index+': '+name,async()=>{
  const file=kind==='sheet'?'RoundCallSheet.jsx':kind==='parts'?'roundCallParts.jsx':kind==='page'?'RoundCallPage.jsx':'SentUpdatePage.jsx';
  const mod=await altered('frontend/src/pages/founder/'+file,old,replacement,index);
  await assert.rejects(async()=>checks[name]({...actual,[kind]:kind==='SentUpdateView'?mod.SentUpdateView:mod}),assert.AssertionError);
  checks[name](actual);
});
