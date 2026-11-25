/** D7909: real ingress/RSA/SQLite/planner/core plus local processes; provider/isolation facts remain synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse as yaml } from 'yaml';
import { fixture, REPO, PREFIX, EXEC, SOURCE, config, claims, token, options, unlock, submission, plan } from './ci_capacity_fixture_7909.mjs';
import { capacityInventoryClient, capacityGithubClient } from '../../merge-control/src/ciCapacityGithub.ts';
import { SqlCapacityStore } from '../../merge-control/src/ciCapacity.ts';
import { main as plannerMain, plannerFile } from '../../scripts/ci/capacity-planner.mjs';
import { capacitySubmission, PILOT_PREREQUISITES } from '../../scripts/ci/capacity-submission.mjs';
import { createReceiptReader, submitCapacity, reportExecutionResult } from '../../scripts/ci/capacity-client.mjs';
import { trustedAuthority } from '../../scripts/ci/executor-authority.mjs';
import { admitRunnerJob } from '../../scripts/ci/runner-admission.mjs';
import { executeShard, ownedPaths, prepareOwned } from '../../scripts/ci/runner-execution.mjs';
import { buildPlan } from '../../scripts/test-drift-parts.mjs';
const { default: worker } = await import('../../merge-control/src/index.ts');

function candidate(t){
 const dir=mkdtempSync(join(tmpdir(),'s39-pilot-7909-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=join(dir,'candidate');
 for(const [folder,count] of [['frontend/test',2],['cloudflare-worker/test',6]]){
  mkdirSync(join(root,folder),{recursive:true});for(let i=1;i<=count;i++)writeFileSync(join(root,folder,`${i}.test.mjs`),'// local fixture suite member\n');
 }
 const scripts={'test:frontend':"node --test 'frontend/test/*.test.mjs'",'test:worker':"node --test 'cloudflare-worker/test/*.test.mjs'",'test:drift':'npm run test:frontend && npm run test:worker'};
 writeFileSync(join(root,'package.json'),JSON.stringify({scripts}));
 const plan=JSON.stringify(buildPlan(scripts,{},root),null,2)+'\n',planPath=join(dir,'suite-plan.json'),eventPath=join(dir,'event.json');
 writeFileSync(planPath,plan);writeFileSync(eventPath,'{}');
 return {dir,root,plan,planPath,eventPath};
}
function enabledEnv(c){return {CI_CAPACITY_ENABLED:'true',GITHUB_REPOSITORY:REPO,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',
 GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:SOURCE,CI_CAPACITY_EXECUTOR_SHA:EXEC,CAPACITY_PLAN_ARTIFACT_ID:'45',CAPACITY_PLAN_FILE:c.planPath};}

test('D7909 ingress is independently default-off and owner/caller auth cannot cross routes',async t=>{
 const f=fixture(t);let lookups=0;f.env.CAPACITY_CONTROL={getByName(){lookups++;return f.control();}};
 f.env.CAPACITY_ENABLED='false';
 assert.equal((await f.clientFetch('https://capacity.invalid/capacity/submit',{method:'POST'})).status,503);
 assert.equal(lookups,0);
 f.env.CAPACITY_ENABLED='true';
 assert.equal((await f.clientFetch('https://capacity.invalid/capacity/submit',{method:'POST'})).status,401);
 assert.equal((await f.clientFetch('https://capacity.invalid/capacity/status',{headers:{authorization:'Bearer '+token()}})).status,401);
 assert.equal((await f.clientFetch('https://capacity.invalid/capacity/not-a-route',{method:'POST'})).status,404);
 assert.equal(lookups,0);
 const status=await f.clientFetch('https://capacity.invalid/capacity/status',{headers:{authorization:'Bearer fixture-owner'}});
 assert.equal(status.status,200);assert.equal((await status.json()).enabled,false);assert.equal(lookups,1);
 assert.equal((await worker.fetch(new Request('https://capacity.invalid/status'),f.env)).status,401);
});

test('D7909 bounded metadata is stable per parent attempt and never acquires OIDC or waits',async t=>{
 const f=fixture(t),c=candidate(t),env=enabledEnv(c);
 assert.deepEqual(await capacitySubmission({},async()=>assert.fail('disabled metadata must not call GitHub')),{accepted:false,reason:'capacity_disabled'});
 const first=await capacitySubmission(env,f.api),again=await capacitySubmission(env,f.api);
 assert.deepEqual(first,again);assert.equal(first.planDigest,'sha256:'+createHash('sha256').update(c.plan).digest('hex'));
 assert.deepEqual(first.prerequisites,PILOT_PREREQUISITES);assert.equal(first.shards.length,6);
 for(const patch of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'merge_group'},{GITHUB_REF:'refs/heads/other'},{CAPACITY_PLAN_ARTIFACT_ID:'0'},{GITHUB_RUN_ATTEMPT:'2'}]){
  await assert.rejects(capacitySubmission({...env,...patch},f.api),/context|parent/);
 }
 assert.equal(f.calls.every(call=>call.method==='GET'&&call.path===PREFIX+'/actions/runs/12'),true);
});

test('D7909 local planner reads reject actual oversize bytes, symlinks and non-files',async t=>{
 const c=candidate(t),oversize=join(c.dir,'too-large');writeFileSync(oversize,'12345');
 assert.throws(()=>plannerFile(oversize,4),/file_bound/);
 const link=join(c.dir,'link');symlinkSync(oversize,link);assert.throws(()=>plannerFile(link,10),/ELOOP/);
 assert.throws(()=>plannerFile(c.dir,1_000_000),/file_bound/);assert.equal(plannerFile(oversize,5),'12345');
 const fs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module');
 const growth=join(c.dir,'growth');writeFileSync(growth,'1234');let first=true;const nativeRead=fs.readSync;
 const patched=t.mock.method(fs,'readSync',(...args)=>{if(first){first=false;writeFileSync(growth,'12345');}return nativeRead(...args);});
 try{syncBuiltinESMExports();assert.throws(()=>plannerFile(growth,4),/file_bound/);}finally{patched.mock.restore();syncBuiltinESMExports();}
});

test('D7909 inventory has a separate bounded read-only credential and repo App cannot request org scope',async t=>{
 assert.throws(()=>capacityInventoryClient({REPOSITORY:REPO}),/unconfigured/);
 const calls=[],read=capacityInventoryClient({REPOSITORY:REPO,CAPACITY_INVENTORY_TOKEN:'fixture-inventory'},async(url,init)=>{calls.push({url:String(url),init});return Response.json({ok:true});});
 const base='/orgs/AxalNetwork/actions/runner-groups/5';
 for(const path of [base,base+'/repositories?per_page=100&page=1',base+'/runners?per_page=100&page=3'])await read('GET',path);
 assert.equal(calls.length,3);assert.equal(calls.every(c=>c.init.headers.Authorization==='Bearer fixture-inventory'&&c.init.signal instanceof AbortSignal),true);
 for(const [method,path] of [['POST',base],['GET',base+'/runners?per_page=100&page=4'],['GET',base.replace('/5','/6')],['GET',PREFIX+'/actions/runs/12']]){
  await assert.rejects(read(method,path),/scope/);
 }
 assert.equal(calls.length,3);
 assert.equal(calls.every(c=>c.url.startsWith('https://api.github.com/orgs/AxalNetwork/actions/runner-groups/5')),true);
 const capped=capacityInventoryClient({REPOSITORY:REPO,CAPACITY_INVENTORY_TOKEN:'fixture-inventory'},async()=>Response.json({ok:true}));
 for(let i=0;i<7;i++)await capped('GET',base);await assert.rejects(capped('GET',base),/scope/);
 t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
 const expired=capacityInventoryClient({REPOSITORY:REPO,CAPACITY_INVENTORY_TOKEN:'fixture-inventory'},async()=>assert.fail('expired inventory must not fetch'));
 t.mock.timers.setTime(Date.now()+30_000);await assert.rejects(expired('GET',base),/scope/);
 const fakes=await import('./ci_capacity_fixture_7909.mjs');let permission;
 const api=await capacityGithubClient({REPOSITORY:REPO,GITHUB_APP_ID:'23',GITHUB_INSTALLATION_ID:'2',GITHUB_APP_PRIVATE_KEY:fakes.privateKey.export({format:'pem',type:'pkcs8'}).toString()},async(_url,init)=>{permission=JSON.parse(init.body);return Response.json({token:'fixture-repo-only'});});
 assert.deepEqual(permission.permissions,{actions:'write',checks:'write',contents:'read'});
 await assert.rejects(api('GET',base),/path/);
});

test('D7909 planner and executor pins are independent while candidate planners remain refused',async t=>{
 const f=fixture(t),c=candidate(t),plannerSha='c'.repeat(40);
 f.env.CAPACITY_CONFIG=JSON.stringify({...config,plannerSha});f.restart();t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 const env={...enabledEnv(c),CAPACITY_SOURCE_ROOT:c.root,GITHUB_EVENT_PATH:c.eventPath,CAPACITY_EXECUTOR_SHA:EXEC,CI_CAPACITY_URL:'https://capacity.invalid',CI_CAPACITY_AUDIENCE:'fixture-capacity'};
 const s={...await capacitySubmission(env,f.api),prerequisites:['fast']};env.CAPACITY_SUBMISSION=JSON.stringify(s);
 await assert.rejects(plannerMain(env,{...options(f.clientFetch),oidcToken:async()=>token()}),/unavailable/);
 const trusted={...claims(),job_workflow_ref:`${REPO}/.github/workflows/capacity-planner.yml@${plannerSha}`,job_workflow_sha:plannerSha};
 assert.equal((await plannerMain(env,{...options(f.clientFetch),oidcToken:async()=>token(trusted)})).accepted,true);
 assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/dispatches')).length,0,'submission must not wait or dispatch inline');
 assert.notEqual(f.alarm(),null);
});

for(const outcome of ['success','failure','incomplete','revoked'])test(`D7909 composed pilot ${outcome}: submission, two Linux/four hosted allocation, execution, receipts and reporting`,async t=>{
 const f=fixture(t,{callbackResults:true}),c=candidate(t);t.mock.method(globalThis,'fetch',f.fetcher);
 f.env.CAPACITY_CONFIG=JSON.stringify({...config,maxExternalWorkerShards:2,prerequisiteJobs:[...PILOT_PREREQUISITES]});f.restart();
 for(let i=0;i<2;i++)f.runners.push({id:5+i,os:'linux',status:'online',busy:false,labels:['self-hosted','Linux','X64','studioos-worker-v1'].map(name=>({name}))});
 for(const [i,name] of PILOT_PREREQUISITES.entries())f.parentJobs.push({id:20+i,name,run_id:12,run_attempt:1,head_sha:SOURCE,status:'completed',conclusion:'success'});
 await unlock(f);
 const env={...enabledEnv(c),CAPACITY_SOURCE_ROOT:c.root,GITHUB_EVENT_PATH:c.eventPath,CAPACITY_EXECUTOR_SHA:EXEC,CI_CAPACITY_URL:'https://capacity.invalid',CI_CAPACITY_AUDIENCE:'fixture-capacity'};
 const s=await capacitySubmission(env,f.api);env.CAPACITY_SUBMISSION=JSON.stringify(s);
 assert.equal((await plannerMain(env,options(f.clientFetch))).accepted,true);
 assert.equal(f.children.size,0,'no hosted waiting or dispatch during submit');
 await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),request=store.get(s.requestId),attempts=request.shards.map(shard=>shard.attempts[0]);
 assert.deepEqual(attempts.map(a=>a.profile),['linux-x64','linux-x64','hosted','hosted','hosted','hosted']);
 assert.equal(f.checks[0].status,'in_progress');
 const client=await import('../../scripts/ci/capacity-client.mjs');
 const admitted=[];
 for(const a of attempts){
  // Provider OIDC acquisition and native isolation are explicitly synthetic trusted ports here.
  // The actual S09 authority module, catalog, reader, admission and coordinator checks run unchanged.
  const authority=await trustedAuthority({CI_CAPACITY_URL:'https://capacity.invalid',CI_CAPACITY_AUDIENCE:'fixture-capacity'},
   {loadClient:async()=>({...client,githubOidcToken:()=>async()=>token(claims(a.childRunId)),
    createReceiptReader:opts=>client.createReceiptReader({...opts,fetcher:f.clientFetch})})});
  const request={requestId:s.requestId,shard:a.logicalShard,generation:1,profile:a.profile},context={repository:REPO,executorSha:EXEC,childRunId:a.childRunId,childAttempt:1};
  const read=()=>admitRunnerJob(request,{...authority,api:f.api,context,phase:'execute',verifyIsolation:async({receipt,profile})=>receipt.profile===profile.id&&receipt.childRunId===a.childRunId});
  const initial=await read();assert.equal(initial.allowed,true,JSON.stringify(initial));
  admitted.push({a,read,initial});
 }
 if(outcome==='revoked'){
  await f.control().fetch(new Request('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'}));
 }
 const fs=await import('node:fs');let started=0;
 // Deterministic sequential local work stays within the reviewed admission cap; no throughput claim.
 const results=[];
 for(const {a,read,initial} of admitted){
  const runnerTemp=join(c.dir,'runner-'+a.childRunId),workspace=join(c.dir,'workspace-'+a.childRunId);mkdirSync(runnerTemp);mkdirSync(workspace);
  const paths=ownedPaths({runnerTemp,workspace,childRunId:a.childRunId,childAttempt:1});prepareOwned(paths);fs.cpSync(c.root,paths.source,{recursive:true});
  mkdirSync(join(paths.source,'scripts'),{recursive:true});const driver=join(paths.source,'scripts/test-drift-parts.mjs');
  // Real local fixture work; not a hosted child or a native-container qualification.
  writeFileSync(driver,`import assert from 'node:assert/strict';import fs from 'node:fs';const part=process.argv[2];const plan=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));assert.equal(plan.parts.filter(p=>p.name===part).length,1);assert.equal(process.env.GITHUB_SHA,'${SOURCE}');assert.equal(process.env.GITHUB_RUN_ID,'12');assert.equal(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,undefined);assert.equal(process.env.GH_TOKEN,undefined);assert.equal(process.env.GITHUB_TOKEN,undefined);console.log('executed:'+part);process.exit(${outcome==='failure'&&a.logicalShard==='worker-3-of-6'?9:0});`);
  let result;
  try{
   result=await executeShard({admitted:initial,paths,testDriver:driver,planPath:c.planPath,readReceipt:read,
    gitHead:()=>SOURCE,gitClean:()=>true,run:(command,args,options)=>{
     started++;return spawn(command,args,{...options,stdio:['ignore','ignore','inherit']});
    }});
  }catch(error){if(outcome!=='revoked')throw error;result={code:null,refused:true};}
  const {cleanupOwned}=await import('../../scripts/ci/runner-execution.mjs');cleanupOwned(paths);
  assert.equal(fs.existsSync(paths.source),false);
  results.push({a,result});
 }
 if(outcome==='revoked'){
  assert.equal(started,0);assert.equal(results.every(r=>r.result.refused===true),true);return;
 }
 assert.equal(started,6);
 for(const [i,{a,result}] of results.entries()){
  assert.equal(result.code,outcome==='failure'&&a.logicalShard==='worker-3-of-6'?9:0);
  if(outcome==='incomplete'&&i===5)continue;
  f.reportChild(a.childRunId,{status:result.code===0?'success':'failure'});
  const identity=admitted.find(row=>row.a.childRunId===a.childRunId).initial.identity;
  const signed={...claims(a.childRunId),check_run_id:String(a.childRunId+1000),runner_environment:a.profile==='linux-x64'?'self-hosted':'github-hosted'};
  assert.equal((await reportExecutionResult(identity,{testStep:result.code===0?'success':'failure',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true},
    {...options(f.clientFetch,a.childRunId),oidcToken:async()=>token(signed)})).accepted,true);
 }
 f.restart();await f.tick();
 assert.equal(f.checks[0].name,'ci-capacity/worker-pilot');
 assert.equal(f.checks[0].conclusion,outcome==='incomplete'?undefined:outcome);
 assert.equal(f.checks[0].status,outcome==='incomplete'?'in_progress':'completed');
 assert.equal(f.checks.some(check=>check.name==='ci-capacity/full-suite'),false);
 assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/dispatches')).length,6);
 if(outcome==='failure'){await f.tick();assert.equal(f.checks[0].conclusion,'failure');}
});

test('D7909 publication recovers a lost pre-POST intent after bounded absence observation',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});
 const {CapacityOutbox}=await import('../../merge-control/src/ciCapacityOutbox.ts');
 const store=new SqlCapacityStore(f.storage);let beforeSend=true,posts=0;
 const api=async(method,path,body)=>{if(method==='POST'&&path.endsWith('/check-runs')){posts++;if(beforeSend)throw Error('fixture crash before provider receives request');}return f.api(method,path,body);};
 const publish=()=>new CapacityOutbox(f.storage,api,config).publish(store,()=>({status:'pending',reason:'fixture'}),'pilot');
 assert.equal(await publish(),true);assert.equal(f.checks.length,0);beforeSend=false;
 await publish();assert.equal(posts,1,'do not retry an ambiguous create immediately');
 t.mock.timers.setTime(Date.now()+61_000);await publish();
 assert.equal(f.checks.length,1,'a second bounded zero-result observation may recover the missing create');
 assert.equal(posts,2);await publish();assert.equal(posts,2);
});

test('D7909 authenticated outcome binds historical ownership and actual job identity; cleanup cannot erase failure',async t=>{
 const f=fixture(t,{callbackResults:true});t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),record=store.get(submission().requestId),a=record.shards[0].attempts[0];
 const receipt=await f.control().fetch(new Request('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token(claims(a.childRunId))},body:JSON.stringify({requestId:a.requestId,shard:a.logicalShard,generation:1,profile:a.profile})})).then(r=>r.json()).then(r=>r.receipt);
 const signed={...claims(a.childRunId),check_run_id:String(a.childRunId+1000),runner_environment:'github-hosted'};
 const send=(identity,value,proof=signed)=>reportExecutionResult(identity,value,{...options(f.clientFetch),oidcToken:async()=>token(proof)});
 const failure={testStep:'failure',executionOutcome:'cleanup_failure',cleanupConfirmed:false,exportComplete:false};
 for(const proof of [{...signed,check_run_id:undefined},{...signed,check_run_id:'999'},{...signed,runner_environment:'self-hosted'},{...signed,run_id:'101'}])await assert.rejects(send(receipt,failure,proof),/unavailable/);
 for(const field of ['requestId','logicalShard','sourceSha','planDigest','generation','executorSha','childRunId','executionDeadline'])await assert.rejects(send({...receipt,[field]:'wrong'},failure),/unavailable/);
 assert.equal(f.storage.sql.exec('SELECT COUNT(*) AS n FROM capacity_execution_results').toArray()[0].n,0);
 // New minute keeps this deliberate refusal matrix independent of the per-caller work quota.
 t.mock.timers.setTime(Date.now()+60_000);
 assert.equal((await send(receipt,failure,{...signed,exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),nbf:Math.floor(Date.now()/1000)-1})).accepted,true);
 assert.equal(store.get(a.requestId).shards[0].attempts[0].verifiedTestFailure,true,'callback failure fences before acknowledgement');
 assert.equal(await (await f.clientFetch('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token(claims(101))},body:JSON.stringify({requestId:a.requestId,shard:'worker-2-of-6',generation:1,profile:'hosted'})})).json().then(value=>value.active),false);
 const row=JSON.parse(f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state);
 assert.equal(row.jobId,1100);assert.equal(row.cleanupConfirmed,false);assert.equal(row.receivedAt,Date.now());
 f.restart();f.reportChild(a.childRunId,{status:'failure'});await f.tick();
 const pending=store.get(a.requestId).shards[0].attempts[0];assert.equal(pending.generation,1);assert.notEqual(pending.phase,'failed');
 const positive={testStep:'success',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true,rawLog:'fixture-must-not-be-stored'};
 assert.equal((await send({...receipt,rawLog:'fixture-must-not-be-stored'},positive)).accepted,true);
 assert.doesNotMatch(f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state,/fixture-must-not-be-stored/);
 await f.tick();assert.equal(store.get(a.requestId).shards[0].attempts[0].phase,'failed');
 assert.equal(JSON.parse(f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state).testStep,'failure');
});

test('D7909 outcome maps JWT check-run identity to a separately observed job ID',async t=>{
 const f=fixture(t,{callbackResults:true});const nativeFetcher=f.fetcher;
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const response=await nativeFetcher(input,init),url=new URL(input);
  if(url.pathname.endsWith('/attempts/1/jobs')&&url.pathname.includes('/runs/100/')){
   const value=await response.json();value.jobs[0].check_run_url=`https://api.github.com/repos/${REPO}/check-runs/88001`;return Response.json(value);
  }
  return response;
 });
 await unlock(f);await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const a=new SqlCapacityStore(f.storage).get(submission().requestId).shards[0].attempts[0];
 const {phase,cancelDeadline,reason,...receipt}=a;
 const proof={...claims(100),check_run_id:'88001',runner_environment:'github-hosted'};
 assert.equal((await reportExecutionResult(receipt,{testStep:'unknown',executionOutcome:'timed_out',cleanupConfirmed:false,exportComplete:false},
  {...options(f.clientFetch),oidcToken:async()=>token(proof)})).accepted,true);
 assert.equal(JSON.parse(f.storage.sql.exec('SELECT state FROM capacity_execution_results').toArray()[0].state).jobId,1100);
});

test('D7909 moved-main discovery is cancellation-only; raw results from that revision are never test truth',async t=>{
 const f=fixture(t),{GithubCapacityPorts}=await import('../../merge-control/src/ciCapacityGithub.ts');
 const api=async(method,path,body)=>{const value=await f.api(method,path,body);if(path.includes('/runs?')&&path.includes('head_sha=')){const sha=new URL('https://api.github.com'+path).searchParams.get('head_sha');value.workflow_runs=value.workflow_runs.filter(row=>row.head_sha===sha);value.total_count=value.workflow_runs.length;}return value;};
 const ports=new GithubCapacityPorts(api,config),a={...submission(),logicalShard:'worker-1-of-6',profile:'hosted',generation:1,childRunId:null,childAttempt:1,startDeadline:Date.now()+60_000,executionDeadline:Date.now()+600_000};
 await assert.rejects(ports.dispatch(a),/discovery_required/);
 f.children.get(100).head_sha='d'.repeat(40);
 assert.deepEqual(await ports.discover(a),{childRunId:100,rejectedWorkflowSha:'d'.repeat(40)});
 const receipt={...a,childRunId:100};f.result('failure');
 assert.equal(await ports.observe(receipt),null);assert.equal(await ports.observe(receipt,'d'.repeat(40)),null);
 await assert.rejects(ports.cancel(receipt),/identity/);
 f.children.get(100).status='in_progress';f.children.get(100).conclusion=null;
 await ports.cancel(receipt,'d'.repeat(40));
 assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/100/cancel')).length,1);
});

test('D7909 publication retries are bounded and duplicate identities never trigger another POST',async t=>{
 const f=fixture(t);t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});
 const {CapacityOutbox}=await import('../../merge-control/src/ciCapacityOutbox.ts');const store=new SqlCapacityStore(f.storage);let posts=0;
 const api=async(method,path,body)=>{if(method==='POST'&&path.endsWith('/check-runs')){posts++;throw Error('fixture request not delivered');}return f.api(method,path,body);};
 const publish=()=>new CapacityOutbox(f.storage,api,config).publish(store,()=>({status:'pending',reason:'fixture'}),'pilot');
 await publish();await publish();t.mock.timers.setTime(Date.now()+61_000);await publish();assert.equal(posts,2);
 for(let i=0;i<4;i++){t.mock.timers.setTime(Date.now()+61_000);assert.equal(await publish(),true);}
 assert.equal(posts,2);
 const id=submission().requestId+':pilot';
 for(let i=0;i<2;i++)f.checks.push({id:200+i,name:'ci-capacity/worker-pilot',head_sha:SOURCE,external_id:id,app:{id:23},status:'in_progress'});
 await publish();assert.equal(posts,2);assert.equal(f.calls.some(call=>call.method==='PATCH'&&call.path.includes('/check-runs/')),false);
});

test('D7909 default metadata reader fixes origin, refuses redirects and bounds actual response bytes',async t=>{
 const f=fixture(t),c=candidate(t),env={...enabledEnv(c),GH_TOKEN:'fixture-read-only'};let requests=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  requests++;assert.equal(String(url),'https://api.github.com'+PREFIX+'/actions/runs/12');assert.equal(init.redirect,'error');assert.equal(init.signal instanceof AbortSignal,true);
  return Response.json(f.parent);
 });
 assert.equal((await capacitySubmission(env)).parentRunId,12);assert.equal(requests,1);
 t.mock.method(globalThis,'fetch',async()=>Response.json({oversize:'x'.repeat(128*1024)}));
 await assert.rejects(capacitySubmission(env),/response_bound/);
});

for(const proof of ['missing','export_failure','export_incomplete'])test(`D7909 ${proof} result never becomes aggregate success`,async t=>{
 const f=fixture(t,{callbackResults:true});t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),attempts=store.get(submission().requestId).shards.map(s=>s.attempts[0]);
 f.result('success');
 if(proof!=='missing')for(const a of attempts){
  const {phase,cancelDeadline,reason,...receipt}=a;
  assert.equal((await reportExecutionResult(receipt,{testStep:'success',executionOutcome:proof==='export_failure'?'export_failure':'completed',cleanupConfirmed:true,exportComplete:false},
   {...options(f.clientFetch),oidcToken:async()=>token({...claims(a.childRunId),check_run_id:String(a.childRunId+1000),runner_environment:'github-hosted'})})).accepted,true);
 }
 f.restart();await f.tick();assert.notEqual(f.checks[0].conclusion,'success');
 assert.equal(store.get(submission().requestId).shards.some(s=>s.attempts[0].phase==='succeeded'),false);
});

test('D7909 pilot configuration refuses included billing and full-suite publication',async t=>{
 const f=fixture(t);f.env.CAPACITY_PUBLICATION='pilot';t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 for(const patch of [{publication:'full-suite'},{maxIncludedWorkerShards:1}]){
  f.env.CAPACITY_CONFIG=JSON.stringify({...config,...patch});f.restart();
  await assert.rejects(submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan}),/unavailable/);
 }
 assert.equal(f.children.size,0);assert.equal(f.checks.length,0);
});

// The CI suite checks out one commit, so `git show <sha>:<path>` cannot read the D7909 base. Each ordinary job of
// 270cdf4a2ad4d7d1fb57cf6315cca7e6e416e3b0:.github/workflows/ci.yml (every job but plan) is recorded as the first 16
// hex of sha256(JSON.stringify(yaml.parse(…).jobs[name])); the pin is checked by blob id. Neither needs history.
const BASE_JOB_DIGESTS={
  "frontend":'e2884e1ba35220b8',
  "worker":'338f2e46f9af2c9f',
  "verified":'671cbb73f43df103',
  "suite":'c7c40cb382c001d6',
  "test-deps":'584ab84cbc836df0',
  "fast":'066a8e32945222c9',
  "landing":'bea23ba6bac95c0c',
  "gate":'8dc0dedfdbe09d02',
  "selection-shadow":'41ac4055f5a3c941',
  "classify":'d594dedf4e520c73',
  "visual":'c6454cc3f58225a7', // #8537 (D8537): the public journey step.
  "drift":'d870bd539b8eced2',
  "og-tags":'e7c2cfaf81226e04',
  "dev-backend":'82b39cdcaa1e275a',
  "digest":'bca3f4d9522fd6c1'
};
const jobDigest=job=>createHash('sha256').update(JSON.stringify(job)).digest('hex').slice(0,16);

test('D7909 literal pinned caller leaves the ordinary hosted graph and queue matrix independent',()=>{
 const current=yaml(readFileSync('.github/workflows/ci.yml','utf8')),caller=current.jobs['capacity-submit'];
 // D8335 (#8335): a main commit. The first pin (19927c89) lived only on the merged branch and stopped resolving when it was deleted.
 assert.equal(caller.uses,'AxalNetwork/StudioOS/.github/workflows/capacity-planner.yml@cb63d3997d5770892934932b3c7a534485a8a875');
 assert.equal(caller.needs,'plan');assert.equal(caller.permissions['id-token'],'write');
 for(const guard of ["github.event_name == 'push'","github.event_name != 'merge_group'","vars.CI_CAPACITY_ENABLED == 'true'","github.repository == 'AxalNetwork/StudioOS'","needs.plan.outputs.capacity_submission != ''"])assert.ok(caller.if.includes(guard),guard);
 for(const [name,digest] of Object.entries(BASE_JOB_DIGESTS)){
  assert.ok(current.jobs[name],`ordinary hosted job ${name} must still exist`);
  assert.equal(jobDigest(current.jobs[name]),digest,`ordinary hosted job ${name} must stay unchanged`);
 }
 assert.equal(current.jobs.plan.steps.find(s=>s.id==='capacity')['continue-on-error'],true);
 assert.equal(caller.with.submission,'${{ needs.plan.outputs.capacity_submission }}');
 assert.equal(caller.with.executor_sha,'${{ vars.CI_CAPACITY_EXECUTOR_SHA }}');
 assert.equal(caller.with.child_workflow_sha,'${{ vars.CI_CAPACITY_CHILD_WORKFLOW_SHA }}');
 // 4f7dfaca… is `git rev-parse cb63d3997d5770892934932b3c7a534485a8a875:.github/workflows/capacity-planner.yml`, the same blob the first pin (19927c89) held.
 assert.equal(execFileSync('git',['hash-object','.github/workflows/capacity-planner.yml'],{encoding:'utf8'}).trim(),'4f7dfaca48403d2d0b9cc9e83403ebca48525a8d','the literal pin must contain the exact prepared planner');
 const config=readFileSync('wrangler.merge-control.toml','utf8');
 assert.match(config,/CAPACITY_ENABLED = "false"/);assert.match(config,/CAPACITY_PUBLICATION = "pilot"/);assert.match(config,/CAPACITY_CONFIG = ""/);
});

test('D7909 older owned generation can report a sticky failure but cannot report replacement success',async t=>{
 const f=fixture(t,{callbackResults:true});t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),request=store.get(submission().requestId),shard=request.shards[0],a=shard.attempts[0];
 const receipt=await f.control().fetch(new Request('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token(claims(a.childRunId))},body:JSON.stringify({requestId:a.requestId,shard:a.logicalShard,generation:1,profile:'hosted'})})).then(r=>r.json()).then(r=>r.receipt);
 // Explicit persisted historical-generation fixture, not a real dispatch/fallback observation.
 a.phase='cancelled';shard.generation=2;shard.attempts.push({...a,generation:2,childRunId:999,phase:'queued'});store.save(request);
 const send=value=>reportExecutionResult(receipt,value,{...options(f.clientFetch),oidcToken:async()=>token({...claims(a.childRunId),check_run_id:String(a.childRunId+1000),runner_environment:'github-hosted'})});
 await assert.rejects(send({testStep:'success',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true}),/unavailable/);
 assert.equal(f.storage.sql.exec('SELECT COUNT(*) AS n FROM capacity_execution_results').toArray()[0].n,0);
 assert.equal((await send({testStep:'failure',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true})).accepted,true);
 const after=store.get(a.requestId);assert.equal(after.shards[0].attempts[0].verifiedTestFailure,true);assert.equal(after.evidenceConflict,true);
});

for(const stop of ['owner-switch','environment'])test(`D7909 ${stop} revokes execution but preserves authenticated owned cleanup reports`,async t=>{
 const f=fixture(t,{callbackResults:true});t.mock.method(globalThis,'fetch',f.fetcher);await unlock(f);
 await submitCapacity(submission(),{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const store=new SqlCapacityStore(f.storage),a=store.get(submission().requestId).shards[0].attempts[0];
 const args={request:{requestId:a.requestId,shard:a.logicalShard,generation:1,profile:a.profile},context:{repository:REPO,childRunId:a.childRunId,childAttempt:1,executorSha:EXEC},phase:'execute'};
 const receipt=(await createReceiptReader({...options(f.clientFetch,a.childRunId)})(args)).receipt;
 await f.clientFetch('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'});
 if(stop==='environment')f.env.CAPACITY_ENABLED='false';f.restart();
 await assert.rejects(submitCapacity({...submission(),requestId:'00000000-0000-4000-8000-000000007999'},{...options(f.clientFetch),enabled:true,plan}),/unavailable/);
 await assert.rejects(createReceiptReader({...options(f.clientFetch,a.childRunId)})(args),/unavailable/);
 const signed={...claims(a.childRunId),check_run_id:String(a.childRunId+1000),runner_environment:'github-hosted'};
 const body={testStep:'not_run',executionOutcome:'setup_failure',cleanupConfirmed:true,exportComplete:false};
 const send=(owned,proof=signed)=>reportExecutionResult(owned,body,{...options(f.clientFetch),oidcToken:async()=>token(proof)});
 await assert.rejects(send({...receipt,planDigest:'sha256:'+'0'.repeat(64)}),/unavailable/);
 await assert.rejects(send(receipt,{...signed,aud:'wrong'}),/unavailable/);
 assert.equal((await send(receipt)).accepted,true);f.result('cancelled');await f.tick();
 assert.equal(store.get(a.requestId).shards[0].attempts[0].phase,'cancelled');
 assert.equal(f.checks[0].conclusion,'cancelled');assert.equal(store.get(a.requestId).parentLive,false);
 assert.equal(f.calls.filter(row=>row.method==='POST'&&row.path.endsWith('/dispatches')).length,6);
});

test('D7909 independent control and child-workflow pins bind dispatch, receipt and result without a main-race exception',async t=>{
 const f=fixture(t,{callbackResults:true}),child='c'.repeat(40);let main=child;
 f.env.CAPACITY_CONFIG=JSON.stringify({...config,childWorkflowSha:child});f.restart();
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const r=await f.fetcher(input,init),url=new URL(input);
  if(url.pathname.endsWith('/git/ref/heads/main'))return Response.json({ref:'refs/heads/main',object:{type:'commit',sha:main}});
  if(url.pathname.includes('/compare/'))return Response.json({status:'ahead',base_commit:{sha:EXEC},merge_base_commit:{sha:EXEC}});
  if(url.pathname.endsWith('/dispatches')&&init?.method==='POST')for(const run of f.children.values())run.head_sha=child;
  return r;
 });
 await unlock(f);const s={...submission(),childWorkflowSha:child};await submitCapacity(s,{...options(f.clientFetch),enabled:true,plan});await f.tick();await f.tick();
 const request={requestId:s.requestId,shard:'worker-1-of-6',generation:1,profile:'hosted'},context={repository:REPO,executorSha:EXEC,childWorkflowSha:child,childRunId:100,childAttempt:1};
 await assert.rejects(createReceiptReader(options(f.clientFetch,100))({request,context}),/unavailable/);
 const proof={...claims(100),sha:child,workflow_sha:child,check_run_id:'1100',runner_environment:'github-hosted'};
 const opts={...options(f.clientFetch),oidcToken:async()=>token(proof)},receipt=(await createReceiptReader(opts)({request,context})).receipt;
 assert.equal(receipt.executorSha,EXEC);assert.equal(receipt.childWorkflowSha,child);
 await assert.rejects(reportExecutionResult({...receipt,childWorkflowSha:EXEC},{testStep:'success',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true},opts),/unavailable/);
 assert.equal((await reportExecutionResult(receipt,{testStep:'success',executionOutcome:'completed',cleanupConfirmed:true,exportComplete:true},opts)).accepted,true);
 main='d'.repeat(40);
 const {GithubCapacityPorts}=await import('../../merge-control/src/ciCapacityGithub.ts'),api=async(method,path,body)=>path.endsWith('/git/ref/heads/main')?{object:{sha:main}}:f.api(method,path,body);
 const ports=new GithubCapacityPorts(api,{...config,childWorkflowSha:child});await assert.rejects(ports.dispatch({...receipt,childRunId:null}),/main_moved/);
});

test('D7909 group 5 is the catalogued dispatch supervisor pool, never an implicit trusted/untrusted alias',async t=>{
 const f=fixture(t),{GithubCapacityPorts}=await import('../../merge-control/src/ciCapacityGithub.ts'),{resolveCatalogProfile}=await import('../../scripts/ci/runners/catalog.mjs');
 const profile=resolveCatalogProfile('linux-x64');assert.equal(profile.approvedGroupId,config.approvedGroupId);assert.equal(profile.target.group,'StudioOS Worker Pool');
 for(const name of ['trusted','untrusted']){
  const inventory=async(method,path,body)=>{const row=await f.api(method,path,body);if(path.endsWith('/runner-groups/5'))row.name=name;return row;};
  await assert.rejects(new GithubCapacityPorts(f.api,config,Date.now,undefined,inventory).inventory(),/group_unapproved/);
 }
 const workflow=readFileSync('.github/workflows/runner-executor.yml','utf8');assert.ok(workflow.includes('"group":"'+profile.target.group+'"'));assert.ok(workflow.includes("github.event_name == 'workflow_dispatch'"));
});
