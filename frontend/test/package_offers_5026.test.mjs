/** #5026: exact review/decision, conflict refusal and lost-response replay through real mounted HQ controls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act, useState } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { mutationCheck } from './_form_d695.mjs';
import { LicencePackageOffers } from '../src/pages/admin/licences/LicencePackageOffers.jsx';
import { money, reviewedPrice, validReason, canAccept, operation, loadPending } from '../src/pages/admin/licences/packageOfferModel.js';
const h=React.createElement;
const offer={uid:'offer-a',package_name:'Synthetic Learning',package_version:2,package_key:'talent_learning',currency:'JPY',recommended_annual_fee_cents:1200,state:'offered',revision:7,programs:[{program_key:'learning',terms:{capacity_cap:0}}],starts_on:'2027-01-01',ends_on:'2027-12-31'}; // Immutable synthetic contract dates
const reviewed={offer,review_hash:'frozen-review-a',price:{accepted_annual_fee_cents:1200},conflicts:[],legal:{strategy:'per_program',legal_gate:'required_before_in_force',policy_version:3},grants:[{program_key:'learning',action:'created',terms:{capacity_cap:0}}],branch_sync:'Delivery reported separately.',accepted_program_allocation:'Not recorded; the package has its own price.'};
const fake=(extra={})=>({list:async()=>({items:[offer]}),pricing:async()=>({packages:[]}),review:async()=>reviewed,accept:async()=>({}),history:async()=>({items:[]}),...extra});
const storage=()=>{const map=new Map();return{getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
async function mount(api,store=storage()){const m=await mountContracts(h(LicencePackageOffers,{licenceUid:'licence-a',actorId:42,api,storage:store}),'/admin/licences/licence-a/packages/offers',{id:42,role:'admin',is_super_admin:1});await m.flush();await m.flush();return m;}
const textOf = n => n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '';
const fill = (m,label,value) => m.fill(label,value);
async function open(m){await m.click('Review Synthetic Learning offer');await m.click('Read consequences');}
test('money, zero and exact-price override use the currency’s native units; conflicts and missing review hashes cannot be accepted',()=>{
 assert.equal(money(null,'JPY'),'Not recorded');assert.match(money(0,'JPY'),/0/);assert.match(money(1200,'JPY'),/1,200/);
 assert.deepEqual(reviewedPrice(offer,'1200',''),{accepted_annual_fee_cents:1200,override_reason:null});
 assert.equal(reviewedPrice(offer,'12.25','Valid reason here'),null);assert.equal(reviewedPrice(offer,'0','short'),null);
 assert.equal(reviewedPrice(offer,'0','Approved no charge').accepted_annual_fee_cents,0);
 assert.equal(validReason('x'.repeat(501)),false);assert.equal(canAccept({...reviewed,conflicts:[{}]}),false);assert.equal(canAccept({...reviewed,review_hash:''}),false);
 assert.equal(operation('accept',offer,{...reviewed,conflicts:[{}]},null,'Reason recorded here'),null);
});
test('review is read-only, accepting requires the second step and the exact review hash/revision/price/reason',async()=>{
 const calls=[];const api=fake({review:async(...a)=>{calls.push(['review',...a]);return reviewed;},accept:async(...a)=>{calls.push(['accept',...a]);return{};}});const m=await mount(api);
 try{assert.equal(calls.length,0);await open(m);assert.equal(calls.filter(c=>c[0]==='accept').length,0);assert.match(m.text(),/No conflicts in this review/);assert.match(m.text(),/People at once0/);
 await m.click('Continue to acceptance');await fill(m,'Reason (10','Approved for this licence');await m.click('Accept offer');assert.equal(calls.filter(c=>c[0]==='accept').length,1);
 const body=calls.find(c=>c[0]==='accept')[3];assert.equal(body.review_hash,'frozen-review-a');assert.equal(body.expected_revision,7);assert.equal(body.accepted_annual_fee_cents,1200);assert.equal(body.reason,'Approved for this licence');assert.ok(body.idempotency_key);assert.match(m.text(),/Decision recorded/);
 }finally{await m.unmount();}
});
test('changing price invalidates the review; a server conflict disables continuing to acceptance',async()=>{
 const m=await mount(fake({review:async()=>({...reviewed,conflicts:[{program_key:'learning',message:'Resolve explicit grant first'}]})}));
 try{await open(m);assert.match(m.text(),/Resolve explicit grant first/);assert.ok(m.props(m.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n)==='Continue to acceptance')).disabled);
 await fill(m,'Accepted annual price','1300');assert.doesNotMatch(m.text(),/Resolve explicit grant first/);assert.ok(m.props(m.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n)==='Read consequences')).disabled);
 await fill(m,'Price override reason','Approved pricing exception');await m.click('Read consequences');assert.match(m.text(),/Resolve explicit grant first/);
 }finally{await m.unmount();}
});
test('a lost acceptance response retains exactly one operation across unmount/reload and retries identical bytes/key',async()=>{
 const calls=[];const store=storage();let fail=true;const api=fake({accept:async(...a)=>{calls.push(a);if(fail)throw new Error('private raw network exception');return{};}});let m=await mount(api,store);
 try{await open(m);await m.click('Continue to acceptance');await fill(m,'Reason (10','Approved for this licence');await m.click('Accept offer');assert.match(m.text(),/Outcome unknown/);assert.doesNotMatch(m.text(),/private raw/);assert.equal(store.map.size,1);}finally{await m.unmount();}
 fail=false;m=await mount(api,store);try{await m.click('Retry the same operation');assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0]);assert.equal(store.map.size,0);}finally{await m.unmount();}
});
test('late reads cannot cross licence identity, no package does not mean no grants, and unreadable is never empty',async()=>{
 let release;const api=fake({list:id=>id==='licence-a'?new Promise(r=>release=r):Promise.resolve({items:[]})});let change;
 function Host(){const[id,set]=useState('licence-a');change=set;return h(LicencePackageOffers,{licenceUid:id,actorId:42,api,storage:storage()});}
 const m=await mountContracts(h(Host),'/admin/licences/licence-a/packages/offers');try{await act(async()=>change('licence-b'));await m.flush();await act(async()=>release({items:[offer]}));assert.doesNotMatch(m.text(),/Synthetic Learning/);assert.match(m.text(),/no package does not mean no programs/);}finally{await m.unmount();}
 const e=await mount(fake({list:async()=>{throw Error('private');}}));try{assert.match(e.text(),/Unreadable/);assert.doesNotMatch(e.text(),/No accepted Axal/);}finally{await e.unmount();}
});
test('new decision guards are mutation-checked both ways, including override zero, conflicts, hash and reason',async()=>{
 const path='pages/admin/licences/packageOfferModel.js',src=readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
 await mutationCheck(src,path,m=>{
  assert.equal(m.canAccept({...reviewed,conflicts:[{}]}),false);
  assert.equal(m.canAccept({...reviewed,review_hash:''}),false);
  assert.equal(m.validReason('short'),false);
  assert.equal(m.reviewedPrice(offer,'0','short'),null);
 },[
  ['review.conflicts.length === 0','review.conflicts.length >= 0'],
  ['!!review?.review_hash','true'],
  ['text.trim().length >= 10','text.trim().length >= 0'],
  ['p.minor !== offer.recommended_annual_fee_cents && !validReason(reason)','false']
 ]);
 assert.equal(loadPending({getItem:()=>'{broken'},'key'),null);
});
