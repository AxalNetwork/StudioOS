// D4423: HQ cohort controls prepare membership without changing rollout flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import CohortCard from '../src/pages/hq/aiAgents/CohortCard.jsx';
const h=React.createElement;

test('HQ adds a founder by email, lists names only, and removes the entry',async()=>{
 const calls=[];let entries=[];
 const api={cohort:async()=>({entries}),addCohort:async(email)=>{calls.push(['add',email]);entries=[{uid:'c1',kind:'user',name:'Synthetic Founder'}];},removeCohort:async(uid)=>{calls.push(['remove',uid]);entries=[];}};
 const m=await mountContracts(h(CohortCard,{api}));
 try{
  assert.match(m.text(),/No cohort members yet/);
  assert.match(m.text(),/Membership does not switch agents on/);
  await m.fill('Founder email','founder@example.test');
  const form=m.nodes().find((n)=>n.tagName==='FORM');await act(async()=>m.props(form).onSubmit({preventDefault(){}}));
  assert.match(m.text(),/Synthetic Founder/);assert.doesNotMatch(m.text(),/@example/);
  await m.click('Remove');assert.match(m.text(),/No cohort members yet/);
  assert.deepEqual(calls,[['add','founder@example.test'],['remove','c1']]);
 }finally{await m.unmount();}
});
test('an unreadable cohort never reads as an empty list',async()=>{
 const m=await mountContracts(h(CohortCard,{api:{cohort:async()=>{throw new Error('offline');}}}));
 try{assert.match(m.text(),/cohort could not be read/);assert.doesNotMatch(m.text(),/No cohort members/);}finally{await m.unmount();}
});
