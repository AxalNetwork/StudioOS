import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountForm, propsOf, textOf } from './_form_d695.mjs';
import RaisePipelinePage from '../src/pages/RaisePipelinePage.jsx';
import { api } from '../src/lib/api.js';

async function mounted() {
  const old = new Map(); const calls = [];
  const replace = (key,value) => { old.set(key,api[key]);api[key]=value; };
  replace('listProjects', async()=>[{id:1,name:'First venture'},{id:2,name:'Chosen venture'}]);
  replace('raiseProspects',async id=>{calls.push(['read',id]);return {items:[{id:7,name:'Synthetic investor',stage:'meeting',amount:null}],stages:['meeting','committed']};});
  replace('raiseRound',async()=>({round:null,raised:0,committed_count:0}));
  replace('raiseUpdates',async()=>({items:[],shared_updates:[]}));
  replace('raiseProspectCreate',async body=>{calls.push(['add',body]);return {id:8,...body};});
  replace('raiseProspectsImport',async body=>{calls.push(['import',body]);return {created:body.rows.length,skipped:[]};});
  replace('raiseProspectUpdate',async(id,body)=>{calls.push(['update',id,body]);return {id,...body};});
  const ui=await mountForm(React.createElement(RaisePipelinePage));await ui.flush();
  const change=async(node,value)=>act(async()=>propsOf(node).onChange({target:{value}}));
  const button=label=>ui.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n).trim()===label);
  return {ui,calls,change,button,async choose(){await change(ui.nodes().find(n=>propsOf(n)['aria-label']==='Venture'),'2');await ui.flush();},async close(){await ui.unmount();for(const [key,value]of old)api[key]=value;}};
}
test('pipeline waits for a venture; adding and importing use the chosen venture',async()=>{
  const m=await mounted();const originalReader=globalThis.FileReader;
  try {
    assert.equal(propsOf(m.button('Add investor')).disabled,true);assert.equal(propsOf(m.button('Import CSV')).disabled,true);assert.equal(m.calls.length,0);
    await m.choose();assert.deepEqual(m.calls,[['read',2]]);
    await m.ui.click('Add investor');
    const name=m.ui.nodes().find(n=>n.tagName==='INPUT'&&propsOf(n).placeholder==='Jane Doe');
    await m.change(name,'Synthetic investor');
    const saves=m.ui.nodes().filter(n=>n.tagName==='BUTTON'&&textOf(n).trim()==='Add investor');
    await act(async()=>propsOf(saves.at(-1)).onClick());
    assert.equal(m.calls.find(c=>c[0]==='add')[1].project_id,2);
    await m.ui.click('Import CSV');
    globalThis.FileReader=class {readAsText(){this.result='name,email\nSynthetic,synthetic@example.invalid';this.onload();}};
    const file=m.ui.nodes().find(n=>n.tagName==='INPUT'&&propsOf(n).type==='file');
    await act(async()=>propsOf(file).onChange({target:{files:[{name:'synthetic.csv'}]}}));
    const importButton=m.ui.nodes().find(n=>n.tagName==='BUTTON'&&textOf(n).trim()==='Import');
    assert.ok(importButton);await act(async()=>propsOf(importButton).onClick());
    assert.equal(m.calls.find(c=>c[0]==='import')[1].project_id,2);
  }finally{globalThis.FileReader=originalReader;await m.close();}
});
test('moving to Committed asks for status before writing and unknown amount is named',async()=>{
  const m=await mounted();try {
    await m.choose();assert.match(m.ui.text(),/Amount not recorded/);
    const target=m.ui.nodes().find(n=>typeof propsOf(n).onDrop==='function'&&textOf(n).includes('Committed'));
    assert.ok(target);await act(async()=>propsOf(target).onDrop({preventDefault(){},dataTransfer:{getData:()=> '7'}}));
    assert.equal(m.calls.filter(c=>c[0]==='update').length,0);assert.match(m.ui.text(),/Record the commitment status/);
    await m.ui.click('soft');assert.deepEqual(m.calls.find(c=>c[0]==='update'),['update',7,{stage:'committed',commit_status:'soft'}]);
  }finally{await m.close();}
});

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
