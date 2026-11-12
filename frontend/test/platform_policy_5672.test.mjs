// D5672: aggregate thresholds, missing-data semantics and shared-episode transitions without producer side effects.
import test from 'node:test';import assert from 'node:assert/strict';
import {evaluatePlatform,correlatePlatform} from '../../engineering-notifications/platform-policy-5672.mjs';
const now=Date.parse('2026-11-12T10:00:00Z'),p={approved:true,maxAgeMs:60000,minimumSamples:100,rate:.05,sustainMs:10000,ageSeconds:900,graceMs:60000,stuckMs:300000};
const sample=(kind,extra={})=>({kind,script:'studioos',available:true,observedAt:now,breachSince:now-20000,sampleCount:100,...extra});
test('handled HTTP errors and runtime outcomes use separate denominators, sample floors and sustained evidence',()=>{
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:5}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('runtime',{total:100,failures:6}),p,now).reason,'runtime_outcome');
 assert.equal(evaluatePlatform(sample('http',{total:2,failures:1,sampleCount:2}),p,now).state,'quiet');
 assert.equal(evaluatePlatform(sample('http',{total:0,failures:0,sampleCount:0}),p,now).state,'quiet');
 assert.equal(evaluatePlatform(sample('http',{total:10000,failures:600,sampleCount:2}),p,now).state,'quiet');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:0,sampleCount:null}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:0,sampleCount:101}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:4}),p,now).state,'healthy');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:101}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:5,breachSince:now}),p,now).state,'pending');
 assert.equal(evaluatePlatform(sample('http',{total:100,failures:5}),{...p,approved:false},now).state,'unknown');
});
test('edge reachability never substitutes for independently confirmed customer/dependency health',()=>{
 const probe=sample('probe',{edgeOk:true,customerOk:true,dependencyOk:false,independentlyConfirmed:true});
 assert.equal(evaluatePlatform(probe,p,now).state,'firing');assert.equal(evaluatePlatform(probe,p,now).reason,'dependency_failure');
 assert.equal(evaluatePlatform({...probe,independentlyConfirmed:false},p,now).state,'unknown');
});
test('scheduled completion, queue age, durable DLQ and Workflow distinguish inactivity and unavailable telemetry',()=>{
 assert.equal(evaluatePlatform(sample('cron',{expectedCompletionAt:now-120000,status:'skipped'}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('cron',{expectedRunAt:now-180000,expectedCompletionAt:now-120000,lastSuccessAt:now-150000,status:'completed'}),p,now).state,'healthy');
 assert.equal(evaluatePlatform(sample('cron',{expectedRunAt:now-120000,expectedCompletionAt:now-120000,lastSuccessAt:now-150000,status:'completed'}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('cron',{expectedCompletionAt:now-120000,lastSuccessAt:now-150000,status:'completed'}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('cron',{expectedRunAt:now-180000,expectedCompletionAt:now-120000,lastSuccessAt:now+1,status:'completed'}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('queue',{depth:0,oldestAgeSeconds:null}),p,now).reason,'quiet_queue');
 assert.equal(evaluatePlatform(sample('queue',{depth:3,oldestAgeSeconds:901}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('queue',{depth:3,oldestAgeSeconds:null}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('dlq',{newLedgerRows:2,checkpointVerified:true}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('dlq',{newLedgerRows:2,checkpointVerified:false}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('workflow',{status:'running',lastProgressAt:now-600000}),p,now).state,'firing');
 assert.equal(evaluatePlatform(sample('workflow',{status:'running',lastProgressAt:now+1}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('workflow',{status:'waiting',waitingForDemandVerified:true}),p,now).state,'quiet');
 assert.equal(evaluatePlatform(sample('queue',{depth:0,available:false}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('queue',{depth:0,observedAt:now-60001}),p,now).state,'unknown');
 assert.equal(evaluatePlatform(sample('queue',{depth:3,maintenance:true,maintenanceVerified:true}),p,now).state,'maintenance');
});
test('shared dependency failures yield one firing, counts per sensor and recovery only from complete healthy evidence',()=>{
 const id='a'.repeat(64),firing=[{kind:'dependency',state:'firing'},{kind:'queue',state:'firing'}];
 const a=correlatePlatform(null,firing,{complete:true,observedAt:now,episodeId:id});assert.equal(a.transition,'firing');assert.equal(a.state.counts.queue,1);
 assert.throws(()=>correlatePlatform(a.state,firing,{complete:true,observedAt:now+1,episodeId:'b'.repeat(64)}),/identity_mismatch/);
 const b=correlatePlatform(a.state,firing,{complete:true,observedAt:now+1,episodeId:id});assert.equal(b.transition,null);assert.equal(b.state.repeats,2);
 const unknown=correlatePlatform(b.state,[{kind:'dependency',state:'unknown'}],{complete:true,observedAt:now+2,episodeId:id});assert.equal(unknown.state.open,true);
 const green=[{kind:'dependency',state:'healthy'},{kind:'queue',state:'healthy'}];
 assert.equal(correlatePlatform(unknown.state,green,{complete:false,observedAt:now+3,episodeId:id}).state.open,true);
 const recovered=correlatePlatform(unknown.state,green,{complete:true,observedAt:now+4,episodeId:id});assert.equal(recovered.transition,'recovery');
 assert.equal(correlatePlatform(recovered.state,firing,{complete:true,observedAt:now,episodeId:id}).state.open,false);
});
