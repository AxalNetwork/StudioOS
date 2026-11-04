/** D4488 (#4488): Distribution's quote-before-run, unsaved acceptance, safe counts and exclusive Ask panel. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import DistributionAskIntent from '../src/pages/cycles/distribution/DistributionAskIntent.jsx';
import WaitingForYou from '../src/pages/cycles/distribution/WaitingForYou.jsx';
import AskPanel from '../src/ui/AskPanel.jsx';
import { __resetEadwynPanelForTest, useAskRail } from '../src/ui/eadwynPanel.js';
import { holdLine, receiptLine, waitingModel, safeProposal, DISTRIBUTION_OPTION } from '../src/pages/cycles/distribution/distributionAskModel.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';
const h = React.createElement;
const p = (uid,kind='post',extra={}) => ({uid,status:'proposed',rail_option:DISTRIBUTION_OPTION,payload:{version:1,project:1,campaign_uid:null,target:'form',kind,text:'Synthetic shipment copy',sources:[],...extra}});
const props = n => Object.entries(n ?? {}).find(([k])=>k.startsWith('__reactProps$'))?.[1] ?? {};
const walk = n => [n,...(n.childNodes??[]).flatMap(walk)];
const txt = n => !n?'':n.childNodes?.length?n.childNodes.map(txt).join(''):n.textContent??'';
async function mount(element) {
  const restore=installDocument('',{focus:true});
  const oldAdd=window.addEventListener,oldRemove=window.removeEventListener,oldDispatch=window.dispatchEvent;
  window.addEventListener=()=>{};window.removeEventListener=()=>{};window.dispatchEvent=()=>true;
  const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);
  const settle=async()=>{for(let n=0;n<5;n++)await act(async()=>{await new Promise(r=>setTimeout(r,0));});};
  await act(async()=>root.render(element));await settle();
  return {box,settle,async render(el){await act(async()=>root.render(el));await settle();},all:()=>walk(box),text:()=>txt(box),async click(label){const node=walk(box).find(n=>n.tagName==='BUTTON'&&txt(n)===label);if(!node)throw Error(`Missing button ${label}: ${txt(box)}`);await act(async()=>props(node).onClick?.({preventDefault(){}}));await settle();},async close(){await act(async()=>root.unmount());window.addEventListener=oldAdd;window.removeEventListener=oldRemove;window.dispatchEvent=oldDispatch;restore();__resetEadwynPanelForTest();}};
}
function apiFor(rows=[p('one')],over={}) { const calls=[];return {calls,api:{quote:async b=>{calls.push(['quote',b]);return {estimate:{hold_microusd:40000,model:'synthetic'},sources:[{key:'validate',label:'Validate · ICP',count:2}]};},run:async b=>{calls.push(['run',b]);return {proposals:rows,receipt:{held_microusd:40000,charged_microusd:8000}};},proposals:async()=>({proposals:rows}),decide:async(uid,b)=>{calls.push(['decide',uid,b]);return {proposal:{...rows.find(p=>p.uid===uid),status:b.decision==='discard'?'discarded':'accepted',decided_payload:b.edited??null}};},acceptSafe:async b=>{calls.push(['safe',b]);return {results:[]};},...over}};}

test('hold and charged receipts use recorded microdollars; unread values stay unrecorded',()=>{
  assert.equal(holdLine({hold_microusd:40000}),'Holds up to $0.04 · you pay what it uses');
  assert.equal(holdLine(null),'Hold not recorded');
  assert.equal(receiptLine({held_microusd:40000,charged_microusd:8000}),'Charged $0.008 of $0.04 held');
  assert.equal(receiptLine({held_microusd:40000,charged_microusd:null}),'Charge not recorded');
});

test('listed count is actual open rows; bulk is exactly post, subject and newsletter',()=>{
  const rows=['post','subject_line','newsletter','reply','send','schedule','ad_creative','ad_spend','budget','rule'].map((k,n)=>p(String(n),k));
  rows.push({...p('closed'),status:'accepted'},p('money','post',{budget:1}));
  const model=waitingModel(rows);
  assert.equal(model.count,11);
  assert.deepEqual(model.safe.map(p=>p.payload.kind),['post','subject_line','newsletter']);
  assert.equal(safeProposal(p('nested','post',{values:{money:1}})),false);
});

test('drafting quotes first, displays its hold, and acceptance returns a proposal to the unsaved form',async()=>{
  const {api,calls}=apiFor();const accepted=[];
  const ui=await mount(h(DistributionAskIntent,{projectId:1,campaignUid:'campaign-one',api,onAccept:rows=>accepted.push(...rows)}));
  try {
    assert.match(ui.text(),/Holds up to \$0.04 · you pay what it uses/);
    assert.deepEqual(calls.map(c=>c[0]),['quote']);
    await ui.click('Ask Eadwyn to draft for each channel');
    assert.deepEqual(calls.map(c=>c[0]),['quote','run']);
    assert.equal(calls[1][1].target,'form');
    assert.match(ui.text(),/Not saved/);
    await ui.click('Accept');
    assert.equal(accepted.length,1);
    assert.match(ui.text(),/Not saved/);
    assert.deepEqual(calls.map(c=>c[0]),['quote','run','decide']);
    assert.doesNotMatch(ui.text(),/\bFill\b|~\$/);
  } finally {await ui.close();}
});

test('Waiting renders listed and safe counts and sends only safe UIDs to bulk',async()=>{
  const {api,calls}=apiFor([p('post'),p('reply','reply'),p('ad','ad_creative')]);
  const ui=await mount(h(WaitingForYou,{projectId:1,api}));
  try {
    assert.match(ui.text(),/DISTRIBUTION · 3 PROPOSALS/);
    assert.match(ui.text(),/Accept all safe \(1\)/);
    assert.equal(ui.all().filter(n=>String(props(n)['data-testid']??'').startsWith('distribution-proposal-')).length,3);
    await ui.click('Accept all safe (1)');
    assert.deepEqual(calls.find(c=>c[0]==='safe')[1].uids,['post']);
  } finally {await ui.close();}
});

test('unreadable waiting never invents a count, empty says nothing waits; token exhaustion keeps manual writing',async()=>{
  let f=apiFor([]);let ui=await mount(h(WaitingForYou,{projectId:1,api:f.api}));
  try{assert.match(ui.text(),/Nothing waits for you\./);}finally{await ui.close();}
  f=apiFor([],{proposals:async()=>{throw Error('PRIVATE provider');}});ui=await mount(h(WaitingForYou,{projectId:1,api:f.api}));
  try{assert.match(ui.text(),/Not recorded/);assert.doesNotMatch(ui.text(),/0 PROPOSALS|Accept all safe \(0\)|PRIVATE provider/);}finally{await ui.close();}
  f=apiFor([],{run:async()=>{throw {status:402,message:'PRIVATE provider'};}});ui=await mount(h(DistributionAskIntent,{projectId:1,api:f.api}));
  try{await ui.click('Ask Eadwyn to draft for each channel');assert.match(ui.text(),/included AI allowance and top-up balance cannot cover this run/);assert.match(ui.text(),/You can still write the post and the email yourself/);assert.match(ui.text(),/Add tokens/);assert.doesNotMatch(ui.text(),/PRIVATE provider/);}finally{await ui.close();}
});

test('Distribution rail row points to its actual run control, and exclusive panel has no conversation or composer',async()=>{
  const row=FOUNDER_OPTIONS.find(r=>r.key===DISTRIBUTION_OPTION);
  assert.equal(row.page,'Founder · Grow · Distribution');
  assert.ok(readFileSync(new URL(`../../${row.at[0][0]}`,import.meta.url),'utf8').includes(row.at[0][1]));
  function Rail(){useAskRail(true,'Founder · Grow · Distribution','Distribution');return null;}
  function Fixture(){return h(React.Fragment,null,h(Rail),h(AskPanel,{page:'Founder · Grow · Distribution',options:[],onClose(){}}),h(WaitingForYou,{projectId:1,api:apiFor([]).api}));}
  const ui=await mount(h(Fixture));
  try{assert.equal(ui.all().some(n=>props(n)['data-testid']==='ask-panel-log'),false);assert.equal(ui.all().some(n=>props(n)['data-testid']==='ask-panel-input'),false);}finally{await ui.close();}
});

test('token exhaustion leaves Waiting rows available; malformed list reads stay unreadable',async()=>{
  let f=apiFor([p('existing')]);let ui=await mount(h(WaitingForYou,{projectId:1,api:f.api,outOfTokens:true}));
  try{assert.match(ui.text(),/New proposals pause; the ones below stay/);assert.match(ui.text(),/Synthetic shipment copy/);assert.match(ui.text(),/Accept all safe \(1\)/);}finally{await ui.close();}
  f=apiFor([],{proposals:async()=>({})});ui=await mount(h(WaitingForYou,{projectId:1,api:f.api}));
  try{assert.match(ui.text(),/Unreadable: proposals could not be read/);assert.doesNotMatch(ui.text(),/0 PROPOSALS|Accept all safe \(0\)|Nothing waits for you/);}finally{await ui.close();}
});


test('a paused AI account is explained without offering tokens as a fix',async()=>{
  const f=apiFor([],{quote:async()=>{throw {status:403,code:'ai_paused',message:'PRIVATE provider'};}});
  const ui=await mount(h(DistributionAskIntent,{projectId:1,api:f.api}));
  try{assert.match(ui.text(),/AI is paused on this account. Contact support/);assert.doesNotMatch(ui.text(),/Add tokens|PRIVATE provider/);}finally{await ui.close();}
});

test('repeated checked events keep source selection unique without requoting the same selection',async()=>{
  const f=apiFor();const ui=await mount(h(DistributionAskIntent,{projectId:1,api:f.api}));
  try{
    const checkbox=ui.all().find(n=>n.tagName==='INPUT'&&props(n).type==='checkbox');
    await act(async()=>{props(checkbox).onChange({target:{checked:true}});props(checkbox).onChange({target:{checked:true}});});await ui.settle();
    assert.equal(f.calls.filter(c=>c[0]==='quote').length,1);
    assert.deepEqual(f.calls[0][1].sources,['validate','research','distribution']);
  }finally{await ui.close();}
});

test('canonical structured targets are preserved in both the quote and run requests',async()=>{
  const f=apiFor();const kinds=[{kind:'ad_creative',placement:'google_search_text',field:'headline',channel_uid:'channel-one'}];
  const ui=await mount(h(DistributionAskIntent,{projectId:1,api:f.api,kinds}));
  try{assert.deepEqual(f.calls[0][1].kinds,kinds);await ui.click('Ask Eadwyn to draft for each channel');assert.deepEqual(f.calls.find(c=>c[0]==='run')[1].kinds,kinds);}finally{await ui.close();}
});


test('an explicit campaign target is quoted and run as campaign text with an honest acceptance boundary',async()=>{
  const f=apiFor([p('ad','ad_creative',{campaign_uid:'campaign-one',target:'campaign',placement:'google_search_text',creative_field:'headline'})]);
  const ui=await mount(h(DistributionAskIntent,{projectId:1,campaignUid:'campaign-one',target:'campaign',kinds:[{kind:'ad_creative',placement:'google_search_text',field:'headline'}],api:f.api}));
  try{
    assert.equal(f.calls[0][1].target,'campaign');
    await ui.click('Ask Eadwyn to draft for each channel');
    assert.equal(f.calls.find(c=>c[0]==='run')[1].target,'campaign');
    assert.match(ui.text(),/Accept keeps the text in this campaign/);
    await ui.click('Accept');
    assert.doesNotMatch(ui.text(),/Not saved|Nothing is saved until you create/);
  }finally{await ui.close();}
});


test('a late draft from the previous campaign never enters the current campaign preview',async()=>{
  let finish;const f=apiFor([],{run:()=>new Promise(resolve=>{finish=resolve;})});
  const ui=await mount(h(DistributionAskIntent,{projectId:1,campaignUid:'first-campaign',api:f.api}));
  try{
    const button=ui.all().find(n=>n.tagName==='BUTTON'&&txt(n)==='Ask Eadwyn to draft for each channel');let pending;
    await act(async()=>{pending=props(button).onClick();});
    await ui.render(h(DistributionAskIntent,{projectId:1,campaignUid:'second-campaign',api:f.api}));
    await act(async()=>{finish({proposals:[p('old','post',{campaign_uid:'first-campaign',text:'Old campaign private draft'})],receipt:{held_microusd:40000,charged_microusd:8000}});await pending;});await ui.settle();
    assert.doesNotMatch(ui.text(),/Old campaign private draft/);
    assert.doesNotMatch(ui.text(),/Charged \$0.008/);
    assert.equal(f.calls.filter(c=>c[0]==='quote').at(-1)[1].campaign_uid,'second-campaign');
  }finally{await ui.close();}
});

test('late form acceptance cannot update the next campaign',async()=>{
  let finish;const accepted=[];const rows=[p('old','post',{campaign_uid:'first-campaign'})];
  const f=apiFor(rows,{decide:()=>new Promise(resolve=>{finish=resolve;})});
  const view=campaignUid=>h(DistributionAskIntent,{projectId:1,campaignUid,api:f.api,onAccept:rows=>accepted.push(...rows)});
  const ui=await mount(view('first-campaign'));
  try{
    await ui.click('Ask Eadwyn to draft for each channel');
    const button=ui.all().find(n=>n.tagName==='BUTTON'&&txt(n)==='Accept');let pending;
    await act(async()=>{pending=props(button).onClick();});await ui.render(view('second-campaign'));
    await act(async()=>{finish({proposal:{...rows[0],status:'accepted'}});await pending;});await ui.settle();
    assert.equal(accepted.length,0);
    assert.doesNotMatch(ui.text(),/Not saved/);
  }finally{await ui.close();}
});

test('late Waiting acceptance cannot notify or alter the next venture or form scope',async()=>{
 for(const next of [{projectId:2,campaignUid:undefined},{projectId:1,campaignUid:null}]){
  let finish;const accepted=[];const old=p('old','post',{campaign_uid:'saved-campaign'});
  const f=apiFor([],{proposals:async project=>({proposals:project===1?[old]:[]}),decide:()=>new Promise(resolve=>{finish=resolve;})});
  const view=scope=>h(WaitingForYou,{...scope,api:f.api,onAccept:rows=>accepted.push(...rows)});
  const ui=await mount(view({projectId:1,campaignUid:undefined}));
  try{
    const button=ui.all().find(n=>n.tagName==='BUTTON'&&txt(n)==='Accept');let pending;
    await act(async()=>{pending=props(button).onClick();});await ui.render(view(next));
    await act(async()=>{finish({proposal:{...old,status:'accepted'}});await pending;});await ui.settle();
    assert.equal(accepted.length,0);
    assert.match(ui.text(),/Nothing waits for you\./);
  }finally{await ui.close();}
 }
});
