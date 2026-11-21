/** D6154: mounted record/list journeys, confirmation, final recusal and legacy redirects; synthetic members and API data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {Routes,Route,Navigate,useLocation} from 'react-router-dom';
import {readFileSync} from 'node:fs';
import {api,dd} from '../src/lib/api';
import {AuthProvider} from '../src/hooks/useAuthSync.jsx';
import Detail from '../src/pages/ICDecisionPage.jsx';
import CommitShell from '../src/pages/ICCommitShell.jsx';
import {ICDecisionsList} from '../src/pages/ICDecisionsPage.jsx';
import {mountForm,propsOf,textOf} from './_form_d695.mjs';
const h=React.createElement;
const record=()=>({id:11,uid:'synthetic-record',title:'Synthetic investment',created_by:7,status:'voting',memo:'Saved memo',terms:{Instrument:'SAFE'},votes:[],conditions:[],tally:{yes:0,no:0,abstain:0,recused:0},roster:{available:false,members:[]}});
function Location(){return h('p',{'data-testid':'location'},useLocation().pathname+useLocation().search);}
async function setup({author=7,legacy=false,list=false,partner=false,shell=false}={}){
 const originals={...api},oldDD=dd.listCases,oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;
 const user={id:author,role:partner?'partner':'investor',name:'Synthetic voter'};globalThis.localStorage={getItem:k=>k==='user'?JSON.stringify(user):null,setItem(){},removeItem(){}};
 globalThis.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
 const row=record(),calls=[];Object.assign(api,{getMe:async()=>user,icGet:async()=>structuredClone(row),icCommitRoom:async()=>({current:null}),icUpdate:async(uid,body)=>{calls.push(['update',uid,body]);Object.assign(row,body);},icVote:async(uid,body)=>{calls.push(['vote',uid,body]);row.votes=[{user_id:user.id,...body}];row.tally.recused=body.vote==='recused'?1:0;},listProjects:async()=>[{id:21,name:'Synthetic venture'}],listDeals:async()=>[{id:31,title:'Synthetic deal'}],icCreate:async body=>{calls.push(['create',body]);return{uid:'new-synthetic'};}});dd.listCases=async()=>({items:[]});
 const target=legacy?'/ic/synthetic-record':'/deals/commit/synthetic-record';
 const el=list?h(ICDecisionsList,{items:[]}):h(Routes,null,h(Route,{path:'/',element:h(Navigate,{to:target})}),h(Route,{path:'/ic/:uid',element:h(Detail)}),h(Route,{path:'/deals/commit/:uid',element:h(Detail)}));
 function Session(){localStorage.setItem('user',JSON.stringify(user));return h(AuthProvider,null,shell?h(CommitShell,null,el):el,h(Location));}
 const ui=await mountForm(h(Session),{modal:true});await ui.flush();
 return{...ui,row,calls,async close(){await ui.unmount();Object.assign(api,originals);dd.listCases=oldDD;globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch;},async change(label,value){const node=ui.nodes().find(n=>propsOf(n)['aria-label']===label||propsOf(n).id===label);assert.ok(node,label);await act(async()=>propsOf(node).onChange({target:{value}}));}};
}
test('author records only after confirmation, while another member sees read-only terms and conditions',async()=>{
 const ui=await setup();try{await ui.click('invest');assert.equal(ui.calls.length,0);assert.match(ui.text(),/Record invest/);await ui.click('Confirm record decision');await ui.flush();assert.deepEqual(ui.calls[0],['update','synthetic-record',{decision:'invest'}]);}finally{await ui.close();}
 const ro=await setup({author:9});try{assert.ok(!ro.nodes().some(n=>['Save memo','Edit terms','Add condition','invest'].includes(textOf(n))));assert.match(ro.text(),/Only the person who opened/);}finally{await ro.close();}
});
test('recusal uses a named dialog, requires a declaration and remains final beside the tally',async()=>{
 const ui=await setup({author:9});try{await ui.click('Recuse…');assert.ok(ui.nodes().some(n=>propsOf(n).role==='dialog'));const submit=ui.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n)==='Recuse from this decision');assert.ok(submit);assert.equal(propsOf(submit).disabled,true);await ui.change('ic-recusal-declaration','Synthetic disclosed conflict');await ui.click('Recuse from this decision');await ui.flush();assert.deepEqual(ui.calls[0],['vote','synthetic-record',{vote:'recused',rationale:'Synthetic disclosed conflict'}]);assert.match(ui.text(),/You recused yourself/);assert.ok(!ui.nodes().some(n=>n.tagName==='BUTTON'&&textOf(n)==='Recuse…'));}finally{await ui.close();}
});
test('legacy detail keeps the uid and new route declares Commit-only partner access',async()=>{
 const ui=await setup({legacy:true});try{assert.match(ui.text(),/\/deals\/commit\/synthetic-record/);}finally{await ui.close();}
 const route=readFileSync('frontend/src/routes/icDecisions.jsx','utf8');assert.match(route,/path="\/deals\/commit\/:uid"/);assert.match(route,/\['admin', 'partner', 'investor'\]/);assert.match(readFileSync('frontend/src/pages/ICDecisionsPage.jsx','utf8'),/to="\/deals\/commit\?view=decisions"/);
});
test('opening chooses stored venture/deal values instead of typed IDs and preserves a refusal',async()=>{
 const ui=await setup({list:true});try{await ui.click('Open a decision');await ui.flush();const nodes=ui.nodes();assert.ok(nodes.some(n=>n.tagName==='OPTION'&&propsOf(n).value===21));assert.ok(nodes.some(n=>n.tagName==='OPTION'&&propsOf(n).value===31));const fields=nodes.filter(n=>n.tagName==='INPUT');const title=fields.find(n=>propsOf(n).required);await act(async()=>propsOf(title).onChange({target:{value:'Synthetic committee'}}));const selects=nodes.filter(n=>n.tagName==='SELECT');await act(async()=>propsOf(selects[1]).onChange({target:{value:'31'}}));await act(async()=>propsOf(selects[2]).onChange({target:{value:'21'}}));api.icCreate=async()=>{throw new Error('Synthetic refusal');};await ui.submit();assert.match(ui.text(),/Synthetic refusal/);assert.equal(propsOf(ui.nodes().find(n=>n.tagName==='INPUT'&&propsOf(n).required)).value,'Synthetic committee');assert.ok(!ui.text().includes('Startup ID'));}finally{await ui.close();}
});

test('minutes never borrow another decision’s meeting and preserve a refused edit draft',async()=>{
 const {default:Minutes}=await import('../src/pages/ICDecisionMinutes.jsx');const oldRoom=api.icCommitRoom,oldSave=api.icRecordMinutes;
 try{
  api.icCommitRoom=async()=>({current:{uid:'different'},minutes:{available:true,recorded:true,minutes:'Unrelated minutes'}});
  let ui=await mountForm(h(Minutes,{uid:'synthetic-record'}));try{await ui.flush();assert.match(ui.text(),/not available here/);assert.doesNotMatch(ui.text(),/Unrelated minutes/);}finally{await ui.unmount();}
  api.icCommitRoom=async()=>({current:{uid:'synthetic-record'},minutes:{available:true,recorded:true,minutes:'Saved minutes',meeting_uid:'m1',may_record:true}});
  api.icRecordMinutes=async()=>{throw Object.assign(new Error('Synthetic save refusal'),{status:403});};
  ui=await mountForm(h(Minutes,{uid:'synthetic-record'}));try{await ui.flush();await ui.click('Edit minutes');const input=ui.nodes().find(n=>n.tagName==='TEXTAREA');await act(async()=>propsOf(input).onChange({target:{value:'Unsaved minutes draft'}}));await ui.submit();assert.match(ui.text(),/Refused.*Synthetic save refusal/);assert.equal(propsOf(ui.nodes().find(n=>n.tagName==='TEXTAREA')).value,'Unsaved minutes draft');}finally{await ui.unmount();}
 }finally{api.icCommitRoom=oldRoom;api.icRecordMinutes=oldSave;}
});

test('partner records expose only the Commit navigation in the actual Deals shell',async()=>{const ui=await setup({partner:true,shell:true});try{const links=ui.nodes().filter(n=>n.tagName==='A').map(n=>propsOf(n).href);assert.ok(links.includes('/deals/commit'));assert.ok(!links.includes('/deals/screening'));assert.ok(!links.includes('/deals/closing'));}finally{await ui.close();}});
