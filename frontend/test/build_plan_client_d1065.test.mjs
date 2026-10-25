import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const seen=[];
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.fetch=async(url,options)=>{seen.push({url:String(url),method:options.method||'GET',body:options.body});return new Response(JSON.stringify({plan:null,modules:{},brief:null}),{status:200,headers:{'Content-Type':'application/json'}});};
const {buildPlanApi}=await import('../src/lib/api.js');
test('the plan client sends the venture and scope to mounted GET/POST routes, with no evidence supplied by the browser',async()=>{
  assert.deepEqual(await buildPlanApi.read(17),{plan:null,modules:{},brief:null});
  await buildPlanApi.prepare(17,'h-2');
  assert.deepEqual(seen,[{url:'/api/cycles/build/plan?project=17&scope=venture',method:'GET',body:undefined},{url:'/api/cycles/build/plan?project=17&scope=h-2',method:'POST',body:'{}'}]);
});
test('the client is re-exported once in the alphabetical block, and its router mounts before the Build router',()=>{
  const api=readFileSync('frontend/src/lib/api.js','utf8');
  const lines=api.slice(api.indexOf('// api-modules:begin'),api.indexOf('// api-modules:end')).split('\n').filter(l=>l.startsWith('export *'));
  assert.equal(lines.filter(l=>l==="export * from './api/buildPlan.js';").length,1);assert.deepEqual(lines,[...lines].sort());
  const index=readFileSync('cloudflare-worker/src/index.ts','utf8');
  assert.ok(index.indexOf("app.route('/api/cycles/build/plan', buildPlanRoutes)")>=0);
  assert.ok(index.indexOf("app.route('/api/cycles/build/plan', buildPlanRoutes)")<index.indexOf("app.route('/api/cycles/build', cycleBuildRoutes)"));
});
