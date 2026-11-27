// D4449: bounded call-output polling and visible retry, through the mounted review.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { ReviewStep } from '../src/pages/founder/InterviewSessionPage.jsx';
const h=React.createElement;

test('#4449: an abandoned output stops polling after its deadline and offers Try again',async()=>{
 const savedTimeout=globalThis.setTimeout,savedClear=globalThis.clearTimeout,savedNow=Date.now;
 let now=0,seq=0;const timers=new Map();Date.now=()=>now;
 globalThis.setTimeout=(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 let reads=0;const retried=[];
 const api={placements:async()=>{reads++;return {placements:[],runs:[],outputs:[{output:'pain-points',label:'Pain points',status:'running'}]};},retryOutput:async(...args)=>retried.push(args)};
 let m;
 try{
  m=await mountContracts(h(ReviewStep,{api,sessionId:5,receiptItems:[]}));
  assert.equal(reads,1);assert.equal(timers.size,1);assert.doesNotMatch(m.text(),/Try again/);
  now=16*60*1000;
  await act(async()=>{const [id,timer]=[...timers][0];timers.delete(id);await timer.fn();});
  // One final read arms the zero-delay deadline timer when time advanced past it.
  if(timers.size)await act(async()=>{const [id,timer]=[...timers][0];timers.delete(id);await timer.fn();});
  assert.equal(timers.size,0);assert.match(m.text(),/Try again/);
  await m.click('Try again');assert.deepEqual(retried,[[5,'pain-points']]);
 }finally{if(m)await m.unmount();globalThis.setTimeout=savedTimeout;globalThis.clearTimeout=savedClear;Date.now=savedNow;}
});

test('#4449: a stored stale status offers retry immediately; empty says No new proposals',async()=>{
 const m=await mountContracts(h(ReviewStep,{sessionId:5,receiptItems:[],api:{placements:async()=>({placements:[],runs:[],outputs:[
  {output:'pain-points',label:'Pain points',status:'queued',retryable:true},{output:'icp-fit',label:'ICP fit',status:'empty'},
 ]})}}));
 try{assert.match(m.text(),/Try again/);assert.match(m.text(),/No new proposals/);assert.doesNotMatch(m.text(),/Proposals ready/);}finally{await m.unmount();}
});
