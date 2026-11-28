/** D6637: mounted names-only consent picker regressions.
 *
 * From frontend/test/README.md (moved by #6472): D6637: mounted picker selection, eligibility and
 * submission.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {installDocument} from './_contracts_dom.mjs';
import Picker from '../src/pages/relationships/NetworkIntroOffer.jsx';
import {networkIntroOffersApi} from '../src/lib/api/networkIntroOffers.js';

const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];
const props=n=>Object.entries(n||{}).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};
const text=n=>n?.childNodes?.length?n.childNodes.map(text).join(''):n?.textContent||'';
test('eligible names drive the real picker; missing or invalid selections cannot submit',async()=>{
 const restore=installDocument('',{focus:true});const oldMedia=globalThis.matchMedia;
 globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 document.querySelectorAll=()=>[];
 const create=document.createElement.bind(document);document.createElement=tag=>{const n=create(tag);n.querySelector=()=>null;n.querySelectorAll=()=>[];n.offsetParent={};return n;};
 const oldRead=networkIntroOffersApi.people;const calls=[];networkIntroOffersApi.people=async()=>({people:[{id:2,name:'Alex Sample'},{id:3,name:'Bea Sample'}],next_cursor:null});
 const oldWrite=networkIntroOffersApi.offer;networkIntroOffersApi.offer=async(...pair)=>{calls.push(pair);};
 const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);let sent=0;
 const find=fn=>walk(box).find(n=>fn(props(n),n));
 try{
  await act(async()=>{root.render(React.createElement(Picker,{onClose(){},onOffered:()=>sent++}));});
  assert.match(text(box),/Alex Sample/);assert.match(text(box),/Bea Sample/);
  assert.equal(walk(box).filter(n=>n.tagName==='INPUT').length,0,'no free email or identifier field');
  const submit=()=>find(p=>p.type==='submit');assert.equal(props(submit()).disabled,true);
  await act(async()=>props(find(p=>p['aria-label']==='First person')).onChange({target:{value:'2'}}));
  assert.equal(props(submit()).disabled,true);
  assert.ok(!walk(find(p=>p['aria-label']==='Second person')).some(n=>props(n).value===2),'first choice excluded');
  await act(async()=>props(find(p=>p['aria-label']==='Second person')).onChange({target:{value:'2'}}));
  assert.equal(props(submit()).disabled,true,'same-person tampering refused');
  await act(async()=>props(find(p=>p['aria-label']==='Second person')).onChange({target:{value:'3'}}));
  assert.equal(props(submit()).disabled,false);
  await act(async()=>{await props(find(p=>typeof p.onSubmit==='function')).onSubmit({preventDefault(){}});});
  assert.deepEqual(calls,[[2,3]]);
  assert.equal(sent,1);
  networkIntroOffersApi.people=async()=>{throw new Error('synthetic unavailable');};
  await act(async()=>root.render(React.createElement(Picker,{key:'unreadable',onClose(){}})));
  assert.match(text(box),/could not be read/);assert.equal(props(submit()).disabled,true);
  assert.doesNotMatch(text(box),/No eligible shared people|You need two accepted ties/,'failed read is never empty');
  networkIntroOffersApi.people=async()=>({people:[{id:2,name:'Recovered person'}],next_cursor:null});
  await act(async()=>props(find((p,n)=>p.type==='button'&&text(n)==='Try again')).onClick());
  assert.match(text(box),/Recovered person/);assert.doesNotMatch(text(box),/could not be read/);

 }finally{await act(async()=>root.unmount());networkIntroOffersApi.people=oldRead;networkIntroOffersApi.offer=oldWrite; globalThis.matchMedia=oldMedia;restore();}
});

test('the actual investor zone toolbar opens the picker on an empty desk',async()=>{
 const restore=installDocument('',{focus:true});const oldMedia=globalThis.matchMedia;const oldFetch=globalThis.fetch;
 globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});document.querySelectorAll=()=>[];
 const create=document.createElement.bind(document);document.createElement=tag=>{const n=create(tag);n.querySelector=()=>null;n.querySelectorAll=()=>[];n.offsetParent={};return n;};
 const {api}=await import('../src/lib/api.js');const original={...api};const oldRead=networkIntroOffersApi.people;
 networkIntroOffersApi.people=async()=>({people:[],next_cursor:null});
 const me={id:1,role:'investor',name:'Synthetic member',email:'member@example.test'};
 localStorage.setItem('user',JSON.stringify(me));globalThis.fetch=async()=>new Response(JSON.stringify(me));
 api.partnerRelationships=async()=>[];api.partnerSummary=async()=>({});api.introPropositions=async()=>({propositions:[]});api.listIntroductions=async()=>({introductions:[]});api.partnerReminders=async()=>({items:[]});api.introQuota=async()=>({});
 const {MemoryRouter}=await import('react-router-dom');const {AuthProvider}=await import('../src/hooks/useAuthSync.jsx');const {default:Workspace}=await import('../src/pages/investor/InvestorNetworkWorkspace.jsx');
 const box=document.createElement('div');document.body.appendChild(box);const root=createRoot(box);
 try{
  await act(async()=>{root.render(React.createElement(MemoryRouter,{initialEntries:['/network/introductions']},React.createElement(AuthProvider,null,React.createElement(Workspace,{embedded:true,zone:'introductions'}))));});
  const button=walk(box).find(n=>n.tagName==='BUTTON'&&text(n).trim()==='Offer one');assert.ok(button,'visible on actual mounted route');assert.doesNotMatch(props(button).title||'',/#\d+/);
  await act(async()=>props(button).onClick());
  assert.ok(walk(box).some(n=>props(n)['data-testid']==='network-intro-offer'),'opens the names-only picker');
 }finally{await act(async()=>root.unmount());Object.assign(api,original);networkIntroOffersApi.people=oldRead;globalThis.matchMedia=oldMedia;globalThis.fetch=oldFetch;restore();}
});
