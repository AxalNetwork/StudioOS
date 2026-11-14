// D6024: confirmed record removal returns to the list, and removed plan targets have no stale link.
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { fixture } from './_record_d696.mjs';
import { useCycleRecord } from '../src/pages/cycles/CycleRoute.jsx';
import { DoneRow } from '../src/pages/cycles/BuildPlanCards.jsx';
import { landedHref, opensRecord } from '../src/pages/cycles/buildPlanModel.js';

const h=React.createElement;
const declarations=[
  { slug:'solution-design',key:'delete',label:'Remove feature',confirm:{ title:'Remove this feature?',body:'This permanently removes the feature.',cta:'Remove feature' } },
  { slug:'prototype-mvp',key:'unmark-must-have',label:'No longer a must-have',confirm:{ title:'No longer a must-have?',body:'Keep the feature in Solution design.',cta:'Remove from must-haves' } },
];
async function mount(declaration,{refused=false}={}) {
  const restore=installDocument(),previous={fetch:globalThis.fetch,matchMedia:globalThis.matchMedia};
  const calls=[],out={};let changed=false,fail=refused;
  const action={...declaration,kind:'write',tone:'danger'};
  globalThis.matchMedia=()=>({ matches:false,addEventListener(){},removeEventListener(){} });
  globalThis.fetch=async (url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    const status=options.method==='POST'?(fail?409:200):(changed?404:200);
    if(options.method==='POST'&&!fail)changed=true;
    const data=options.method==='POST'?(fail?{detail:'This feature is linked to 1 roadmap item.'}:{ok:true})
      :changed?{detail:'Record not found.'}:{...fixture(),id:'7',module:declaration.slug,actions:[action]};
    return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  };
  const create=document.createElement.bind(document);
  document.createElement=tag=>{const node=create(tag);node.querySelector=()=>null;node.querySelectorAll=()=>[];node.focus=()=>{};node.children=[];return node;};
  document.body.style={overflow:'auto',paddingRight:''};
  const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
  function Probe(){
    const navigate=useNavigate();out.location=useLocation();
    out.record=useCycleRecord({enabled:true,cycle:'build',projectId:1,slug:declaration.slug,id:'7',reload:0,navigate,back:`/build/${declaration.slug}?project_id=1`});
    return h(React.Fragment,null,out.record.confirm,out.record.actionError?h('p',{role:'alert'},out.record.actionError):null);
  }
  const text=node=>node?.nodeType===3?node.textContent:node?.childNodes?.length?node.childNodes.map(text).join(''):node?.textContent||'';
  const nodes=()=>{const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];return walk(container);};
  const props=node=>Object.entries(node).find(([key])=>key.startsWith('__reactProps$'))?.[1];
  await act(async()=>root.render(h(MemoryRouter,{initialEntries:[`/build/${declaration.slug}/7?project_id=1`]},h(Routes,null,
    h(Route,{path:'/build/:slug/:id',element:h(Probe)}),h(Route,{path:'/build/:slug',element:h('p',null,'Module list')})
  ))));
  return {out,calls,text:()=>text(container),allow:()=>{fail=false;},
    write:()=>act(async()=>out.record.write(action)),
    click:label=>act(async()=>{const node=nodes().find(node=>node.tagName==='BUTTON'&&text(node)===label);assert.ok(node,label);props(node).onClick({preventDefault(){}});}),
    settle:()=>act(async()=>{}),
    close:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous);restore();}};
}

for(const declaration of declarations)test(`${declaration.label} confirms in the page; cancel sends nothing; success re-reads then returns to its module`,async()=>{
  const view=await mount(declaration);try{
    assert.equal(view.out.record.status,'ready');
    await view.write();assert.ok(view.text().includes(declaration.confirm.title));assert.ok(view.text().includes(declaration.confirm.body));
    await view.click('Cancel');assert.equal(view.calls.filter(call=>call.method==='POST').length,0);
    await view.write();await view.click(declaration.confirm.cta);await view.settle();
    assert.equal(view.calls.filter(call=>call.method==='POST').length,1);
    assert.ok(view.calls.find(call=>call.method==='POST').url.includes(`/actions/${declaration.key}?project=1`));
    assert.equal(view.calls.filter(call=>call.method==='GET').length,2,'successful write re-reads the vanished record');
    assert.ok(view.text().includes('Module list'));
  }finally{await view.close();}
});

test('a linked-feature refusal stays visible on the record and can be retried after the links change',async()=>{
  const declaration=declarations[0],view=await mount(declaration,{refused:true});try{
    await view.write();await view.click(declaration.confirm.cta);await view.settle();
    assert.ok(view.text().includes('This feature is linked to 1 roadmap item.'));assert.equal(view.out.record.status,'ready');
    assert.equal(view.out.location.pathname,'/build/solution-design/7');
    view.allow();await view.write();await view.click(declaration.confirm.cta);await view.settle();
    assert.ok(view.text().includes('Module list'));
  }finally{await view.close();}
});

test('accepted plan history shows removed and demoted features without an Open link, including read-only views',()=>{
  const item={uid:'feature',kind:'must-have',status:'accepted',payload:{title:'Original proposal'},landed_table:'mvp_features',landed_id:'7'};
  for(const [landed_state,label] of [['removed','Feature removed'],['not_must_have','No longer a must-have']]){
    const gone={...item,landed_state};assert.equal(landedHref(gone,'prototype-mvp','?project_id=1'),null);assert.equal(opensRecord(gone,'prototype-mvp'),false);
    for(const readOnly of [false,true]){
      const html=renderToStaticMarkup(h(MemoryRouter,null,h(DoneRow,{item:gone,module:'prototype-mvp',search:'?project_id=1',readOnly})));
      assert.ok(html.includes(label));assert.ok(html.includes('Original proposal'));assert.ok(!html.includes('href='));
    }
  }
  const present={...item,landed_state:'present'};
  assert.equal(landedHref(present,'prototype-mvp','?project_id=1'),'/build/prototype-mvp/7?project_id=1');assert.equal(opensRecord(present,'prototype-mvp'),true);
  const html=renderToStaticMarkup(h(MemoryRouter,null,h(DoneRow,{item:present,module:'prototype-mvp',search:'?project_id=1'})));
  assert.ok(html.includes('href="/build/prototype-mvp/7?project_id=1"'));assert.ok(html.includes('Open the record'));
});
