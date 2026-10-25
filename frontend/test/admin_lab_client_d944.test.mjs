import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const seen=[];
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
globalThis.fetch=async(url,options)=>{
  seen.push({url:String(url),method:options.method||'GET'});
  return new Response(JSON.stringify(String(url).includes('/overview')?{blocks:{cohorts:{available:false,reason:'Unreadable'}}}:{available:true,items:[],total:17}),{status:200,headers:{'Content-Type':'application/json'}});
};
const {adminLabApi}=await import('../src/lib/api.js');
test('D944: overview calls the mounted read, preserves per-block failures and encodes the cohort',async()=>{
  seen.length=0;
  assert.deepEqual(await adminLabApi.overview({cohort:'2026-11',unused:'ignored'}),{blocks:{cohorts:{available:false,reason:'Unreadable'}}});
  await adminLabApi.overview();
  assert.deepEqual(seen,[{url:'/api/admin/cohort/overview?cohort=2026-11',method:'GET'},{url:'/api/admin/cohort/overview',method:'GET'}]);
});
test('D944: applications sends all supported filters and pagination, retaining zero offset and literal search characters',async()=>{
  seen.length=0;
  const r=await adminLabApi.applications({cohort:'2026-11',status:'waiting',origin:'university',tech_transfer:'signed',stage:'prototype',incorporated:'no',interview:'none',carried_forward:'yes',sort:'team_size',q:'%_ & Lab',limit:25,offset:0,rogue:'ignored'});
  assert.deepEqual(r,{available:true,items:[],total:17});
  assert.equal(seen[0].method,'GET');
  const url=new URL(seen[0].url,'https://fixture.example.test');
  assert.equal(url.pathname,'/api/admin/cohort/applications/list');
  assert.deepEqual(Object.fromEntries(url.searchParams),{cohort:'2026-11',status:'waiting',origin:'university',tech_transfer:'signed',stage:'prototype',incorporated:'no',interview:'none',carried_forward:'yes',sort:'team_size',q:'%_ & Lab',limit:'25',offset:'0'});
});
test('D944: the client is its own module and re-exported once in the alphabetical API block',()=>{
  const src=readFileSync('frontend/src/lib/api.js','utf8');const block=src.slice(src.indexOf('// api-modules:begin'),src.indexOf('// api-modules:end'));
  const lines=block.split('\n').filter(x=>x.startsWith('export * from'));
  assert.equal(lines.filter(x=>x==="export * from './api/adminLab.js';").length,1);assert.deepEqual(lines,[...lines].sort());
});
