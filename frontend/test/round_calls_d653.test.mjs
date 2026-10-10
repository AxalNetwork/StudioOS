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
const readiness=['Round target','Terms','Pitch deck','Data room','Use of funds','Traction','Target close'].map((label,i)=>({key:String(i),label,ready:true}));
const founder={call,viewer:'founder',read_only:false,counsel_approved:true,recipients:[],questions:[],progress:{received:0,opened:0,data_room_requests:0,commitments:0,committed_cents:0,target_cents:10000000}};
const investor={call,viewer:'investor',read_only:false,deck:null,questions:[],recipient:{},data_room:{recorded:false,nda_signed:false,has_grant:false,path:null}};
const sheetBase={step:0,fields:{name:'Recorded seed',amount:'100000',instrument:'safe',terms:'Recorded terms',minimum:'1000',target:'2099-01-15',deck_id:'',room:false},
  context:{project:{id:1,name:'Venture'},round:null,scenario:null,decks:[],chosen:[],data_room:null},chosen:[],includeMatches:false,matches:null,page:{...founder,readiness},
  acknowledge:false,busy:false,error:'',outcome:null,uid:'call'};
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
  steps(m){const html=sheetHtml(m);assert.deepEqual([m.sheet.ROUND_CALL_STEPS,html.includes('aria-current="step"'),html.includes('value="Recorded seed"')],[['Round','Materials','Audience','Preview','Send'],true,true]);},
  seed(m){const context={project:{name:'Venture'},round:null,scenario:{inputs_json:JSON.stringify({rounds:[{name:'Real equity',investment:32100,pre_money:800000}]})}};
    const inferred=m.sheet.recordedRoundFields(context);const explicit=m.sheet.recordedRoundFields({...context,round:{name:'Planner seed',target_amount:42000,notes:'Recorded planner terms'}});
    assert.deepEqual([inferred.name,inferred.amount,inferred.instrument,inferred.terms,explicit.name,explicit.amount,explicit.terms],['Real equity','32100','equity','Pre-money USD 800000','Planner seed','42000','Recorded planner terms']);},
  materials(m){const text=renderedText(sheetHtml(m,{step:1}));assert.deepEqual([text.includes('no pitch deck version exists'),text.includes('No data room yet'),text.includes('Create a data room')],[true,true,true]);},
  audience(m){const text=renderedText(sheetHtml(m,{step:2,matches:{matched:0,match_reasons:[]}}));assert.deepEqual([text.includes('No matching investors yet'),text.includes('Names appear only once an investor responds'),text.includes('No verified investor from this venture')],[true,true,true]);},
  preview(m){const text=renderedText(sheetHtml(m,{step:3,page:{...founder,readiness,call:{...call,deck_version:null,data_room_project_uid:null},progress:{...founder.progress,received:4}}}));assert.deepEqual([text.includes('no version linked'),text.includes('no room linked'),text.includes('4 verified recipients')],[true,true,true]);},
  counsel(m){const html=sheetHtml(m,{step:4,acknowledge:true,page:{...founder,counsel_approved:false,readiness}});assert.deepEqual([button(html,'Send the call').includes(' disabled='),renderedText(html).includes('Counsel has not approved the terms yet')],[true,true]);},
  readiness(m){const items=readiness.map((r,i)=>({...r,ready:i>2}));
    const blocked=sheetHtml(m,{step:4,page:{...founder,readiness:items}});
    const allowed=sheetHtml(m,{step:4,page:{...founder,readiness:items},acknowledge:true});
    assert.deepEqual([renderedText(blocked).includes('3 of 7 readiness items are missing'),button(blocked,'Send anyway').includes(' disabled='),button(allowed,'Send anyway').includes(' disabled=')],[true,true,false]);},
  outcome(m){const text=renderedText(sheetHtml(m,{step:4,outcome:{recipients:4,notified:3,not_delivered:1}}));assert.match(text,/available to 4 verified recipients; 3 notified, 1 not delivered/);},
  availability(m){const disabled=render(m.sheet.RoundCallAvailability,{read:{data:{enabled:false},loading:false},projectId:1,onOpen:on.open});
    const enabled=render(m.sheet.RoundCallAvailability,{read:{data:{enabled:true},loading:false},projectId:1,onOpen:on.open});
    assert.deepEqual([button(disabled,'Call for Capital · Coming soon').includes(' disabled='),disabled.includes('href='),button(enabled,'Call for Capital').includes(' disabled='),enabled.includes('/round-calls?project_id=1')],[true,false,false,true]);},
  reads(m){const read=(state)=>render(m.parts.CallReadState,{read:{...state,retry:on.retry},children:React.createElement('p',null,'No calls are recorded')});
    assert.deepEqual([renderedText(read({loading:true})),renderedText(read({error:{code:'round_calls_disabled'}})),renderedText(read({error:{code:'unavailable'}})),renderedText(read({loading:false,error:null}))],['Loading…','Coming soon. Round calls are not enabled.','Unreadable. Try again','No calls are recorded']);},
  money(m){assert.deepEqual([m.parts.moneyCents(null),m.parts.moneyCents(0),m.parts.dollarsToCents('12.34'),m.parts.dollarsToCents('12.345'),m.parts.dollarsToCents('0'),m.parts.dollarsToCents('9007199254740992')],['Not recorded','US$0.00',1234,null,null,null]);},
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
  ['steps','sheet',"'Round','Materials','Audience','Preview','Send'","'Round','Audience','Materials','Preview','Send'"],
  ['seed','sheet',"priced?.investment!=null?String(priced.investment)","priced?.investment!=null?'0'"],
  ['seed','sheet',"round?.target_amount!=null?String(round.target_amount)","round?.target_amount!=null?'0'"],
  ['materials','sheet',"No data room yet.","Data room ready."],
  ['materials','sheet',"no pitch deck version exists","deck linked"],
  ['audience','sheet',"No matching investors yet.","Matching investors ready."],
  ['preview','sheet',"no version linked","version exists"],
  ['counsel','sheet',"s.busy||!approved||","s.busy||"],
  ['readiness','sheet',"(missing.length>0&&!s.acknowledge)","false"],
  ['readiness','sheet',"{missing.length} of {s.page.readiness.length}","{0} of {s.page.readiness.length}"],
  ['outcome','sheet',"{s.outcome.notified} notified","{s.outcome.recipients} notified"],
  ['availability','sheet',"read.loading||!read.data?.enabled||!projectId","read.loading||!projectId"],
  ['availability','sheet',"read.data?.enabled&&projectId&&<Link","projectId&&<Link"],
  ['reads','parts',"if(read.loading)return","if(false)return"],
  ['reads','parts',"read.error.code==='round_calls_disabled'","false"],
  ['money','parts',"value==null?'Not recorded'","value==null?'US$0'"],
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
