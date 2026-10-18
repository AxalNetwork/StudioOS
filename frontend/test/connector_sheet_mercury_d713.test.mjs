import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { ConnectorPanel } from '../src/pages/account/ConnectorSheet.jsx';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { mountContracts } from './_contracts_dom.mjs';
const provider=(key)=>({key,display_name:key,auth_type:'api_key',available:true,has_implementation:true,status:'live',feeds:[],capabilities:[],connection:null});
const byId=(ui,id)=>ui.nodes().find(n=>ui.props(n)?.id===id);
async function submit(ui){await act(async()=>ui.props(byId(ui,'connector-key-form')).onSubmit({preventDefault(){}}));}

test('Mercury key form requires explicit Read Only confirmation, sends it, and hides webhook even in Advanced',async()=>{
  const calls=[]; const original=connectorsApi.connect; connectorsApi.connect=async b=>{calls.push(b);return {};};
  const ui=await mountContracts(h(ConnectorPanel,{p:provider('mercury'),view:'key',setView(){}}));
  try {
    assert.match(ui.text(),/Read Only.*own Mercury organization, never Read and Write/);
    assert.match(ui.text(),/This is a Read Only token/);
    const checkbox=()=>ui.nodes().find(n=>ui.props(n)?.type==='checkbox');
    assert.equal(ui.props(checkbox()).required,true);
    await submit(ui); assert.equal(calls.length,0); assert.match(ui.text(),/Confirm this is a Read Only token/);
    await ui.click('Advanced'); assert.equal(byId(ui,'connector-webhook'),undefined);
    await act(async()=>{
      ui.props(byId(ui,'connector-key')).onChange({target:{value:'test-placeholder'}});
      ui.props(byId(ui,'connector-config')).onChange({target:{value:'{"confirm_read_only":false}'}});
      ui.props(checkbox()).onChange({target:{checked:true}});
    });
    await submit(ui);
    assert.equal(calls.length,1); assert.equal(calls[0].config.confirm_read_only,true); assert.equal(calls[0].webhook_secret,undefined);
  } finally {await ui.unmount();connectorsApi.connect=original;}
});
test('other key providers retain webhook settings and need no Mercury confirmation',async()=>{
  const calls=[];const original=connectorsApi.connect;connectorsApi.connect=async b=>calls.push(b);
  const ui=await mountContracts(h(ConnectorPanel,{p:provider('crunchbase'),view:'key',setView(){}}));
  try {
    assert.doesNotMatch(ui.text(),/This is a Read Only token/);
    await ui.click('Advanced'); assert.ok(byId(ui,'connector-webhook'));
    await act(async()=>ui.props(byId(ui,'connector-webhook')).onChange({target:{value:'test-hook'}}));
    await submit(ui); assert.equal(calls.length,1); assert.equal(calls[0].webhook_secret,'test-hook'); assert.equal(calls[0].config,undefined);
  } finally {await ui.unmount();connectorsApi.connect=original;}
});
