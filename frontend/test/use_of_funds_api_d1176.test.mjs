import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sourceModule} from './_form_d695.mjs';
async function client(){
  const calls=[];globalThis.__uofCalls=calls;
  const code=readFileSync(new URL('../src/lib/api/useOfFunds.js',import.meta.url),'utf8').replace(/import \{ request \}[^;]+;/,"const request=(...args)=>{globalThis.__uofCalls.push(args);return Promise.resolve({});};");
  return {calls,api:(await sourceModule(code,'lib/api/useOfFunds.js')).useOfFundsApi};
}
test('D1176 clients retain venture scope, comparison order, opaque ids and human payloads across mounted reads and writes',async()=>{
  try{
    const {calls,api}=await client();const payload={amount_to_raise_cents:0,lines:[],source:'never-invent'};
    const cases=[['plan',[], '/plan','GET'],['scenarios',[],'/scenarios','GET'],['scenario',[7],'/scenarios/7','GET'],['createScenario',[payload],'/scenarios','POST',payload],['updateScenario',[7,payload],'/scenarios/7','PATCH',payload],['deleteScenario',[7],'/scenarios/7','DELETE'],['makeBase',[7],'/scenarios/7/make-base','POST',{}],['milestone',[8],'/milestones/8','GET'],['createMilestone',[payload],'/milestones','POST',payload],['updateMilestone',[8,payload],'/milestones/8','PATCH',payload],['deleteMilestone',[8],'/milestones/8','DELETE'],['hires',[],'/hires','GET'],['updateHire',[9,payload],'/hires/9','PATCH',payload],['deleteHire',[9],'/hires/9','DELETE'],['saveSplit',[payload],'','PUT',payload]];
    for(const [name,args,path,method,body]of cases){
      await api[name](12,...args);const [url,options={}]=calls.at(-1);const parsed=new URL(url,'https://fixture.test');
      assert.equal(parsed.pathname,`/cycles/raise/use-of-funds${path}`);assert.equal(parsed.searchParams.get('project'),'12');assert.equal(options.method??'GET',method);
      assert.deepEqual(options.body===undefined?undefined:JSON.parse(options.body),body);
    }
    await api.compare(12,[9,3]);assert.equal(new URL(calls.at(-1)[0],'https://fixture.test').searchParams.get('ids'),'9,3');
    await api.milestones(12,7);assert.equal(new URL(calls.at(-1)[0],'https://fixture.test').searchParams.get('scenario_id'),'7');
    await api.scenario(12,'7?project=99');assert.ok(calls.at(-1)[0].startsWith('/cycles/raise/use-of-funds/scenarios/7%3Fproject%3D99?project=12'));
    assert.deepEqual(payload,{amount_to_raise_cents:0,lines:[],source:'never-invent'});
  }finally{delete globalThis.__uofCalls;}
});
test('D1176 forecast calls the retained strict financial-model route without transforming sources or recorded zeroes',async()=>{
  try{
    const {calls,api}=await client();const assumptions={starting_cash:0,_sources:{starting_cash:'typed',units_month_0:'stripe'}};
    await api.forecast(12);assert.deepEqual(calls[0],['/financials/12']);
    await api.saveForecast(12,assumptions);assert.equal(calls[1][0],'/financials/12');assert.equal(calls[1][1].method,'PUT');assert.deepEqual(JSON.parse(calls[1][1].body),{assumptions});
  }finally{delete globalThis.__uofCalls;}
});
