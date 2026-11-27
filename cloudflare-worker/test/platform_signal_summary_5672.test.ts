// D5672: existing role gate, source reuse and metadata-only missing-data behavior.
import test from 'node:test';import assert from 'node:assert/strict';
import {platformSignalSummary5672} from '../src/services/platformSignalSummary5672';
test('reader refuses a product profile before any DB access and unavailable sources remain unavailable',async()=>{
 let reads=0;const env={DB:{prepare:()=>{reads++;throw Error('private error: tenant token raw')}}} as any;
 await assert.rejects(platformSignalSummary5672(env,{role:'founder'},new Date('2026-11-12T10:00:00Z')),/restricted/);assert.equal(reads,0);
 const result=await platformSignalSummary5672(env,{role:'admin',is_super_admin:1},new Date('2026-11-12T10:00:00Z'));
 assert.equal(result.cron.available,false);assert.equal(result.dlq.available,false);assert.equal(result.episodes.available,false);
 assert.doesNotMatch(JSON.stringify(result),/private error|tenant token/);assert.ok(result.capacity.available);
 if(result.capacity.available)assert.ok(result.capacity.metrics.some(m=>m.availability==='unavailable'&&m.value===null));
});
test('existing failure and mute evidence is reduced to metadata, never copied as free text',async()=>{
 const env={DB:{prepare:()=>({bind(){return this},async first(){return {id:1,trigger_name:'* * * * *',started_at:'2026-11-12 09:59:00',finished_at:'2026-11-12 10:00:00',status:'failed',error:'private customer token raw'}},async all(){return {results:[{id:1,metric_key:'d1.size_bytes',severity:'critical',state:'open',opened_at:'2026-11-12T09:00:00Z',mute_reason:'private customer token raw'}]}}})}} as any;
 const result=await platformSignalSummary5672(env,{role:'admin',is_super_admin:1},new Date('2026-11-12T10:00:00Z'));
 assert.equal(result.cron.available,true);assert.equal(result.episodes.available,true);assert.doesNotMatch(JSON.stringify(result),/private customer|token raw|mute_reason|\"error\"/);
});
