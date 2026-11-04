// #4420: mounted ENTRY cards retain counts, absence, off and independent failure states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import WorkSummaryCard from '../src/pages/work/WorkSummaryCard.jsx';
import ComplianceCard from '../src/pages/work/ComplianceCard.jsx';
import { workAdapter } from '../src/pages/work/workAdapter.js';
import { workApi } from '../src/lib/api/work.js';
const h=React.createElement;
const read=(f)=>readFileSync(new URL(`../../${f}`,import.meta.url),'utf8');
async function mount(Component, props) {
  const restore=installDocument(), container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container);
  await act(async()=>{root.render(h(MemoryRouter,null,h(Component,props)));for(let n=0;n<6;n++) await new Promise(r=>setTimeout(r,0));});
  const text=(node)=>node.nodeType===3?node.textContent:node.childNodes?.length?node.childNodes.map(text).join(' '):node.textContent||'';
  const walk=(node)=>[node,...(node.childNodes||[]).flatMap(walk)];
  const pr=(node)=>Object.entries(node).find(([k])=>k.startsWith('__reactProps$'))?.[1]||{};
  return {text:()=>text(container).replace(/\s+/g,' '),nodes:()=>walk(container),pr,close:async()=>{await act(async()=>root.unmount());restore();}};
}
const columns={triage:1,backlog:2,ready:3,in_progress:4,in_review:5,done:6};
test('project Work reads summary and 2w history, renders counts and completion, and links to its project',async()=>{
  const real={...workAdapter}, calls=[];
  workAdapter.summary=async(id)=>{calls.push(['summary',id]);return {available:true,data:{open:15,closed:6,columns}};};
  workAdapter.burnup=async(id,opts)=>{calls.push(['burnup',id,opts]);return {available:true,data:{available:true,series:[{day:'2026-11-01',scope:21,completed:6}]}};};
  let m;try{
    m=await mount(WorkSummaryCard,{projectId:7});
    assert.deepEqual(calls,[['summary',7],['burnup',7,{range:'2w'}]]);
    assert.match(m.text(),/15 open · 6 closed/);assert.match(m.text(),/6 of 21 completed · last 2 weeks/);
    assert.ok(m.nodes().some(n=>m.pr(n).href==='/projects/7/work'));
    assert.ok(m.nodes().some(n=>n.tagName==='SVG'));
  }finally{await m?.close();Object.assign(workAdapter,real);}
});
test('Work has honest empty, off and failed reads; a history failure retains summary',async()=>{
  const real={...workAdapter};let m;
  try{
    for(const mode of ['empty','off','error','invalid','history','invalid-history']){
      workAdapter.summary=async()=>{if(mode==='error')throw new Error('read');if(mode==='invalid')return {available:true,data:{}};return mode==='off'?{available:false,reason:'Work is not switched on yet.'}:{available:true,data:{open:0,closed:0,columns:Object.fromEntries(Object.keys(columns).map(k=>[k,0]))}};};
      workAdapter.burnup=async()=>{if(mode==='history')throw new Error('history');if(mode==='invalid-history')return {available:true,data:{}};return {available:true,data:{available:false}};};
      m=await mount(WorkSummaryCard,{projectId:7});const text=m.text();
      if(mode==='empty')assert.match(text,/Not recorded/);
      if(mode==='off'){assert.match(text,/not switched on/);assert.doesNotMatch(text,/0 open/);}
      if(mode==='error'||mode==='invalid'){assert.match(text,/could not be read/);assert.doesNotMatch(text,/0 open/);}
      if(mode==='history'||mode==='invalid-history'){assert.match(text,/0 open · 0 closed/);assert.match(text,/Work history could not be read/);assert.doesNotMatch(text,/Not recorded/);}
      await m.close();m=null;
    }
  }finally{await m?.close();Object.assign(workAdapter,real);}
});
test('Compliance shows next five, overdue count, both links, and an empty record',async()=>{
  const real=workAdapter.complianceTasks;let m;
  try{
    workAdapter.complianceTasks=async()=>({available:true,data:{tasks:Array.from({length:6},(_,i)=>({uid:`t${i}`,title:`Synthetic task ${i}`,status:'open',due:`2000-01-0${i+1}`,owner:{name:'Synthetic owner'}}))}});
    m=await mount(ComplianceCard,{uid:'co-one'});assert.match(m.text(),/6 overdue/);assert.match(m.text(),/Synthetic task 4/);assert.doesNotMatch(m.text(),/Synthetic task 5/);
    assert.match(m.text(),/See all compliance tasks ›/);assert.ok(m.nodes().some(n=>m.pr(n).href==='/calendar?layer=compliance'));
    await m.close();m=null;
    workAdapter.complianceTasks=async()=>({available:true,data:{tasks:[]}});m=await mount(ComplianceCard,{uid:'co-one'});assert.match(m.text(),/Not recorded/);assert.doesNotMatch(m.text(),/0 overdue/);
  }finally{await m?.close();workAdapter.complianceTasks=real;}
});
test('entry points stay on their own scope; no Work sidebar row; summary uses its scoped API',async()=>{
  const project=read('frontend/src/pages/account/companies/ProjectPage.jsx'),company=read('frontend/src/pages/account/companies/CompanyPage.jsx');
  assert.match(project,/<WorkSummaryCard[^>]*projectId=\{id\}/);assert.doesNotMatch(project,/<ComplianceCard/);
  assert.match(company,/<ComplianceCard[^>]*uid=\{uid\}/);assert.doesNotMatch(company,/<WorkSummaryCard/);
  const real=workApi.summary;try{let id;workApi.summary=async(v)=>{id=v;return {open:2};};assert.deepEqual(await workAdapter.summary(7),{available:true,data:{open:2}});assert.equal(id,7);}finally{workApi.summary=real;}
  assert.match(read('frontend/src/lib/api/work.js'),/summary:.*\/work\/summary/);
  const sidebar=read('frontend/src/sidebarConfig.js');assert.doesNotMatch(sidebar,/label:\s*['"]Work['"]/);
});

test('Compliance distinguishes unavailable and failed reads from an empty list',async()=>{
  const real=workAdapter.complianceTasks;let m;
  try{
    for(const mode of ['off','error','invalid','done']){
      workAdapter.complianceTasks=async()=>{
        if(mode==='error')throw new Error('read');
        if(mode==='off')return {available:false,reason:'Compliance tasks are not switched on yet.'};
        return {available:true,data:mode==='invalid'?{}:{tasks:[{uid:'done',status:'done',due:'2000-01-01',title:'Finished'}]}};
      };
      m=await mount(ComplianceCard,{uid:'co-one'});
      if(mode==='off')assert.match(m.text(),/not switched on/);
      if(mode==='error'||mode==='invalid')assert.match(m.text(),/Compliance could not be read/);
      if(mode==='done')assert.match(m.text(),/No open compliance tasks/);
      assert.doesNotMatch(m.text(),/Not recorded|0 overdue/);
      await m.close();m=null;
    }
  }finally{await m?.close();workAdapter.complianceTasks=real;}
});
