import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { ConnectorPanel } from '../src/pages/account/ConnectorSheet.jsx';
import { connectorsApi } from '../src/lib/api/connectors.js';
import { mountContracts } from './_contracts_dom.mjs';
const provider=(key)=>({key,display_name:key,auth_type:'api_key',available:true,has_implementation:true,status:'live',feeds:[],capabilities:[],connection:null});
const byId=(ui,id)=>ui.nodes().find(n=>ui.props(n)?.id===id);
async function submit(ui){await act(async()=>ui.props(byId(ui,'connector-key-form')).onSubmit({preventDefault(){}}));}

test('D881: Mercury\'s key form asks for no Read Only confirmation, sends none, and still hides webhook and settings',async()=>{
  const calls=[]; const original=connectorsApi.connect; connectorsApi.connect=async b=>{calls.push(b);return {};};
  const ui=await mountContracts(h(ConnectorPanel,{p:provider('mercury'),view:'key',setView(){}}));
  try {
    assert.doesNotMatch(ui.text(),/This is a Read Only token|never Read and Write/);
    assert.equal(ui.nodes().find(n=>ui.props(n)?.type==='checkbox'),undefined);
    // D715 PR 3: Mercury draws no Advanced toggle, so no webhook or settings field at all.
    assert.doesNotMatch(ui.text(),/Advanced/); assert.equal(byId(ui,'connector-webhook'),undefined); assert.equal(byId(ui,'connector-config'),undefined);
    await act(async()=>{ ui.props(byId(ui,'connector-key')).onChange({target:{value:'test-placeholder'}}); });
    await submit(ui);
    // The Worker refuses it (`token_connect_retired`); the form never adds a confirmation of its own.
    assert.equal(calls.length,1); assert.equal(calls[0].config,undefined); assert.equal(calls[0].webhook_secret,undefined);
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
