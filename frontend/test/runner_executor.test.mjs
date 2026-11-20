/** D7886 (#7886): exact parent/queue plans, profile checks, actual test truth and owned process/filesystem lifecycle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {buildPlan,validatePlan} from '../../scripts/test-drift-parts.mjs';
import {planDigest,verifiedPlan,verifyRuntime,ownedPaths,prepareOwned,cleanupOwned,originalTestContext,childResult,executeShard,TEST_STEP,TEST_JOB} from '../../scripts/ci/runner-execution.mjs';
import {executionTarget} from '../../scripts/ci/runner-admission.mjs';
const SHA='a'.repeat(40),EXEC='e'.repeat(40),BASE='b'.repeat(40),NOW=1_800_000_000_000;
const scripts={'test:frontend':"node --test 'frontend/test/*.test.mjs'",'test:worker':"node --test 'cloudflare-worker/test/*.test.mjs'",'test:drift':'npm run test:frontend && npm run test:worker && node scripts/guard.mjs'};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'runner-executor-test-')),temp=join(root,'temp'),workspace=join(root,'workspace');mkdirSync(temp);mkdirSync(workspace);
 const paths=ownedPaths({runnerTemp:temp,workspace,childRunId:202,childAttempt:1});prepareOwned(paths);mkdirSync(paths.source);mkdirSync(join(paths.source,'scripts'));mkdirSync(paths.control);mkdirSync(join(paths.control,'scripts'));
 for(const [folder,n]of [['frontend/test',2],['cloudflare-worker/test',6]]){mkdirSync(join(paths.source,folder),{recursive:true});for(let i=1;i<=n;i++)writeFileSync(join(paths.source,folder,i+'.test.mjs'),'// synthetic test fixture\n');}
 return{root,paths,close:()=>rmSync(root,{recursive:true,force:true})};
}
const profile=(id='hosted')=>({id,platform:id==='macos-arm64'?'darwin':'linux',arch:id==='macos-arm64'?'arm64':'x64',nodeVersion:'22.16.0',pythonVersion:'3.11.11',target:id==='hosted'?'ubuntu-latest':{group:'Synthetic Reviewed Group',labels:['self-hosted',id==='macos-arm64'?'macOS':'Linux',id==='macos-arm64'?'ARM64':'X64','studioos-worker-v1']},eligibleShards:id==='macos-arm64'?['worker-1-of-6']:Array.from({length:6},(_,i)=>`worker-${i+1}-of-6`)});
const admitted=()=>({allowed:true,identity:{requestId:'request-7886',generation:3,childRunId:202,profile:'hosted'},sourceSha:SHA,sourceRef:'refs/heads/main',originalEvent:'push',originalRunId:101,originalAttempt:2,queueBaseSha:null,shard:'worker-1-of-6',executionDeadline:NOW+60_000});

test('push consumes exact parent artifact bytes while merge-group builds only the identical deterministic equal-weight plan',()=>{
 const f=fixture();try{
  const equal=buildPlan(scripts,{},f.paths.source),bytes=Buffer.from(JSON.stringify(equal,null,2)+'\n');
  const input={event:'push',part:'worker-1-of-6',expectedDigest:planDigest(bytes),artifactBytes:bytes,scripts,sourceRoot:f.paths.source};
  assert.deepEqual(verifiedPlan(input),bytes);assert.throws(()=>verifiedPlan({...input,artifactBytes:null}),/parent_plan_missing/);assert.throws(()=>verifiedPlan({...input,artifactBytes:Buffer.from(bytes+' ')}),/plan_digest_mismatch/);
  const weighted=buildPlan(scripts,{'cloudflare-worker/test/1.test.mjs':100},f.paths.source),weightedBytes=Buffer.from(JSON.stringify(weighted,null,2)+'\n');
  assert.deepEqual(verifiedPlan({...input,artifactBytes:weightedBytes,expectedDigest:planDigest(weightedBytes)}),weightedBytes);
  assert.deepEqual(verifiedPlan({...input,event:'merge_group',artifactBytes:null}),bytes);
  assert.throws(()=>verifiedPlan({...input,event:'merge_group',expectedDigest:planDigest(weightedBytes)}),/plan_digest_mismatch/);
  const wrong=structuredClone(equal);wrong.parts.find(p=>p.name==='worker-1-of-6').files=[];const changed=JSON.stringify(wrong);assert.throws(()=>verifiedPlan({...input,artifactBytes:changed,expectedDigest:planDigest(changed)}),/missing file/);
  const forged=structuredClone(equal);forged.parts.find(p=>p.name==='worker-1-of-6').commands=['arbitrary command from artifact'];const payload=JSON.stringify(forged);
  const parsed=JSON.parse(verifiedPlan({...input,artifactBytes:payload,expectedDigest:planDigest(payload)}));assert.doesNotMatch(JSON.stringify(validatePlan(parsed,scripts,f.paths.source)),/arbitrary command/);
 }finally{f.close();}
});
test('hosted remains a fixed target; Linux and Mac use AND capability labels, pinned runtimes and explicit verified workload bounds',()=>{
 for(const id of ['hosted','linux-x64','macos-arm64']){
  const p=profile(id);const target=executionTarget(p);assert.deepEqual(target,p.target);
  assert.deepEqual(verifyRuntime(p,{platform:p.platform,arch:p.arch,node:p.nodeVersion,sqlite:()=>true}),{platform:p.platform,arch:p.arch,node:p.nodeVersion});
  assert.throws(()=>verifyRuntime(p,{platform:'win32',arch:p.arch,node:p.nodeVersion,sqlite:()=>true}),/platform_mismatch/);
  assert.throws(()=>verifyRuntime(p,{platform:p.platform,arch:p.arch==='x64'?'arm64':'x64',node:p.nodeVersion,sqlite:()=>true}),/platform_mismatch/);
  assert.throws(()=>verifyRuntime(p,{platform:p.platform,arch:p.arch,node:'24.19.0',sqlite:()=>true}),/unsupported_node_runtime/);
  assert.throws(()=>verifyRuntime(p,{platform:p.platform,arch:p.arch,node:'22.16.1',sqlite:()=>true}),/runtime_node_pin_mismatch/);
  assert.throws(()=>verifyRuntime(p,{platform:p.platform,arch:p.arch,node:p.nodeVersion,sqlite:()=>false}),/sqlite_unavailable/);
 }
 const mac=profile('macos-arm64');mac.eligibleShards.push('worker-2-of-6');assert.throws(()=>executionTarget(mac),/unverified_mac_shards/);
 const linux=profile('linux-x64');linux.target.labels=['self-hosted','ubuntu-latest'];assert.throws(()=>executionTarget(linux),/invalid_self_hosted_target/);
 assert.throws(()=>executionTarget({...profile(),target:'paid-larger-runner'}),/invalid_hosted_target/);
});
test('original event, exact source, plan shard and original run/attempt stay in test context while traces stay child-private',()=>{
 const f=fixture();try{
  const value=admitted(),env=originalTestContext(value,f.paths,{SYNTHETIC:'kept'});assert.equal(env.GITHUB_SHA,SHA);assert.equal(env.GITHUB_EVENT_NAME,'push');assert.equal(env.GITHUB_RUN_ID,'101');assert.equal(env.GITHUB_RUN_ATTEMPT,'2');assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.SYNTHETIC,'kept');assert.equal(env.TEST_TRACE_DIR,join(f.paths.temp,'test-traces'));
  const queue={...value,originalEvent:'merge_group',sourceRef:`refs/heads/gh-readonly-queue/main/pr-12-${BASE}`,queueBaseSha:BASE};const q=originalTestContext(queue,f.paths,{});assert.deepEqual(JSON.parse(readFileSync(q.GITHUB_EVENT_PATH,'utf8')),{merge_group:{base_sha:BASE,head_sha:SHA}});
  assert.throws(()=>originalTestContext({...queue,queueBaseSha:null},f.paths),/missing_queue_base/);
 }finally{f.close();}
});
function result(){
 const run={id:202,run_attempt:1,path:'.github/workflows/runner-executor.yml',repository:{full_name:'AxalNetwork/StudioOS'},head_sha:EXEC,status:'completed',conclusion:'success'};
 const job={id:909,name:TEST_JOB,run_id:202,run_attempt:1,head_sha:EXEC,status:'completed',conclusion:'success',steps:[{name:TEST_STEP,status:'completed',conclusion:'success'},{name:'Upload test traces',status:'completed',conclusion:'success'}]};
 return{run,jobs:[job],owned:{childRunId:202,childAttempt:1,executorSha:EXEC}};
}
test('only the real test step, owned job and run passing count as success; test failure can never be laundered by uploads or another run',()=>{
 const f=result();assert.equal(childResult(f,f.owned).outcome,'success');
 f.jobs[0].steps[0].conclusion='failure';assert.equal(childResult(f,f.owned).outcome,'test_failure');
 f.jobs[0].steps[0].conclusion='success';f.run.conclusion='failure';assert.equal(childResult(f,f.owned).outcome,'unknown');
 f.run.conclusion='success';f.jobs[0].conclusion='failure';assert.equal(childResult(f,f.owned).outcome,'unknown');
 f.jobs[0].conclusion='success';f.jobs[0].steps[1].conclusion='failure';assert.equal(childResult(f,f.owned).outcome,'success'); // advisory upload did not change real test/job/run truth
 f.jobs[0].steps[0].name='Dispatch accepted';assert.equal(childResult(f,f.owned).outcome,'unknown');
 const wrong=result();wrong.run.id=999;wrong.jobs[0].run_id=999;assert.equal(childResult(wrong,wrong.owned).outcome,'unknown');
 const rerun=result();rerun.run.run_attempt=2;assert.equal(childResult(rerun,rerun.owned).outcome,'unknown');
});
test('cleanup removes only the owned run directories and refuses another run, altered parents or forged ownership',()=>{
 const f=fixture();try{
  const other=join(f.paths.runnerTemp,'other-run');mkdirSync(other);writeFileSync(join(other,'keep'),'synthetic');
  assert.throws(()=>cleanupOwned({...f.paths,temp:other}),/unsafe_cleanup_identity/);assert.ok(existsSync(join(other,'keep')));
  writeFileSync(join(f.paths.temp,'.runner-owner'),'other');assert.throws(()=>cleanupOwned(f.paths),/cleanup_owner_mismatch/);assert.ok(existsSync(f.paths.source));
  writeFileSync(join(f.paths.temp,'.runner-owner'),f.paths.suffix);cleanupOwned(f.paths);assert.equal(existsSync(f.paths.source),false);assert.equal(existsSync(f.paths.control),false);assert.equal(existsSync(f.paths.temp),false);assert.ok(existsSync(join(other,'keep')));cleanupOwned(f.paths);
 }finally{f.close();}
});
test('a real failing test process returns its nonzero code, with no shell or caller-supplied command',async()=>{
 const f=fixture();try{
  const driver=join(f.paths.source,'scripts/test-drift-parts.mjs');writeFileSync(driver,'process.exit(7);\n');
  execFileSync('git',['init','-q'],{cwd:f.paths.source});execFileSync('git',['add','.'],{cwd:f.paths.source});execFileSync('git',['-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','synthetic'],{cwd:f.paths.source,env:{...process.env,GIT_AUTHOR_DATE:'2026-11-20T00:00:00Z',GIT_COMMITTER_DATE:'2026-11-20T00:00:00Z'}});
  const value=admitted();value.sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:f.paths.source,encoding:'utf8'}).trim();
  const outcome=await executeShard({admitted:value,paths:f.paths,testDriver:driver,planPath:join(f.paths.source,'suite-plan.json'),now:()=>NOW,readReceipt:async()=>({allowed:true,identity:value.identity})});
  assert.equal(outcome.code,7);assert.equal(outcome.timedOut,false);assert.equal(outcome.cancelled,false);
  await assert.rejects(executeShard({admitted:value,paths:f.paths,testDriver:driver,planPath:'unused',now:()=>NOW,readReceipt:async()=>({allowed:false,identity:value.identity})}),/receipt_superseded_before_execution/);
 }finally{f.close();}
});
test('timeout and cancellation are bounded and cannot become a pass; changed checkout refuses before spawning',async()=>{
 const f=fixture();try{
  const value=admitted(),driver=join(f.paths.source,'scripts/test-drift-parts.mjs');writeFileSync(driver,'// synthetic');
  let spawned=0;const callbacks=[];const timers={setTimeout:callback=>{callbacks.push(callback);return{unref(){}};},clearTimeout(){}};
  const make=(command,args,options)=>{assert.equal(command,process.execPath);assert.deepEqual(args,[driver,'worker-1-of-6','--plan-file','unused']);assert.equal(options.shell,false);assert.equal(options.detached,true);assert.equal(options.cwd,f.paths.source);spawned++;const child=new EventEmitter();child.pid=99999999;queueMicrotask(()=>{callbacks[0]();child.emit('close',0,'SIGTERM');});return child;};
  const opts={admitted:value,paths:f.paths,testDriver:driver,planPath:'unused',readReceipt:async()=>({allowed:true,identity:value.identity}),now:()=>NOW,gitHead:()=>SHA,gitClean:()=>true,run:make,timers};
  const outcome=await executeShard(opts);assert.equal(outcome.code,124);assert.equal(outcome.timedOut,true);assert.equal(spawned,1);
  await assert.rejects(executeShard({...opts,gitHead:()=>BASE}),/candidate_checkout_sha_mismatch/);assert.equal(spawned,1);
  await assert.rejects(executeShard({...opts,gitClean:()=>false}),/candidate_worktree_modified/);assert.equal(spawned,1);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(executeShard({...opts,signal:cancelled.signal}),/execution_cancelled/);
 }finally{f.close();}
});

test('a source symlink is removed without following it into another run',()=>{
 const f=fixture();try{
  const foreign=join(f.root,'foreign');mkdirSync(foreign);writeFileSync(join(foreign,'keep'),'synthetic');
  rmSync(f.paths.source,{recursive:true});symlinkSync(foreign,f.paths.source);cleanupOwned(f.paths);assert.ok(existsSync(join(foreign,'keep')));
 }finally{f.close();}
});
const WORKFLOW=new URL('../../.github/workflows/runner-executor.yml',import.meta.url);
function workflowProblems(src){
 const bad=[];
 const candidate=src.indexOf('- name: Check out only the admitted immutable source'),admission=src.indexOf('- name: Independently admit this exact child before checkout');
 if(admission<0||candidate<admission)bad.push('candidate_before_admission');
 if(!(src.includes('ref: ${{ steps.identity.outputs.executor_sha }}')&&src.includes('ref: ${{ needs.admit.outputs.executor_sha }}')))bad.push('untrusted_control_revision');
 if(!src.includes('ref: ${{ steps.admission.outputs.source_sha }}'))bad.push('unadmitted_source');
 if(!src.includes("vars.RUNNER_EXECUTOR_ENABLED == 'true'"))bad.push('caller_enabled');
 if(!src.includes("github.ref == 'refs/heads/main'"))bad.push('branch_definition_allowed');
 if(src.includes('persist-credentials: true'))bad.push('persisted_credentials');
 if(!src.includes('runs-on: ${{ fromJSON(needs.admit.outputs.target'))bad.push('unreviewed_target');
 const step=src.split('- name: Run admitted Worker shard')[1]?.split('- name: Upload test traces')[0];
 if(!step||step.includes('continue-on-error: true')||step.includes('|| true'))bad.push('test_failure_hidden');
 if(!src.includes('timeout-minutes: ${{ fromJSON(needs.admit.outputs.job_timeout')||!src.includes('timeout-minutes: ${{ fromJSON(needs.admit.outputs.test_timeout'))bad.push('unbounded_execution');
 if(/secrets\.|secrets: inherit/.test(src))bad.push('executor_secrets');
 return bad;
}
test('staged workflow loads trusted control first, never enables callers, and keeps real test truth separate from advisory traces',()=>{
 const src=readFileSync(WORKFLOW,'utf8');assert.deepEqual(workflowProblems(src),[]);
 const changes=[
  ['candidate_before_admission',src.replace('- name: Independently admit this exact child before checkout','- name: Wrong boundary')],
  ['untrusted_control_revision',src.replaceAll('ref: ${{ steps.identity.outputs.executor_sha }}','ref: ${{ inputs.executor_ref }}')],
  ['unadmitted_source',src.replace('ref: ${{ steps.admission.outputs.source_sha }}','ref: main')],
  ['caller_enabled',src.replace("vars.RUNNER_EXECUTOR_ENABLED == 'true'",'true')],
  ['branch_definition_allowed',src.replace("github.ref == 'refs/heads/main'",'true')],
  ['persisted_credentials',src.replace('persist-credentials: false','persist-credentials: true')],
  ['test_failure_hidden',src.replace('id: tests','id: tests\n        continue-on-error: true')],
 ];
 for(const [reason,mutated]of changes)assert.ok(workflowProblems(mutated).includes(reason),reason);
 assert.match(src,/workflow_call:/);assert.match(src,/workflow_dispatch:/);assert.doesNotMatch(src,/uses:.*runner-executor\.yml@(?:main|agent\/)/);
 assert.ok(src.indexOf('Verify runtime and exact plan before candidate dependency scripts')<src.indexOf('run: npm ci'));
});

const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...rsa.publicKey.export({format:'jwk'}),kid:'synthetic-test-key',use:'sig'};
function bootstrapScript(){const src=readFileSync(WORKFLOW,'utf8');const start=src.indexOf('          script: |\n')+'          script: |\n'.length;const end=src.indexOf('      - name: Check out trusted executor definition',start);return src.slice(start,end).split('\n').filter(Boolean).map(line=>line.slice(12)).join('\n');}
async function bootstrap(changes={}, {badSignature=false,headerChanges={},script=bootstrapScript()}={}){
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'studioos-runner-executor-v1',nbf:NOW/1000-1,exp:NOW/1000+300,repository:'AxalNetwork/StudioOS',run_id:'202',run_attempt:'1',event_name:'workflow_dispatch',ref:'refs/heads/main',workflow_ref:'AxalNetwork/StudioOS/.github/workflows/runner-dispatch.yml@refs/heads/main',workflow_sha:BASE,job_workflow_ref:'AxalNetwork/StudioOS/.github/workflows/runner-executor.yml@'+EXEC,job_workflow_sha:EXEC,...changes};
 const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'synthetic-test-key',...headerChanges})).toString('base64url'),body=Buffer.from(JSON.stringify(claims)).toString('base64url');
 const signature=sign('RSA-SHA256',Buffer.from(header+'.'+body),rsa.privateKey);if(badSignature)signature[0]^=1;
 const token=header+'.'+body+'.'+signature.toString('base64url'),outputs={};let failed=false,masked=false;
 const core={getIDToken:async audience=>{assert.equal(audience,'studioos-runner-executor-v1');return token;},setSecret:value=>{assert.equal(value,token);masked=true;},setOutput:(key,value)=>{outputs[key]=value;},setFailed:()=>{failed=true;}};
 const fetch=async(url,options)=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');assert.equal(options.redirect,'error');return{ok:true,json:async()=>({keys:[jwk]})};};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 await new AsyncFunction('core','require','fetch','process','Date','Buffer','AbortSignal',script)(core,createRequire(import.meta.url),fetch,{env:{GITHUB_RUN_ID:'202',GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_SHA:claims.workflow_sha}},{now:()=>NOW},Buffer,AbortSignal);
 return{failed,masked,outputs};
}
test('signed GitHub identity resolves the pinned reusable callee rather than the caller SHA before loading control code',async()=>{
 const good=await bootstrap();assert.equal(good.failed,false);assert.equal(good.masked,true);assert.deepEqual(good.outputs,{executor_sha:EXEC,child_workflow_sha:BASE,child_workflow_path:'.github/workflows/runner-dispatch.yml'});
 const bad=[{iss:'https://attacker.invalid'},{aud:'different'},{exp:NOW/1000-1},{exp:NOW/1000+1000},{nbf:NOW/1000+100},{repository:'Fork/StudioOS'},{run_id:'999'},{run_attempt:'2'},{event_name:'pull_request'},{ref:'refs/heads/feature'},{workflow_ref:'AxalNetwork/StudioOS/.github/workflows/unknown.yml@refs/heads/main'},{job_workflow_ref:'AxalNetwork/StudioOS/.github/workflows/runner-executor.yml@main'},{job_workflow_sha:SHA}];
 for(const mutation of bad){const outcome=await bootstrap(mutation);assert.equal(outcome.failed,true,JSON.stringify(mutation));assert.deepEqual(outcome.outputs,{});}
 assert.equal((await bootstrap({}, {badSignature:true})).failed,true);
 assert.equal((await bootstrap({}, {headerChanges:{kid:'unknown-key'}})).failed,true);
 assert.equal((await bootstrap({}, {headerChanges:{alg:'HS256'}})).failed,true);
 const direct=await bootstrap({workflow_ref:'AxalNetwork/StudioOS/.github/workflows/runner-executor.yml@refs/heads/main',workflow_sha:EXEC,job_workflow_ref:null,job_workflow_sha:null});assert.equal(direct.failed,false);assert.equal(direct.outputs.executor_sha,EXEC);
});
test('a wrapped result also requires the recorded callee attestation and exact owned caller SHA',()=>{
 const f=result();f.run.path='.github/workflows/runner-dispatch.yml';f.run.head_sha=BASE;f.jobs[0].head_sha=BASE;f.jobs[0].name='execute / '+TEST_JOB;f.owned.childWorkflowPath=f.run.path;f.owned.childWorkflowSha=BASE;
 assert.equal(childResult(f,f.owned).outcome,'unknown');f.owned.workflowAttested=true;assert.equal(childResult(f,f.owned).outcome,'success');
 f.jobs[0].head_sha=SHA;assert.equal(childResult(f,f.owned).outcome,'unknown');
});

test('mid-test cancellation kills only the owned process group promptly and remains cancellation even if the child exits zero',async()=>{
 const f=fixture();try{
  const value=admitted(),driver=join(f.paths.source,'scripts/test-drift-parts.mjs');writeFileSync(driver,'// synthetic');
  const controller=new AbortController(),signals=[],delays=[];
  const timers={setTimeout:(callback,delay)=>{delays.push(delay);return{unref(){}};},clearTimeout(){}};
  const run=()=>{const child=new EventEmitter();child.pid=4321;queueMicrotask(()=>{controller.abort();child.emit('close',0,null);});return child;};
  const outcome=await executeShard({admitted:value,paths:f.paths,testDriver:driver,planPath:'unused',readReceipt:async()=>({allowed:true,identity:value.identity}),now:()=>NOW,gitHead:()=>SHA,gitClean:()=>true,run,timers,signal:controller.signal,killGroup:(pid,kind)=>signals.push({pid,kind})});
  assert.equal(outcome.code,130);assert.equal(outcome.cancelled,true);assert.deepEqual(signals,[{pid:-4321,kind:'SIGTERM'},{pid:-4321,kind:'SIGKILL'}]);assert.ok(delays.includes(5000));
 }finally{f.close();}
});

test('hosted has its own full budget while early starts never extend the real per-profile execution cap',async()=>{
 const f=fixture();try{
  const driver=join(f.paths.source,'scripts/test-drift-parts.mjs');writeFileSync(driver,'// synthetic');const durations=[];
  const timers={setTimeout:(callback,delay)=>{durations.push(delay);return{unref(){}};},clearTimeout(){}};
  const run=()=>{const child=new EventEmitter();child.pid=99999999;queueMicrotask(()=>child.emit('close',0,null));return child;};
  const value=admitted();value.executionDeadline=NOW+50*60000;
  const options={admitted:value,paths:f.paths,testDriver:driver,planPath:'unused',readReceipt:async()=>({allowed:true,identity:value.identity}),now:()=>NOW,gitHead:()=>SHA,gitClean:()=>true,run,timers};
  assert.equal((await executeShard(options)).code,0);assert.equal(durations[0],40*60000);
  value.identity.profile='macos-arm64';value.executionDeadline=NOW+26.5*60000;durations.length=0;
  assert.equal((await executeShard(options)).code,0);assert.equal(durations[0],25*60000);
 }finally{f.close();}
});
