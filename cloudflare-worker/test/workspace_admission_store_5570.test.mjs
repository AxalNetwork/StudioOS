/** D5570 part 2: real SQLite Durable Object transactions, restart, rollback, concurrency and settlement replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const root=process.cwd();
async function runtime(persist){
 const bundled=await build({stdin:{contents:`import { DurableWorkspaceAdmissionStore } from './cloudflare-worker/src/services/agents/workspaceAdmissionStore.ts';
 import {createAdmissionControl} from './cloudflare-worker/src/services/agents/workspaceAdmission.ts';
 export class TestAdmission {constructor(state){this.state=state;} async fetch(req){const {op,args=[],now=1000}=await req.json();const store=new DurableWorkspaceAdmissionStore(this.state.storage);
 if(op==='rollback'){try{await store.transaction(s=>{s.next_sequence=999;throw Error('rollback');});}catch{}return Response.json(await store.transaction(s=>s.next_sequence));}
 if(op==='async'){try{await store.transaction(async s=>{s.next_sequence=999;return 1;});}catch{return Response.json(await store.transaction(s=>s.next_sequence));}}
 const control=createAdmissionControl({store,clock:()=>now,limits:{halted:false,lease_ms:1000,per_tenant_running:1,per_tenant_waiting:10,max_waiting:10,per_provider_running:{cloudflare:1},per_region_running:{'cloudflare:weur':1}},observe:async()=>({state:'unknown',measured_microusd:'unavailable'})});return Response.json(await control[op](...args));}}
 export default {fetch(req,env){return env.ADMISSION.get(env.ADMISSION.idFromName('shared-quotas')).fetch(req);}};`,resolveDir:root,sourcefile:'admission-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const mf=new Miniflare({...convertV4MiniflareOptions({name:'admission-fixture',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-11-08',durableObjects:{ADMISSION:{className:'TestAdmission',useSQLite:true,unsafeUniqueKey:'admission-5570-test'}},}),resourcePersistencePath:persist});
 return {close:()=>mf.dispose(),call:async(op,args=[],now=1000)=>{const r=await mf.dispatchFetch('https://test',{method:'POST',body:JSON.stringify({op,args,now})});assert.equal(r.status,200,await r.clone().text());return r.json();}};
}
const request=n=>({run_uid:'synthetic-run-'+n,tenant_id:n,agent_id:n,provider:'cloudflare',region:'weur',compute_reserve_microusd:50});
test('durable admission serializes concurrent candidates, survives runtime restart, fences and settles once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'admission-5570-'));let r;
 try{r=await runtime(dir);
 await Promise.all([1,2,3].map(n=>r.call('enqueue',[request(n)])));
 const grants=(await Promise.all(Array.from({length:5},()=>r.call('admit')))).flat();assert.equal(grants.length,1);const g=grants[0];
 assert.equal(await r.call('rollback'),4);assert.equal(await r.call('async'),4);
 await r.close();r=await runtime(dir);assert.deepEqual(await r.call('admit'),[]);
 assert.equal((await r.call('release',[g.run_uid,g.generation+1,1])).ok,false);
 const settled=await r.call('release',[g.run_uid,g.generation,17]);assert.equal(settled.ok,true,JSON.stringify(settled));assert.equal(settled.value.charged_microusd,17);
 const replay=await r.call('release',[g.run_uid,g.generation,49]);assert.equal(replay.value.charged_microusd,17);assert.equal(replay.value.first,false);
 const next=await r.call('admit');assert.equal(next.length,1);assert.notEqual(next[0].run_uid,g.run_uid);
 assert.deepEqual(await r.call('admit',[],2500),[]); // Expiry does not free capacity without observed cleanup.
 await r.call('reconcile',[],2500);assert.deepEqual(await r.call('admit',[],2500),[]);
 }finally{await r?.close();rmSync(dir,{recursive:true,force:true});}
});
