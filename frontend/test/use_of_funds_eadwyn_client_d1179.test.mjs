import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceModule} from './_form_d695.mjs';
async function client(fail=false){
 const calls=[];globalThis.__uof1179Request=(...args)=>{calls.push(args);return fail?Promise.reject(Object.assign(new Error('Unreadable'),{code:'uof_reading_unreadable'})):Promise.resolve({items:[]});};
 const code=readFileSync(new URL('../src/lib/api/useOfFunds.js',import.meta.url),'utf8').replace(/import \{ request \}[^;]+;/,'const request=(...args)=>globalThis.__uof1179Request(...args);');
 return {calls,api:(await sourceModule(code,'lib/api/useOfFunds.js')).useOfFundsApi};
}
test('D1179 clients keep each venture, endpoint, method, receipt and rail header unchanged',async()=>{
 try{
  const {calls,api}=await client();const receipt={payload:'signed source snapshot',signature:'signature'},body={mode:'check'},headers={'X-Rail-Option':'draft:raise/use-of-funds-check'};
  await api.readings(7);await api.readingRoadmap(7);await api.previewReading(7,body,headers);await api.keepReading(7,receipt);
  assert.deepEqual(calls.map(([u,o={}])=>[u,o.method??'GET']),[
   ['/cycles/raise/use-of-funds/eadwyn?project=7','GET'],['/cycles/raise/use-of-funds/eadwyn/roadmap?project=7','GET'],['/cycles/raise/use-of-funds/eadwyn?project=7','POST'],['/cycles/raise/use-of-funds/eadwyn/keep?project=7','POST'],
  ]);
  assert.deepEqual(JSON.parse(calls[2][1].body),body);assert.equal(calls[2][1].headers,headers);assert.deepEqual(JSON.parse(calls[3][1].body),{receipt});assert.equal(calls[0][1],undefined);
 }finally{delete globalThis.__uof1179Request;}
});
test('D1179 a failed read stays rejected, never an empty list or a fabricated zero',async()=>{
 try{const{api}=await client(true);for(const method of ['readings','readingRoadmap'])await assert.rejects(api[method](7),e=>e.code==='uof_reading_unreadable');}finally{delete globalThis.__uof1179Request;}
});
