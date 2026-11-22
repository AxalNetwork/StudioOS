/** D7706: the actual sizing page delegates all sizing to one versioned Worker save. */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import Page, { seedAssumptions, sizingRequest, fmtMoney, marketFigureDefined, marketShare, currentSizingVersion } from '../src/pages/SpinoutLabMarketPage.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { api, spinoutLab } from '../src/lib/api.js';
import { marketSizingApi } from '../src/lib/api/marketSizing.js';
import { cycleValidateApi } from '../src/lib/api/cycleValidate.js';
const h = React.createElement;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const user = { id: 1, role: 'founder', spinout_lab_active: 1 };
const input = { population: '100', acv: '1000', samPct: '0', winRate: '0', capacity: '2', horizonMonths: '24', salesCycleMonths: '3', retentionPct: '80', cagr: '0' };
const version = { uid: 'v4', version_number: 4, created_at: '2026-11-22T00:00:00Z', current: true, recomputes: true, tam: 100000, sam: 0, som: 0, formula: ['Total from entered accounts and annual revenue', 'Serviceable at entered zero percent', 'Obtainable is the lower sales or win limit', 'Sales capacity set the limit'] };
const props = (m, id) => { const node = m.nodes().find(n => m.props(n)?.['data-testid'] === id); assert.ok(node, id); return m.props(node); };
const until = async (m, f) => { const end = performance.now()+5000; while(!f()) { if(performance.now()>end) assert.fail('UI did not settle'); await m.flush(); } };
beforeEach(t => { t.mock.method(globalThis, 'fetch', async () => { throw new Error('Synthetic fixture: network disabled'); }); });
test('zero and blank inputs stay distinct in the full request, display, readiness and share', () => {
  const empty = seedAssumptions({ tam: 100, sam: 14, som: 8 });
  assert.equal(empty.samPct, ''); assert.equal(empty.winRate, ''); assert.equal(empty.tamOverride, '');
  const assumptions = seedAssumptions(null, { ...input, samPct: 0, tamOverride: 0, segFilter: ['Synthetic'] });
  const request = sizingRequest(assumptions, '7');
  assert.equal(request.assumptions.samPct, '0'); assert.equal(request.assumptions.tamOverride, '0');
  assert.equal(sizingRequest(empty, '').assumptions.winRate, '');
  assert.deepEqual(request.marketFigureSource, { method: 'top_down', market_source_id: 7 });
  assert.notEqual(request.assumptions.segFilter, assumptions.segFilter);
  assert.equal(fmtMoney(0), '$0'); assert.equal(fmtMoney(null), null);
  assert.equal(marketFigureDefined(0), true); assert.equal(marketFigureDefined(''), false);
  assert.equal(marketShare(0,100), 0); assert.equal(marketShare(0,0),0); assert.equal(marketShare(null,100),null);
  assert.equal(currentSizingVersion(version, version), true);
  assert.equal(currentSizingVersion(version, {...version,som:1}), false);
  assert.equal(currentSizingVersion({...version,current:false},version),false);
  assert.equal(currentSizingVersion({...version,recomputes:false},version),false);
});
async function page(t, options={}) {
  const events=[]; const previews=[];
  const project={id:7, founder_id:1, name:'Synthetic venture', sector:'Synthetic', tam:200000,sam:100000,som:1000,...options.project};
  t.mock.method(api,'getMe',async()=>user);
  t.mock.method(api,'listProjects',async()=>[project]);
  for(const key of ['miSectorCompass','miFounderLens','miSources','miCitations','miFitFounder']) t.mock.method(api,key,async()=>null);
  t.mock.method(api.competitors,'list',async()=>({analyses:[]}));
  t.mock.method(api,'getMarketAssumptions',async()=>({assumptions:input}));
  t.mock.method(cycleValidateApi,'marketReadiness',async()=>({sources:[]}));
  t.mock.method(cycleValidateApi,'setMarketMark',async(...args)=>{events.push(['mark',...args]);});
  t.mock.method(spinoutLab,'complete',async(key)=>{events.push(['milestone',key]); return {};});
  t.mock.method(marketSizingApi,'versions',async()=>options.versions?options.versions():({versions:options.version?[options.version]:[]}));
  t.mock.method(marketSizingApi,'version',async()=>({version:options.version}));
  t.mock.method(marketSizingApi,'preview',async(id,body)=>{previews.push({id,body}); return options.preview?options.preview(id,body):{result:version};});
  t.mock.method(marketSizingApi,'saveVersion',async(id,body)=>{events.push(['save',id,body]); return options.save?options.save(id,body):{version};});
  t.mock.method(api,'updateProject',async()=>assert.fail('Legacy figures write must never run'));
  t.mock.method(api,'saveMarketAssumptions',async()=>assert.fail('Legacy assumptions write must never run'));
  const m=await mountContracts(h(AuthProvider,null,h(Page,{from:'validate'})), '/validate/market-intelligence/sizing?project=7',user);
  await until(m,()=>m.text().includes('Synthetic venture'));
  document.getElementById = id => m.nodes().find(n => id && m.props(n)?.id === id) || null;
  return {...m,events,previews};
}
test('a successful zero save commits one frozen request before marks and updates the real cards',async t=>{
  const pending=deferred(); const m=await page(t,{save:()=>pending.promise});
  try {
    await act(async()=>props(m,'button-edit-sizing').onClick());
    await until(m,()=>m.previews.length>0);
    assert.match(m.text(),/How it was computed · not saved/);
    assert.match(m.text(),/Serviceable at entered zero percent/);
    assert.equal(m.events.length,0,'preview writes nothing');
    let saving; await act(async()=>{saving=props(m,'button-save-sizing').onClick();});
    assert.equal(m.events.length,1); assert.equal(m.events[0][0],'save');
    assert.equal(m.events[0][2].assumptions.samPct,'0');
    assert.equal(props(m,'button-save-sizing').disabled,true);
    assert.match(m.text(),/\$200K/,'pending save retains the old total');
    await act(async()=>{pending.resolve({version}); await saving;});
    await until(m,()=>m.text().includes('$100K'));
    assert.deepEqual(m.events.map(e=>e[0]),['save','milestone','mark']);
    assert.equal(m.events[2][2],'assumptions_reviewed');
    assert.match(m.text(),/Serviceable segment · 0% of TAM/);
    assert.match(m.text(),/Obtainable share · 0% of SAM/);
    assert.equal(m.nodes().some(n=>m.props(n)?.['data-testid']==='button-add-som'),false);
    assert.match(m.text(),/0%\/yr/); assert.doesNotMatch(m.text(),/0%\/yr \(default\)/);
  } finally {await m.unmount();}
});
for(const refusal of [false,true]) test(`a ${refusal?'field refusal':'failed save'} keeps edits, drawer and old figures and writes no marks`,async t=>{
  const error=Object.assign(new Error('Enter serviceable share'),refusal?{data:{field:'samPct',fields:['samPct']}}:{});
  const m=await page(t,{save:async()=>{throw error;}});
  try {
    await act(async()=>props(m,'button-edit-sizing').onClick());
    await act(async()=>props(m,'input-sam').onChange({target:{value:''}}));
    await act(async()=>{await props(m,'button-save-sizing').onClick();});
    assert.match(m.text(),/Couldn’t save\. Your edits are kept here\. Nothing changed on the page\./);
    assert.equal(props(m,'input-sam').value,'');
    assert.equal(Boolean(props(m,'input-sam')['aria-invalid']),refusal);
    assert.match(m.text(),/\$200K/);
    assert.deepEqual(m.events.map(e=>e[0]),['save']);
  } finally {await m.unmount();}
});
test('the latest preview wins while capacity and horizon travel as inputs, never as local figures',async t=>{
  const first=deferred(); let count=0;
  const m=await page(t,{preview:async()=>++count===1?first.promise:{result:{...version,formula:['NEW server formula'],som:123}}});
  try {
    await act(async()=>props(m,'button-edit-sizing').onClick());
    await until(m,()=>count===1);
    await act(async()=>props(m,'input-capacity').onChange({target:{value:'9'}}));
    await act(async()=>props(m,'input-horizon').onChange({target:{value:'36'}}));
    await until(m,()=>m.text().includes('NEW server formula'));
    await act(async()=>first.resolve({result:{...version,formula:['OLD server formula']}}));
    assert.match(m.text(),/NEW server formula/); assert.doesNotMatch(m.text(),/OLD server formula/);
    assert.equal(m.previews.at(-1).body.assumptions.capacity,'9');
    assert.equal(m.previews.at(-1).body.assumptions.horizonMonths,'36');
    assert.equal(m.events.length,0); assert.match(m.text(),/\$200K/);
  } finally {await m.unmount();}
});
for(const matches of [true,false]) test(`saved formula ${matches?'appears for matching figures':'is hidden after figures drift'}`,async t=>{
  const m=await page(t,{version,project:matches?version:{...version,som:50}});
  try {
    await act(async()=>props(m,'button-toggle-methodology').onClick());
    await until(m,()=>m.text().includes(matches?'Total from entered accounts':'saved without a matching version'));
    if(matches) {assert.match(m.text(),/Version 4 · 2026-11-22/); assert.match(m.text(),/Sales capacity set the limit/);}
    else assert.doesNotMatch(m.text(),/Total from entered accounts/);
  } finally {await m.unmount();}
});
for(const fails of [false,true]) test(`a committed version survives a late ${fails?'failed':'older'} history read without refetching`,async t=>{
  const pending=deferred(); let reads=0;
  const m=await page(t,{versions:()=>{reads++; return pending.promise;}});
  try {
    await until(m,()=>reads===1);
    await act(async()=>props(m,'button-edit-sizing').onClick());
    await act(async()=>{await props(m,'button-save-sizing').onClick();});
    await act(async()=>props(m,'button-toggle-methodology').onClick());
    assert.match(m.text(),/Version 4 · 2026-11-22/);
    await act(async()=>{if(fails) pending.reject(new Error('Synthetic history unavailable')); else pending.resolve({versions:[]});});
    assert.equal(reads,1,'saving figures must not start a redundant history refresh');
    assert.match(m.text(),/Version 4 · 2026-11-22/);
    assert.match(m.text(),/Total from entered accounts/);
  } finally {await m.unmount();}
});
test('preview waits for a pause, cancels pending inputs and ignores context-only edits',async t=>{
  const m=await page(t);
  const scheduled=[]; const originalSet=setTimeout,originalClear=clearTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{
    if(ms!==350) return originalSet(fn,ms,...args);
    const timer={fn:()=>fn(...args),active:true};scheduled.push(timer);return timer;
  });
  t.mock.method(globalThis,'clearTimeout',timer=>{
    if(scheduled.includes(timer)) timer.active=false;else originalClear(timer);
  });
  const advance=()=>act(async()=>{for(const timer of scheduled.filter(t=>t.active)){timer.active=false;timer.fn();}});
  try {
    await act(async()=>props(m,'button-edit-sizing').onClick());
    await act(async()=>{
      props(m,'input-capacity').onChange({target:{value:'9'}});
      props(m,'input-horizon').onChange({target:{value:'36'}});
    });
    assert.equal(m.previews.length,0,'no request while typing');
    await advance();
    assert.equal(m.previews.length,1,'only the final edited inputs are calculated');
    const first=m.previews[0];assert.equal(first.body.assumptions.capacity,'9');
    assert.equal(first.body.assumptions.horizonMonths,'36');
    await act(async()=>props(m,'input-cagr').onChange({target:{value:'12'}}));
    await advance();assert.equal(m.previews.length,1,'CAGR does not affect this Worker formula');
    await act(async()=>props(m,'input-capacity').onChange({target:{value:'10'}}));
    await advance();assert.equal(m.previews.length,2);
    await act(async()=>props(m,'input-capacity').onChange({target:{value:'11'}}));
    await m.unmount();await advance();assert.equal(m.previews.length,2,'leaving cancels the pending calculation');
  } finally {await m.unmount();}
});
