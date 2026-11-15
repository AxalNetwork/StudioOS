/** #6315: mounted acceptance links and undo success/refusal preserve the recorded destination. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import GrowProposalDestinations from '../src/pages/cycles/GrowProposalDestinations.jsx';

test('destination survives a refused undo, then disappears after success and refreshes its source',async()=>{
 let rows=[{uid:'receipt',href:'/grow/product-improvement/feedback-a?project_id=7',label:'Product improvement feedback',created_record:true}],refuse=true,changed=0;
 const calls=[];
 const api={receipts:async(project,source)=>{calls.push(['read',project,source]);return{receipts:rows};},undo:async(project,uid)=>{calls.push(['undo',project,uid]);if(refuse)throw{data:{detail:'This destination changed after acceptance.'}};rows=[];}};
 const ui=await mountContracts(React.createElement(GrowProposalDestinations,{projectId:7,source:'posthog',revision:1,api,onChanged:()=>changed++}),'/grow/product-improvement?project_id=7');
 try{
  await ui.flush();assert.match(ui.text(),/Accepted into Product improvement feedback/);
  const link=ui.nodes().find(n=>n.tagName==='A');assert.equal(ui.props(link).href,'/grow/product-improvement/feedback-a?project_id=7');
  await ui.click('Undo');await ui.flush();assert.match(ui.text(),/This destination changed/);assert.match(ui.text(),/Accepted into/);assert.equal(changed,0);
  refuse=false;await ui.click('Undo');await ui.flush();assert.doesNotMatch(ui.text(),/Accepted into/);assert.equal(changed,1);
  assert.deepEqual(calls.filter(c=>c[0]==='undo'),[['undo',7,'receipt'],['undo',7,'receipt']]);
 }finally{await ui.unmount();}
});

test('Mercury acceptance confirms the destination, then exposes the persistent link and undo',async()=>{
 const {default:GrowFromMercury}=await import('../src/pages/cycles/GrowFromMercury.jsx');
 const {cyclesWrite}=await import('../src/lib/api/cycles.js');
 const {growProposalsApi}=await import('../src/lib/api/growProposals.js');
 const saved={accept:cyclesWrite.grow.acceptMercuryPartner,...growProposalsApi};let rows=[],accepts=0,undos=0;
 cyclesWrite.grow.acceptMercuryPartner=async()=>{accepts++;rows=[{uid:'receipt',href:'/grow/partner-network/partner-a?project_id=7',label:'Partner network',created_record:true}];return{ok:true};};
 growProposalsApi.receipts=async()=>({receipts:rows});growProposalsApi.undo=async(project,uid)=>{assert.equal(project,7);assert.equal(uid,'receipt');undos++;rows=[];};
 const part={state:'ok',can_decide:true,proposals:[{id:9,state:'pending',partner_company:'Fixture partner'}]};
 let ui;try{
  ui=await mountContracts(React.createElement(GrowFromMercury,{slug:'partner-network',part,projectId:7,reload(){}}),'/grow/partner-network?project_id=7');
  await ui.flush();await ui.click('Accept');await ui.flush();assert.equal(accepts,0);assert.match(ui.text(),/Accept creates a partner named Fixture partner in Partner network/);
  await ui.click('Add the partner');await ui.flush();assert.equal(accepts,1);assert.match(ui.text(),/Accepted into Partner network/);
  const link=ui.nodes().find(n=>n.tagName==='A'&&ui.props(n).href?.includes('/partner-a?'));assert.ok(link);
  await ui.click('Undo');await ui.flush();assert.equal(undos,1);assert.doesNotMatch(ui.text(),/Accepted into Partner network/);
 }finally{await ui?.unmount();cyclesWrite.grow.acceptMercuryPartner=saved.accept;growProposalsApi.receipts=saved.receipts;growProposalsApi.undo=saved.undo;}
});
