/** D7909: real S09 supervisor/catalog/plans, private state, RSA/SQLite delivery; engine/provider/runtime facts are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture as capacityFixture, config, submission, token, claims, options, unlock, REPO, SOURCE, EXEC, SHARDS } from './ci_capacity_fixture_7909.mjs';
import { main as bridge, resultStore, supervisorResult } from '../../scripts/ci/capacity-executor.mjs';
import { JobContainer, containerIsolationAdapter } from '../../scripts/ci/runners/job-container.mjs';
import { recoveryStore } from '../../scripts/ci/runners/recovery-store.mjs';
import { createTraceExporter } from '../../scripts/ci/runners/trace-exporter.mjs';
import { trustedAuthority } from '../../scripts/ci/executor-authority.mjs';
import * as client from '../../scripts/ci/capacity-client.mjs';
import { ownedPaths } from '../../scripts/ci/runner-execution.mjs';
import { buildPlan } from '../../scripts/test-drift-parts.mjs';
import { SqlCapacityStore } from '../../merge-control/src/ciCapacity.ts';
function fixture(t){
 t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
 // The real supervisor derives the earlier Run-wrapper bound from process start, on the same clock.
 t.mock.getter(performance,'timeOrigin',()=>1_800_000_000_000);
 return capacityFixture(t,{callbackResults:true,clockInstalled:true});
}
const CID='c'.repeat(64),POLICY={version:1,image:'sha256:'+'d'.repeat(64),nodeVersion:'22.23.3',pythonVersion:'3.11.18'};
function archive(){
 const name='traces/1-1800000000000.trace.json',bytes=Buffer.from('{}'),h=Buffer.alloc(512);
 h.write(name);for(const [at,n,width] of [[100,0o600,8],[108,10000,8],[116,10000,8],[124,bytes.length,12],[136,0,12]])h.write(n.toString(8).padStart(width-1,'0')+'\0',at);
 h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);h.write('00',263);const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
 return Buffer.concat([h,bytes,Buffer.alloc(512-bytes.length),Buffer.alloc(1024)]);
}
function engineFixture(exit=0){
 let info=null,removed=false;const control={failRemoval:false,starts:0,calls:[]};
 const engine=args=>{
  control.calls.push(args);const value=k=>args[args.indexOf(k)+1],all=k=>args.flatMap((v,i)=>v===k?[args[i+1]]:[]);
  if(args[0]==='create'){
   const owner=value('--label').split('=')[1];info={Id:CID,Name:'/studioos-job-'+owner,Image:POLICY.image,State:{Running:true,Pid:123},Config:{User:value('--user'),Labels:{'vc.axal.studioos.job':owner},Entrypoint:[value('--entrypoint')],Cmd:args.slice(-2),Env:all('--env')},HostConfig:{Privileged:false,Init:true,ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:null,SecurityOpt:['no-new-privileges'],PidMode:'',IpcMode:'private',CgroupnsMode:'private',NetworkMode:'bridge',PortBindings:{},Devices:[],DeviceRequests:null,VolumesFrom:null,ExtraHosts:null,Links:null,PidsLimit:256,Memory:4294967296,NanoCpus:2e9,Tmpfs:Object.fromEntries(all('--tmpfs').map(v=>[v.slice(0,v.indexOf(':')),v.slice(v.indexOf(':')+1)]))},Mounts:all('--mount').map(v=>({Type:'bind',Source:/src=([^,]+)/.exec(v)[1],Destination:/dst=([^,]+)/.exec(v)[1],RW:false,Propagation:'rprivate'}))};if(control.loseCreateAck)throw Error('fixture create acknowledgement lost');return CID+'\n';
  }
  if(args[0]==='inspect'){if(removed)throw Error('No such object: '+CID);return JSON.stringify([control.intentConflict&&args.includes('--type')?{...info,Name:'/foreign-container'}:info]);}
  if(args[0]==='rm'){if(control.failRemoval)throw Error('fixture unavailable');removed=true;return '';}
  if(args[0]==='exec'&&args.includes('-e'))return 'readable';
  if(args[0]==='exec'&&args.includes('/usr/local/bin/node'))return '22.23.3\n';
  if(args[0]==='exec'&&args.includes('/usr/local/bin/python3'))return '3.11.18\n';
  return '';
 };
 const job=new JobContainer(POLICY,{engine,stage:()=>{},namespace:()=>true,spawnEngine:args=>{
  const forwarded=args.flatMap((v,i)=>v==='--env'?[args[i+1]]:[]);assert.equal(forwarded.some(v=>/TOKEN|CAPACITY|OIDC/.test(v)),false);
  control.starts++;const child=cp.spawn('/bin/sh',['-c',args.at(-1).includes('npm ci')?'exit 0':`exit ${exit}`],{env:{PATH:'/usr/bin:/bin'},stdio:'ignore'});if(!args.at(-1).includes('npm ci'))child.once('close',()=>control.onTestExit?.());return child;
 }});
 const spawnCopy=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};queueMicrotask(()=>{child.stdout.write(archive());child.stdout.end();child.emit('close',0);});return child;};
 return {job,engine,control,spawnCopy};
}
async function setup(t,{exit=0,lost=false,cleanupFailure=false,long=false,skipExport=false}={}){
 const f=fixture(t,{callbackResults:true}),startedAt=Date.now();t.mock.method(globalThis,'fetch',async(input,init)=>{const response=await f.fetcher(input,init);if(String(input).includes('/actions/runs/100/')&&String(input).includes('/jobs')){const value=await response.json();for(const job of value.jobs)job.started_at=new Date(startedAt).toISOString();return Response.json(value);}return response;});
 f.env.CAPACITY_CONFIG=JSON.stringify({...config,maxExternalWorkerShards:1});f.restart();
 f.runners.push({id:5,os:'linux',status:'online',busy:false,labels:['self-hosted','Linux','X64','studioos-worker-v1'].map(name=>({name}))});
 await unlock(f);const scripts=JSON.parse(fs.readFileSync('package.json','utf8')).scripts,bytes=JSON.stringify(buildPlan(scripts,{},process.cwd()),null,2)+'\n';
 const s={...submission(),planDigest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};await client.submitCapacity(s,{...options(f.clientFetch),enabled:true,plan:bytes});await f.tick();await f.tick();
 const root=fs.mkdtempSync(join(tmpdir(),'composed-7909-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(join(root,'temp'));fs.mkdirSync(join(root,'work'));
 const env={GITHUB_REPOSITORY:REPO,GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:EXEC,EXECUTOR_SHA:EXEC,CHILD_WORKFLOW_SHA:EXEC,RUNNER_TEMP:join(root,'temp'),GITHUB_WORKSPACE:join(root,'work'),GITHUB_OUTPUT:join(root,'admitted'),GH_TOKEN:'fixture-read-only',REQUEST_ID:s.requestId,LEASE_GENERATION:'1',PART:SHARDS[0],PROFILE:'linux-x64',CI_CAPACITY_URL:'https://capacity.invalid',CI_CAPACITY_AUDIENCE:'fixture-capacity'};
 const signed=()=>token({...claims(100),check_run_id:'1100',runner_environment:'self-hosted'});
 const baseAuthority=await trustedAuthority(env,{loadClient:async()=>({...client,githubOidcToken:()=>async()=>signed(),createReceiptReader:opts=>client.createReceiptReader({...opts,fetcher:f.clientFetch})})});
 const transcript=[],authority={...baseAuthority,readReceipt:async args=>{transcript.push({at:Date.now(),kind:'receipt',phase:args.phase});return baseAuthority.readReceipt(args);}};
 const e=engineFixture(exit);e.control.failRemoval=cleanupFailure;if(long)e.control.onTestExit=()=>t.mock.timers.setTime(startedAt+24*60_000);if(skipExport)e.control.onTestExit=()=>t.mock.timers.setTime(new SqlCapacityStore(f.storage).get(s.requestId).shards[0].attempts[0].executionDeadline-59_000);
 const paths=ownedPaths({runnerTemp:env.RUNNER_TEMP,workspace:env.GITHUB_WORKSPACE,childRunId:100,childAttempt:1});
 const store=recoveryStore({root:join(root,'ownership'),create:true}),results=resultStore(join(root,'results'),100);let reports=0;
 const ports={authority,store,results,isolation:{job:e.job,admissionIsolation:async()=>true,executionIsolation:containerIsolationAdapter(e.job)},recover:r=>JobContainer.recover(r,{engine:e.engine}),verifyRemoved:r=>JobContainer.isRemoved(r,{engine:e.engine}),recoverIntent:i=>JobContainer.recoverIntent(i,{engine:e.engine}),
  exporter:createTraceExporter({stagingRoot:join(paths.temp,'trace-export'),engine:e.engine,spawnCopy:e.spawnCopy}),report:async(receipt,result)=>{transcript.push({at:Date.now(),kind:'result'});reports++;const answer=await client.reportExecutionResult(receipt,result,{...options(f.clientFetch),oidcToken:async()=>signed()});if(lost&&reports===1)throw Error('fixture acknowledgement lost');return answer;}};
 await bridge('prepare',env,ports);fs.symlinkSync(process.cwd(),paths.source,'dir');fs.mkdirSync(join(paths.temp,'parent-plan'));fs.writeFileSync(join(paths.temp,'parent-plan','suite-plan.json'),bytes);
 assert.equal(await bridge('admit',env,ports),0);env.ADMITTED_JSON=fs.readFileSync(env.GITHUB_OUTPUT,'utf8').split('\n').find(l=>l.startsWith('admitted_json=')).slice(14);
 // Explicit synthetic native version/checkout facts. Actual SQLite, supervisor, engine checks, fs and child processes execute.
 const version=Object.getOwnPropertyDescriptor(process.versions,'node');Object.defineProperty(process.versions,'node',{...version,value:'22.23.3'});
 const mock=t.mock.method(cp,'execFileSync',(command,args)=>{if(command==='python3')return 'x86_64\n3.11.18\n3.45.0\n';if(command==='git'&&args[0]==='rev-parse')return SOURCE+'\n';throw Error('unexpected fixture native operation');});syncBuiltinESMExports();
 t.after(()=>{mock.mock.restore();syncBuiltinESMExports();Object.defineProperty(process.versions,'node',version);});
 assert.equal(await bridge('verify-plan',env,ports),0);
 return {f,s,env,ports,e,results,store,root,transcript,reports:()=>reports};
}
for(const outcome of ['success','failure','lost','cleanup'])test(`D7909 exact composed S09 bridge ${outcome}: actual supervisor, verified receipts, durable authenticated result`,async t=>{
 const x=await setup(t,{exit:outcome==='success'?0:9,lost:outcome==='lost',cleanupFailure:outcome==='cleanup'});
 if(outcome==='lost'){await assert.rejects(bridge('run',x.env,x.ports),/acknowledgement lost/);await assert.rejects(bridge('run',x.env,x.ports),/already_recorded/);}else assert.equal(await bridge('run',x.env,x.ports),outcome==='success'?0:9);
 const before=x.results.read();assert.equal(before.result.testStep,outcome==='success'?'success':'failure');assert.equal(before.result.exportComplete,true);assert.equal(before.result.cleanupConfirmed,outcome!=='cleanup');
 assert.equal(x.e.control.starts,2);assert.equal(x.store.list().length,outcome==='cleanup'?1:0);
 if(outcome==='cleanup')x.e.control.failRemoval=false;
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null,'acknowledged verified cleanup retires the local journal');assert.equal(x.store.list().length,0);
 assert.equal(x.reports(),outcome==='lost'||outcome==='cleanup'?2:1);
 x.f.result(outcome==='success'?'success':'failure');await x.f.tick();
 const a=new SqlCapacityStore(x.f.storage).get(x.s.requestId).shards[0].attempts[0];assert.equal(a.phase,outcome==='success'?'passed':'failed');
 const row=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(row.receipt.planDigest,x.s.planDigest);assert.equal(row.jobId,1100);
 assert.equal(row.testStep,outcome==='success'?'success':'failure');assert.equal(row.cleanupConfirmed,true);
 const budget=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_auth_budget').toArray()[0].state);const own=budget.lanes.receipt.callers.find(([key])=>key==='7/100/1');assert.ok(own[1]<=12);
});

test('D7909 supervisor mapping refuses missing export, inconsistent failure and late success',()=>{
 const values={category:'success',result:'success',test_exit:'0',cleanup:'complete',export:'complete'},proof={observedTest:{status:'success',exitCode:0},removed:true,exportedAt:10,exportDeadline:20,receiptDeadline:100,now:()=>30};
 assert.equal(supervisorResult(values,proof).testStep,'success');
 for(const change of [{export:'not_configured'},{cleanup:'none'},{test_exit:'9'},{category:'test_failure'}])assert.throws(()=>supervisorResult({...values,...change},proof));
 assert.throws(()=>supervisorResult(values,{...proof,removed:false}));assert.throws(()=>supervisorResult(values,{...proof,exportedAt:20}));assert.equal(supervisorResult(values,{...proof,receiptDeadline:30}).executionOutcome,'timed_out');
 const failed={category:'test_failure',result:'test_failure',test_exit:'9',cleanup:'failed',export:'failed'};
 assert.deepEqual(supervisorResult(failed,{observedTest:{status:'failure',exitCode:9},removed:false}),{testStep:'failure',executionOutcome:'cleanup_failure',cleanupConfirmed:false,exportComplete:false});
 assert.deepEqual(supervisorResult({category:'infrastructure',result:'infrastructure',test_exit:'',cleanup:'unknown',export:'not_run'},{observedCaptured:true}),{testStep:'unknown',executionOutcome:'cleanup_failure',cleanupConfirmed:false,exportComplete:false});
});

test('D7909 24-minute phase transcript stays inside unchanged per-child and shared admission bounds',async t=>{
 const x=await setup(t,{long:true});assert.equal(await bridge('run',x.env,x.ports),0);assert.equal(await bridge('cleanup',x.env,x.ports),0);
 assert.equal(x.transcript.filter(e=>e.kind==='receipt').length,10);assert.equal(x.transcript.filter(e=>e.kind==='result').length,1);
 const minute0=x.transcript.filter(e=>e.at===1_800_000_000_000);assert.equal(minute0.length,10);assert.ok(6*minute0.length<=96);
 assert.equal(x.transcript.at(-1).at,1_800_000_000_000+24*60_000);
 console.log('D7909_RECEIPT_CADENCE '+JSON.stringify({periodicPolling:'none; admission and phase boundaries only',transcript:x.transcript,perCallerCeiling:12,sharedCeiling:96,sixConcurrentCallerPhaseReservations:60}));
});

test('D7909 listener journal survives more than 128 completed runs and updates retained evidence at capacity',t=>{
 const root=fs.mkdtempSync(join(tmpdir(),'journal-7909-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const row=(run,complete=false)=>{const result={testStep:'failure',executionOutcome:'cleanup_failure',cleanupConfirmed:complete,exportComplete:false};return {receipt:{childRunId:run,childAttempt:1},removed:complete,result,ack:complete?JSON.stringify(result):null};};
 for(let run=1;run<=140;run++)resultStore(root,run).write(row(run,true));
 assert.ok(fs.readdirSync(root).length<=2,'completed cleanup acknowledgements are bounded across jobs');
 resultStore(root,141);assert.equal(fs.readdirSync(root).length,0);
 for(let run=1;run<=128;run++)resultStore(root,run).write(row(run));
 assert.equal(fs.readdirSync(root).length,128);const existing=resultStore(root,1);existing.write({...existing.read(),marker:'retained update'});assert.equal(existing.read().marker,'retained update');
 assert.throws(()=>resultStore(root,129).write(row(129)),/state_bound/);
 assert.equal(existing.retire(),false);existing.write({...row(1,true),ack:null});assert.equal(existing.retire(),false,'cleanup alone is not delivery acknowledgement');
 existing.write({...row(1,true),ack:JSON.stringify(row(1).result)});assert.equal(existing.retire(),false,'an older acknowledgement cannot cover changed cleanup truth');
 existing.write(row(1,true));assert.equal(existing.retire(),true);assert.equal(fs.readdirSync(root).length,127);
 resultStore(root,129).write(row(129));assert.equal(fs.readdirSync(root).length,128);
});

test('D7909 genuine test failure is durable and delivered when S09 skips export for lack of budget',async t=>{
 const x=await setup(t,{exit:9,skipExport:true});let exports=0;const exporter=x.ports.exporter;x.ports.exporter=args=>{exports++;return exporter(args);};
 assert.equal(await bridge('run',x.env,x.ports),9);assert.equal(exports,0);
 const state=x.results.read();assert.equal(state.result.testStep,'failure');assert.equal(state.result.exportComplete,false);assert.equal(state.result.cleanupConfirmed,true);
 const stored=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(stored.testStep,'failure');assert.equal(stored.exportComplete,false);
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
});

test('D7909 conflicting ambiguous creation retains its durable intent without cleanup proof',async t=>{
 const x=await setup(t);x.e.control.loseCreateAck=true;x.e.control.intentConflict=true;
 assert.equal(await bridge('run',x.env,x.ports),1);assert.equal(x.e.control.starts,0);assert.equal(x.store.list().length,1);assert.ok(x.store.list()[0].intent);
 const row=x.results.read();assert.equal(row.removed,false);assert.equal(row.container,null);assert.equal(row.result.cleanupConfirmed,false);assert.equal(row.result.testStep,'unknown');
 assert.equal(x.e.control.calls.filter(args=>args[0]==='rm').length,0);
 await assert.rejects(bridge('cleanup',x.env,x.ports),/recovery_retained/);assert.notEqual(x.results.read(),null,'acknowledgement cannot retire uncertain creation');
 x.f.result('failure');await x.f.tick();const a=new SqlCapacityStore(x.f.storage).get(x.s.requestId).shards[0].attempts[0];assert.equal(a.generation,1);assert.ok(['cancelling','cancellation_unknown'].includes(a.phase));
 x.e.control.intentConflict=false;assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);assert.equal(x.store.list().length,0);
 const delivered=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(delivered.cleanupConfirmed,true);assert.notEqual(delivered.testStep,'success');
});

test('D7909 observed negative truth survives a supervisor-loss boundary before typed output or export',async t=>{
 const x=await setup(t,{exit:9}),native=(await import('../../scripts/ci/runner-execution.mjs')).main;
 x.ports.execute=async(mode,env,deps)=>{
  if(mode!=='run')return native(mode,env,deps);
  const admitted=JSON.parse(env.ADMITTED_JSON),receipt=admitted.identity,context={repository:REPO,executorSha:EXEC,childWorkflowSha:EXEC,childRunId:100,childAttempt:1};
  await deps.readReceipt({request:{requestId:receipt.requestId,shard:receipt.logicalShard,generation:1,profile:'linux-x64'},context,phase:'execute'});
  const paths=ownedPaths({runnerTemp:env.RUNNER_TEMP,workspace:env.GITHUB_WORKSPACE,childRunId:100,childAttempt:1});
  deps.job.onOwned=r=>deps.store.write(r);await deps.job.create(receipt,{source:paths.source,plan:join(paths.temp,'suite-plan.json')});
  assert.equal((await deps.job.runCandidateInterruptible({receipt,admitted,phase:'test'})).exitCode,9);
  throw Error('fixture supervisor lost before output');
 };
 await assert.rejects(bridge('run',x.env,x.ports),/supervisor lost/);assert.equal(x.reports(),0);
 assert.equal(x.results.read().result.testStep,'failure');assert.equal(x.results.read().result.cleanupConfirmed,false);assert.equal(x.store.list().length,1);
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
 const row=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(row.testStep,'failure');assert.equal(row.cleanupConfirmed,true);assert.equal(row.exportComplete,false);
});

for(const fault of ['after-phase-save','bad-output'])test(`D7909 captured negative survives ${fault} metadata failure`,async t=>{
 const x=await setup(t,{exit:9});let injected=false;
 if(fault==='after-phase-save'){
  const write=x.results.write;x.ports.results={...x.results,write(row){write(row);if(!injected&&row.result?.testStep==='failure'&&row.removed===false){injected=true;throw Error('fixture failure after phase journal persistence');}}};
 }else{
  const execute=(await import('../../scripts/ci/runner-execution.mjs')).main;
  x.ports.execute=async(mode,env,deps)=>{const code=await execute(mode,env,deps);if(mode==='run'){injected=true;fs.writeFileSync(env.GITHUB_OUTPUT,'unreadable-typed-output');}return code;};
 }
 const code=await bridge('run',x.env,x.ports);assert.equal(injected,true);assert.notEqual(code,0);
 assert.equal(x.results.read().result.testStep,'failure');assert.equal(x.results.read().observedTest.exitCode,9);
 const row=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(row.testStep,'failure');
 assert.equal(new SqlCapacityStore(x.f.storage).get(x.s.requestId).shards[0].attempts[0].verifiedTestFailure,true);
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
});

test('D7909 an unacknowledged failure journal blocks a second Run before the authority has received it',async t=>{
 const x=await setup(t,{exit:9});x.ports.report=async()=>{throw Error('fixture offline before authority');};
 await assert.rejects(bridge('run',x.env,x.ports),/offline before authority/);
 assert.equal(x.results.read().result.testStep,'failure');assert.equal(x.f.storage.sql.exec('SELECT COUNT(*) AS n FROM capacity_execution_results').toArray()[0].n,0);
 await assert.rejects(bridge('run',x.env,x.ports),/already_recorded/);assert.equal(x.e.control.starts,2);
 assert.equal(x.results.read().result.testStep,'failure');
});


test('D7909 lost create acknowledgement may confirm cleanup only through exact reconciliation and removal',async t=>{
 const x=await setup(t);x.e.control.loseCreateAck=true;
 assert.equal(await bridge('run',x.env,x.ports),1);assert.equal(x.e.control.starts,0);
 const row=x.results.read();assert.equal(row.container.id,CID);assert.equal(row.removed,true);assert.equal(row.result.cleanupConfirmed,true);assert.notEqual(row.result.testStep,'success');
 assert.equal(x.e.control.calls.filter(args=>args[0]==='rm').length,1);assert.equal(x.store.list().length,0);
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
});


for(const exit of [0,9])test(`D7909 durable cleanup tail past the receipt preserves test exit ${exit} without success`,async t=>{
 const x=await setup(t,{exit}),remove=x.store.remove;
 x.ports.store={...x.store,remove(owner){remove(owner);const receipt=x.results.read().receipt;t.mock.timers.setTime(receipt.executionDeadline+60_000);}};
 assert.equal(await bridge('run',x.env,x.ports),exit===9?9:1);
 const row=x.results.read();assert.equal(row.result.testStep,exit===9?'failure':'success');assert.equal(row.result.executionOutcome,exit===9?'completed':'timed_out');assert.equal(row.result.cleanupConfirmed,true);
 const stored=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(stored.executionOutcome,row.result.executionOutcome);assert.equal(stored.testStep,row.result.testStep);
 x.f.result(exit===9?'failure':'success');await x.f.tick();assert.notEqual(x.f.checks[0].conclusion,'success');
});


for(const tail of ['after-supervisor','journal-write','delivery'])for(const exit of [0,9])test(`D7909 ${tail} respects the persisted earlier Run bound while preserving test exit ${exit}`,async t=>{
 const x=await setup(t,{exit}),start=Date.now(),deadline=start-120_000+26*60_000-5_000;
 t.mock.getter(performance,'timeOrigin',()=>start-120_000);
 let injected=false;
 if(tail==='after-supervisor'){
  const execute=(await import('../../scripts/ci/runner-execution.mjs')).main;
  x.ports.execute=async(mode,env,deps)=>{const code=await execute(mode,env,deps);if(mode==='run'){injected=true;t.mock.timers.setTime(deadline+1);}return code;};
 }else if(tail==='journal-write'){
  const write=x.results.write;x.ports.results={...x.results,write(row){write(row);if(!injected&&row.removed===true&&row.result?.executionOutcome==='completed'){injected=true;t.mock.timers.setTime(deadline+1);}}};
 }else{
  const report=x.ports.report;x.ports.report=async(...args)=>{const result=await report(...args);if(!injected){injected=true;t.mock.timers.setTime(deadline+1);}return result;};
 }
 assert.equal(await bridge('run',x.env,x.ports),exit===9?9:124);assert.equal(injected,true);
 const journal=x.results.read();assert.equal(journal.completionDeadline,deadline);assert.ok(Date.now()<journal.receipt.executionDeadline,'receipt still live; the earlier step bound is decisive');
 assert.equal(journal.result.testStep,exit===9?'failure':'success');assert.equal(journal.result.executionOutcome,exit===9?'completed':'timed_out');
 if(tail==='delivery'&&exit===0)assert.notEqual(journal.ack,JSON.stringify(journal.result),'late ACK cannot acknowledge the timeout correction');
 // New cleanup process origin cannot extend the recorded Run deadline. It sends any pending correction.
 t.mock.getter(performance,'timeOrigin',()=>Date.now());assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
 const row=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(row.testStep,exit===9?'failure':'success');assert.equal(row.executionOutcome,exit===9?'completed':'timed_out');
 x.f.result(exit===9?'failure':'success');await x.f.tick();assert.notEqual(x.f.checks[0].conclusion,'success');
});

test('D7909 cleanup after a lost positive delivery cannot reopen the earlier recorded Run deadline',async t=>{
 const x=await setup(t),start=Date.now(),deadline=start-120_000+26*60_000-5_000,report=x.ports.report;
 t.mock.getter(performance,'timeOrigin',()=>start-120_000);
 x.ports.report=async()=>{throw Error('fixture lost delivery before ACK');};
 await assert.rejects(bridge('run',x.env,x.ports),/lost delivery/);
 assert.equal(x.results.read().result.executionOutcome,'completed');assert.equal(x.results.read().ack,null);
 t.mock.timers.setTime(deadline+1);t.mock.getter(performance,'timeOrigin',()=>Date.now());x.ports.report=report;
 assert.equal(await bridge('cleanup',x.env,x.ports),0);assert.equal(x.results.read(),null);
 const row=JSON.parse(x.f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);assert.equal(row.testStep,'success');assert.equal(row.executionOutcome,'timed_out');assert.equal(row.cleanupConfirmed,true);
});
