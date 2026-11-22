/** D7814: deferred reads across route changes, loaded-record saves and the mounted shared leave guard. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import CompanyAnalysis from '../src/pages/research/CompanyAnalysis.jsx';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';
import { writeLastResults } from '../src/pages/research/companyDirectoryState.js';
const h = React.createElement;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const record = (id, version=1) => ({ id, version, title: `Analysis ${id}`, status: 'complete', inputs: {}, output: { market_summary: `Summary ${id}`, notes: '', gaps: [], next_actions: [] }, candidates: [], sources: [], signals: [] });
function text(node) { return node.childNodes?.length ? node.childNodes.map(text).join('') : node.textContent || ''; }
function fakeWindow() {
  const listeners = [];
  return {
    asks: [], allow: true, history: { state: { idx: 5 }, moves: [], go(n) { this.moves.push(n); } },
    confirm(message) { this.asks.push(message); return this.allow; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) { const at=listeners.findIndex(x=>x.type===type&&x.fn===fn); if(at>=0)listeners.splice(at,1); },
    dispatchEvent(event) { for(const x of [...listeners]) if(x.type===event.type&&!event.stopped)x.fn(event); return true; },
    count(type) { return listeners.filter(x=>x.type===type).length; },
    PopStateEvent: class { constructor(type, init={}) { this.type=type; this.state=init.state; } preventDefault() { this.prevented=true; } stopImmediatePropagation() { this.stopped=true; } },
  };
}
async function mount() {
  const original = { ...api.competitors }; const gets=[], writes=[], refreshes=[];
  api.competitors.get = id => { const d=deferred(); gets.push({id,...d}); return d.promise; };
  api.competitors.refresh = id => { const d=deferred(); refreshes.push({id,...d}); return d.promise; };
  api.competitors.save = async (id, body) => { writes.push({id,body}); if(id==='A')throw Object.assign(new Error('Conflict A'),{status:409,data:{current_version:2}}); return {...record(id,body.base_version+1), title:body.title, output:body.output}; };
  const oldWindow=globalThis.window, oldSession=globalThis.sessionStorage;
  const win=fakeWindow(); const storage=new Map(); globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  writeLastResults(sessionStorage,'/research/companies?q=kept&tab=saved',null);
  let navigate;
  function Probe() { navigate=useNavigate(); win.document=document; win.HTMLElement=globalThis.HTMLElement; win.HTMLIFrameElement=globalThis.HTMLIFrameElement; globalThis.window=win; return null; }
  const ui=await mountContracts(h(React.Fragment,null,h(Probe),h(Routes,null,h(Route,{path:'/research/companies/:id',element:h(CompanyAnalysis)}),h(Route,{path:'/elsewhere',element:h('p',null,'Elsewhere')}))),'/research/companies/A',{id:1,role:'founder'});
  const settle=async fn=>{ await act(async()=>{fn();}); await ui.flush(); };
  const button=label=>ui.nodes().find(n=>n.tagName==='BUTTON'&&text(n).trim()===label);
  return {ui,win,gets,writes,refreshes,settle,button,
    async click(label) { await settle(()=>ui.props(button(label)).onClick({stopPropagation(){}})); },
    async type(value) { const input=ui.nodes().find(n=>ui.props(n)?.['aria-label']==='Market summary'); await settle(()=>ui.props(input).onChange({target:{value}})); },
    async go(path) { await settle(()=>navigate(path)); },
    async close() { await ui.unmount(); Object.assign(api.competitors,original); globalThis.window=oldWindow; globalThis.sessionStorage=oldSession; },
  };
}
for (const answer of ['success','failure']) test(`a late conflict re-read ${answer} cannot replace B, its draft or its error line`, async () => {
  const m=await mount();
  try {
    await m.settle(()=>m.gets[0].resolve(record('A'))); await m.type('Unsaved A'); await m.click('Save');
    await m.click('Load version 2, keep my changes'); assert.equal(m.gets[1].id,'A');
    await m.go('/research/companies/B'); await m.settle(()=>m.gets[2].resolve(record('B',7))); await m.type('Unsaved B');
    if(answer==='success')await m.settle(()=>m.gets[1].resolve({...record('A',2),title:'Late A'}));
    else await m.settle(()=>m.gets[1].reject(new Error('Late A error')));
    assert.match(m.ui.text(),/Analysis B/); assert.doesNotMatch(m.ui.text(),/Late A|Conflict A/);
    const input=m.ui.nodes().find(n=>m.ui.props(n)?.['aria-label']==='Market summary'); assert.equal(m.ui.props(input).value,'Unsaved B');
    await m.click('Save'); const saved=m.writes.at(-1); assert.equal(saved.id,'B'); assert.equal(saved.body.base_version,7); assert.equal(saved.body.output.market_summary,'Unsaved B'); assert.doesNotMatch(JSON.stringify(saved),/Unsaved A/);
  } finally { await m.close(); }
});
test('a late refresh leaves the next analysis and its draft unchanged', async () => {
  const m=await mount();
  try {
    await m.settle(()=>m.gets[0].resolve(record('A'))); await m.click('Refresh sources');
    await m.go('/research/companies/B'); await m.settle(()=>m.gets[1].resolve(record('B'))); await m.type('Keep B');
    await m.settle(()=>m.refreshes[0].resolve({...record('A'),refresh:{checked:90}}));
    assert.match(m.ui.text(),/Analysis B/); assert.doesNotMatch(m.ui.text(),/90 checked/);
    const input=m.ui.nodes().find(n=>m.ui.props(n)?.['aria-label']==='Market summary'); assert.equal(m.ui.props(input).value,'Keep B');
  } finally { await m.close(); }
});
test('dirty page guards links, navigate, Back/Forward and exactly one reload listener; clean navigation never asks', async () => {
  const m=await mount();
  try {
    await m.settle(()=>m.gets[0].resolve(record('A'))); assert.equal(m.win.count('beforeunload'),0);
    await m.type('Dirty'); m.win.allow=false; assert.equal(m.win.count('beforeunload'),1);
    const link=m.ui.nodes().find(n=>n.tagName==='A'&&text(n).trim()==='‹ Companies'); assert.equal(m.ui.props(link).href,'/research/companies?q=kept&tab=saved');
    await m.settle(()=>m.ui.props(link).onClick({button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}}));
    assert.equal(m.win.asks.length,1); assert.match(m.ui.text(),/Analysis A/);
    await m.go('/elsewhere'); assert.equal(m.win.asks.length,2); assert.match(m.ui.text(),/Analysis A/);
    for(const idx of [4,6]) { const before=m.win.asks.length; m.win.dispatchEvent(new m.win.PopStateEvent('popstate',{state:{idx}})); assert.equal(m.win.asks.length,before+1); m.win.dispatchEvent(new m.win.PopStateEvent('popstate',{state:{idx:5}})); }
    assert.deepEqual(m.win.history.moves,[1,-1]);
    const reload=new m.win.PopStateEvent('beforeunload');m.win.dispatchEvent(reload);assert.equal(reload.prevented,true);
    await m.type('Summary A'); assert.equal(m.win.count('beforeunload'),0);
    const before=m.win.asks.length; await m.go('/elsewhere'); assert.equal(m.win.asks.length,before); assert.match(m.ui.text(),/Elsewhere/);
  } finally { await m.close(); }
});
