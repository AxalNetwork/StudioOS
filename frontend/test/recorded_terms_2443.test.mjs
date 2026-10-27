import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountForm, propsOf, textOf } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';

// D1194 (#3128): the old pipeline page (RaisePipelinePage) is retired. Its venture-gated add and
// import, and Committed's status ask, are Capital relationships › Pipeline's, tested in
// caprel_pipeline_d1192.test.mjs.

test('deck NDA records acceptance without an access promise and never supplies invented deal terms',async()=>{
  const {default: Modal}=await import('../src/components/ShareViewerSignupModal.jsx');
  const old=new Map();const calls=[];
  const replace=(key,value)=>{old.set(key,api[key]);api[key]=value;};
  replace('deckShareSignup',async()=>({id:1,email:'synthetic@example.invalid',name:'Synthetic viewer'}));
  replace('deckShareNda',async()=>({document_id:1,data_room_access_granted:false}));
  replace('deckShareDealPack',async(_token,body)=>{calls.push(body);throw Object.assign(new Error('Missing deal terms'),{data:{missing_fields:['check_size','valuation_cap','discount']}});});
  const ui=await mountForm(React.createElement(Modal,{category:'fundraising',shareToken:'synthetic',projectName:'Synthetic venture',onClose(){}}));
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];const nodes=()=>walk(ui.body);
  try {
    const form=nodes().find(n=>n.tagName==='FORM');assert.ok(form);
    await act(async()=>propsOf(form).onSubmit({preventDefault(){}}));
    assert.match(textOf(ui.body),/does not grant data-room access/);
    const accept=nodes().find(n=>n.tagName==='BUTTON'&&textOf(n).trim()==='I agree — record acceptance');assert.ok(accept);
    await act(async()=>propsOf(accept).onClick());
    assert.deepEqual(calls,[{view_id:undefined,check_size:'',valuation_cap:'',discount:''}]);
    assert.match(textOf(ui.body),/NDA acceptance recorded.*does not grant data-room access/);
    assert.match(textOf(ui.body),/Terms not recorded: check_size, valuation_cap, discount/);
    assert.doesNotMatch(textOf(ui.body),/Generating documents|Sign all and notify/);
  }finally{await ui.unmount();for(const[key,value]of old)api[key]=value;}
});

test('deal-pack reconciliation stays open until every requested e-signature is completed',async()=>{
  const {default: Modal}=await import('../src/components/ShareViewerSignupModal.jsx');
  const old=new Map();let signed=[];
  const replace=(key,value)=>{old.set(key,api[key]);api[key]=value;};
  replace('deckShareSignup',async()=>({id:1,email:'synthetic@example.invalid',name:'Synthetic viewer'}));
  replace('deckShareNda',async()=>({document_id:1,data_room_access_granted:false}));
  replace('deckShareDealPack',async()=>({documents:[{id:1,title:'Synthetic SAFE',content:'Synthetic terms'},{id:2,title:'Synthetic sheet',content:'Synthetic terms'}]}));
  replace('deckShareSignDealPack',async()=>({signed_ids:signed}));
  const ui=await mountForm(React.createElement(Modal,{category:'fundraising',shareToken:'synthetic',projectName:'Synthetic venture',onClose(){}}));
  const walk=n=>[n,...(n.childNodes||[]).flatMap(walk)];const nodes=()=>walk(ui.body);
  const click=async label=>{const node=nodes().find(n=>n.tagName==='BUTTON'&&textOf(n).trim()===label);assert.ok(node,label);await act(async()=>propsOf(node).onClick());};
  try {
    await act(async()=>propsOf(nodes().find(n=>n.tagName==='FORM')).onSubmit({preventDefault(){}}));
    await click('I agree — record acceptance');
    for(const partial of [[],[1]]){
      signed=partial;await click('Record completed e-signatures');
      assert.match(textOf(ui.body),/require completed e-sign envelopes/);assert.doesNotMatch(textOf(ui.body),/Thank you/);
    }
    signed=[1,2];await click('Record completed e-signatures');assert.match(textOf(ui.body),/Thank you.*Completed signatures are recorded/);
  }finally{await ui.unmount();for(const[key,value]of old)api[key]=value;}
});


