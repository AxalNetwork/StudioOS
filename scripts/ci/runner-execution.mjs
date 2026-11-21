#!/usr/bin/env node
/** D7886 (#7886): exact-plan Worker execution, immutable event context, scoped cleanup and real child-result truth. */
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { availableParallelism, totalmem } from 'node:os';
import { EXECUTION_BUDGETS } from './runner-admission.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildPlan, validatePlan } from '../test-drift-parts.mjs';

const ID = /^[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PART = /^worker-[1-6]-of-6$/;
export const TEST_STEP = 'Run admitted Worker shard';
export const TEST_JOB = 'Admitted Worker shard';

const need = (condition, reason) => { if (!condition) throw new Error(reason); };
export const planDigest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

/** Main consumes the exact authenticated artifact; queue plans are deterministic and never timing weighted. */
export function verifiedPlan({ event, part, expectedDigest, artifactBytes, scripts, sourceRoot }) {
  need(PART.test(part), 'invalid_worker_shard');
  need(DIGEST.test(expectedDigest), 'invalid_plan_digest');
  let bytes;
  if (event === 'push') {
    need(typeof artifactBytes === 'string' || Buffer.isBuffer(artifactBytes), 'parent_plan_missing');
    bytes = Buffer.from(artifactBytes);
    need(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, 'parent_plan_size');
  } else {
    need(event === 'merge_group', 'unsupported_original_event');
    bytes = Buffer.from(JSON.stringify(buildPlan(scripts, {}, sourceRoot), null, 2) + '\n');
  }
  need(planDigest(bytes) === expectedDigest, 'plan_digest_mismatch');
  const plan = JSON.parse(bytes.toString('utf8'));
  const checked = validatePlan(plan, scripts, sourceRoot);
  need(checked.filter(row => row.name === part && row.script === 'test:worker').length === 1, 'requested_shard_missing');
  return bytes;
}

/** Actual runtime facts, not runner names/labels supplied by the caller. */
export function verifyRuntime(profile, { platform = process.platform, arch = process.arch, node = process.versions.node, sqlite } = {}) {
  need(profile && ['hosted', 'github-8', 'linux-x64', 'macos-arm64'].includes(profile.id), 'unknown_profile');
  need(platform === profile.platform && arch === profile.arch, 'runtime_platform_mismatch');
  need(/^22\.[0-9]+\.[0-9]+$/.test(node), 'unsupported_node_runtime');
  if (profile.nodeVersion) need(node === profile.nodeVersion, 'runtime_node_pin_mismatch');
  need(typeof sqlite === 'function' && sqlite() === true, 'sqlite_unavailable');
  return { platform, arch, node };
}

/** Reserved GitHub runner variables bound to one job; no caller-controlled filesystem names. */
export function ownedPaths({ runnerTemp, workspace, childRunId, childAttempt }) {
  need(ID.test(String(childRunId)) && ID.test(String(childAttempt)), 'invalid_child_identity');
  const temp = realpathSync(runnerTemp), root = realpathSync(workspace);
  need(temp !== '/' && root !== '/' && temp !== root, 'unsafe_runner_roots');
  const suffix = `studioos-executor-${childRunId}-${childAttempt}`;
  return { temp: join(temp, suffix), control: join(root, suffix + '-control'), source: join(root, suffix + '-source'), runnerTemp: temp, workspace: root, suffix };
}
export function prepareOwned(paths) {
  need(!lstatIfPresent(paths.temp)?.isSymbolicLink(), 'unsafe_owned_directory');
  mkdirSync(paths.temp, { recursive: true, mode: 0o700 });
  mkdirSync(join(paths.temp, 'tmp'), { recursive: true, mode: 0o700 });
  mkdirSync(join(paths.temp, 'home'), { recursive: true, mode: 0o700 });
  writeFileSync(join(paths.temp, '.runner-owner'), paths.suffix, { mode: 0o600 });
}
function lstatIfPresent(path) { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
/** rmSync never follows a top-level symlink; refuse altered parents/markers and touch only this exact run. */
export function cleanupOwned(paths) {
  need(dirname(paths.temp) === paths.runnerTemp && dirname(paths.control) === paths.workspace && dirname(paths.source) === paths.workspace, 'unsafe_cleanup_path');
  need(paths.temp === join(paths.runnerTemp, paths.suffix) && paths.control === join(paths.workspace, paths.suffix + '-control') && paths.source === join(paths.workspace, paths.suffix + '-source'), 'unsafe_cleanup_identity');
  const state = lstatIfPresent(paths.temp);
  if (state) {
    need(state.isDirectory() && !state.isSymbolicLink() && readFileSync(join(paths.temp, '.runner-owner'), 'utf8') === paths.suffix, 'cleanup_owner_mismatch');
  }
  // Refuse a replaced parent rather than resolving a candidate-controlled path outside the run.
  need(realpathSync(paths.runnerTemp) === paths.runnerTemp && realpathSync(paths.workspace) === paths.workspace, 'cleanup_parent_changed');
  for (const path of [paths.source, paths.control, paths.temp]) rmSync(path, { recursive: true, force: true });
}

export function originalTestContext(admitted, paths, baseEnv = process.env) {
  need(SHA.test(admitted.sourceSha) && PART.test(admitted.shard) && ID.test(String(admitted.originalRunId)) && ID.test(String(admitted.originalAttempt)), 'invalid_admitted_context');
  need(admitted.originalEvent === 'push' || admitted.originalEvent === 'merge_group', 'invalid_original_event');
  need(admitted.originalEvent === 'push' ? admitted.sourceRef === 'refs/heads/main' : /^refs\/heads\/gh-readonly-queue\/main\/pr-[1-9][0-9]*-[a-f0-9]{40}$/.test(admitted.sourceRef), 'invalid_original_ref');
  const event = admitted.originalEvent === 'merge_group'
    ? { merge_group: { base_sha: admitted.queueBaseSha, head_sha: admitted.sourceSha } }
    : { ref: 'refs/heads/main', after: admitted.sourceSha };
  if (admitted.originalEvent === 'merge_group') need(SHA.test(admitted.queueBaseSha), 'missing_queue_base');
  const eventPath = join(paths.temp, 'original-event.json');
  writeFileSync(eventPath, JSON.stringify(event), { mode: 0o600 });
  // An allowlist prevents ambient job/OIDC/provider tokens reaching test code.
  // This is defense in depth; verified OS isolation is a separate admission gate.
  const runtimeEnv=Object.fromEntries(['PATH','CI','LANG','LC_ALL','TZ','NODE_EXTRA_CA_CERTS'].filter(key=>typeof baseEnv[key]==='string').map(key=>[key,baseEnv[key]]));
  return { ...runtimeEnv, HOME: join(paths.temp, 'home'), GITHUB_EVENT_NAME: admitted.originalEvent, GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: admitted.sourceSha, GITHUB_REF: admitted.sourceRef, GITHUB_RUN_ID: String(admitted.originalRunId), GITHUB_RUN_ATTEMPT: String(admitted.originalAttempt),
    TEST_TRACE_DIR: join(paths.temp, 'test-traces'), TEST_TRACE_ROOT: paths.source, TMPDIR: join(paths.temp, 'tmp') };
}

/** Both the exact real test step and its owning job AND run must pass. No dispatcher/upload status is authority. */
export function childResult({ run, jobs }, owned) {
  const same = (a,b) => ID.test(String(a)) && String(a) === String(b);
  const expectedSha=owned.childWorkflowSha??owned.executorSha;
  if(owned.childWorkflowPath && owned.childWorkflowPath!=='.github/workflows/runner-executor.yml')return {outcome:'unknown',reason:'child_run_identity_mismatch'};
  if (!same(run?.id,owned.childRunId) || !same(run?.run_attempt,owned.childAttempt) || run?.path !== '.github/workflows/runner-executor.yml' || run?.repository?.full_name !== 'AxalNetwork/StudioOS' || run?.head_sha !== expectedSha) return { outcome:'unknown',reason:'child_run_identity_mismatch' };
  const selected=Array.isArray(jobs)?jobs.filter(job=>job.name===TEST_JOB):[];
  if (selected.length !== 1 || jobs.some(job=>!same(job.run_id,run.id)||!same(job.run_attempt,run.run_attempt)||job.head_sha!==expectedSha)) return { outcome:'unknown',reason:'child_job_identity_mismatch' };
  const job=selected[0],steps=job.steps?.filter(step=>step.name===TEST_STEP);
  if (!steps || steps.length !== 1) return {outcome:'unknown',reason:'test_step_not_unique'};
  const test=steps[0];
  if(test.status==='completed'&&test.conclusion==='failure')return {outcome:'test_failure',reason:'real_test_failure'};
  if(test.status==='completed'&&test.conclusion==='success'&&job.status==='completed'&&job.conclusion==='success'&&run.status==='completed'&&run.conclusion==='success'&&jobs.every(job=>job.status==='completed'&&job.conclusion==='success'))return {outcome:'success',reason:'verified_test_job_and_run'};
  return {outcome:'unknown',reason:'child_not_verified_success'};
}

/** Execute only a fixed candidate driver/shard from the admitted immutable checkout, without a shell or a caller-provided command. */
export async function executeShard({admitted,paths,testDriver,planPath,readReceipt,run=spawn,now=Date.now,signal,timers={setTimeout,clearTimeout},gitHead=path=>execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim(),killGroup=(pid,kind)=>process.kill(pid,kind),gitClean=path=>{execFileSync('git',['diff','--quiet'],{cwd:path});execFileSync('git',['diff','--cached','--quiet'],{cwd:path});return true;}}) {
  need(typeof readReceipt==='function','receipt_authority_unconfigured');
  const current=await readReceipt();
  need(current?.allowed===true&&JSON.stringify(current.identity)===JSON.stringify(admitted.identity),'receipt_superseded_before_execution');
  const deadlineRemaining=Number(admitted.executionDeadline)-now(),budget=EXECUTION_BUDGETS[admitted.identity.profile];
  need(Number.isSafeInteger(deadlineRemaining)&&deadlineRemaining>0&&budget,'execution_deadline_invalid');
  const remaining=Math.min(deadlineRemaining,budget.executionMs);
  need(realpathSync(testDriver)===join(realpathSync(paths.source),'scripts','test-drift-parts.mjs'),'invalid_test_driver');
  need(!signal?.aborted,'execution_cancelled');
  need(gitHead(paths.source)===admitted.sourceSha,'candidate_checkout_sha_mismatch');
  need(gitClean(paths.source)===true,'candidate_worktree_modified');
  const env=originalTestContext(admitted,paths);
  return await new Promise((accept,reject)=>{
    const child=run(process.execPath,[testDriver,admitted.shard,'--plan-file',planPath],{cwd:paths.source,env,shell:false,stdio:'inherit',detached:true});
    let expired=false,cancelled=false;
    const kill=kind=>{try{killGroup(-child.pid,kind);}catch{}};
    let cancellationTimer;
    const abort=()=>{cancelled=true;kill('SIGTERM');cancellationTimer=timers.setTimeout(()=>kill('SIGKILL'),5000);if(typeof cancellationTimer.unref==='function')cancellationTimer.unref();};
    signal?.addEventListener('abort',abort,{once:true});
    const timer=timers.setTimeout(()=>{expired=true;kill('SIGTERM');},remaining);
    if(typeof timer.unref==='function')timer.unref();
    const hardStop=timers.setTimeout(()=>{if(expired||cancelled)kill('SIGKILL');},remaining+5000);
    if(typeof hardStop.unref==='function')hardStop.unref();
    const clear=()=>{timers.clearTimeout(timer);timers.clearTimeout(hardStop);if(cancellationTimer)timers.clearTimeout(cancellationTimer);signal?.removeEventListener('abort',abort);};
    child.once('error',error=>{clear();kill('SIGKILL');reject(error);});
    child.once('close',(code,exitSignal)=>{clear();if(expired||cancelled)kill('SIGKILL');accept({code:cancelled?130:expired?124:code??1,signal:exitSignal??null,timedOut:expired,cancelled});});
  });
}

/** SIGINT/SIGTERM abort the returned signal for the whole body instead of killing the supervisor mid-run. */
export async function withCancellation(body,{signals=process}={}){
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 signals.once('SIGINT',cancel);signals.once('SIGTERM',cancel);
 try{return await body(cancellation.signal);}
 finally{signals.removeListener('SIGINT',cancel);signals.removeListener('SIGTERM',cancel);}
}

/** Cleanup needs enough lease left for exact inspect+rm (two 30s engine calls); export must leave it. */
const REMOVAL_RESERVE_MS=60000;

/**
 * Proposed supervisor exit (D8010): a real nonzero TEST exit first; then cancelled 130, timed out 124; zero only
 * for an observed test success whose removal was verified AND whose traces were exported to a completed offer.
 * An absent exporter or unverified cleanup is never successful proof. `category` is the coarse truth the
 * coordinator needs: success | test_failure | cancelled | timed_out | infrastructure | incomplete_cleanup.
 * `cleanupComplete` is always reported too, so a test failure with incomplete cleanup still says so.
 */
export function classifyOutcome({install,test,exported,cleanup,infrastructure,aborted}){
 const realTestFailure=test?.status==='failure'&&Number.isSafeInteger(test.exitCode)&&test.exitCode>0;
 const statuses=[install?.status,test?.status];
 const cancelled=statuses.includes('cancelled')||(aborted&&!realTestFailure&&test?.status!=='success');
 const timedOut=statuses.includes('timed_out');
 const testPassed=test?.status==='success';
 const exportOk=exported?.state==='complete';
 const cleanupOk=['complete','none'].includes(cleanup?.state);
 const result=realTestFailure?'test_failure':cancelled?'cancelled':timedOut?'timed_out'
  :infrastructure?'infrastructure':install&&install.status!=='success'?'install_failure'
  :testPassed&&!cleanupOk?'cleanup_failure':testPassed&&!exportOk?'export_failure':testPassed?'success':'unknown';
 const category={test_failure:'test_failure',cancelled:'cancelled',timed_out:'timed_out',cleanup_failure:'incomplete_cleanup',success:'success'}[result]??'infrastructure';
 const code=realTestFailure?test.exitCode:cancelled?130:timedOut?124:result==='success'?0:1;
 return {result,category,code,cleanupComplete:cleanupOk};
}

/** Installs and tests run only inside a verified execution boundary job; any other route refuses (#7905, D8007). */
export function requireExecutionBoundary(dependencies){
 need(dependencies?.job&&typeof dependencies.executionIsolation==='function','execution_boundary_unavailable');
 return dependencies.job;
}

/**
 * The supervisor owns the whole lifecycle: create, live re-admission, install, test, capture, bounded export,
 * then verified exact-ID removal. Ownership evidence is written to the durable store before start and removed
 * only once the engine reports the exact container gone; any failed or uncertain removal keeps it.
 */
export async function runInContainer({job,executionIsolation,admit,recheck=null,current,paths,planPath,signal,store,exporter=null,now=Date.now,log=console.error,output=null}){
 need(current?.profile?.id==='linux-x64'&&typeof executionIsolation==='function'&&typeof admit==='function'&&store,'container_profile_mismatch');
 const identity=current.identity;
 let record=null,infrastructure=null,install=null,test=null,exported={state:exporter?'not_run':'not_configured'},cleanup={state:'none'};
 job.onOwned=owned=>{store.write(owned);record=owned;};
 try{
  if(!signal?.aborted){
   job.create(identity,{source:paths.source,plan:planPath});
   if(!signal?.aborted){
    const live=await admit(executionIsolation);
    if(!(live?.allowed===true&&JSON.stringify(live.identity)===JSON.stringify(identity)))infrastructure='receipt_superseded_or_isolation_refused';
    else{
     install=await job.runCandidateInterruptible({receipt:identity,admitted:live,signal,phase:'install'});
     // D8007: the same verified boundary instance is re-checked before tests; a changed or unverifiable one stops here.
     const instance=job.boundaryIdentity?.()??null;
     if(install.status!=='success')test={phase:'test',status:'not_run',exitCode:null,signal:null};
     else if(!(instance&&typeof recheck==='function'&&await recheck()===true&&JSON.stringify(job.boundaryIdentity())===JSON.stringify(instance))){
      infrastructure='boundary_recheck_failed';test={phase:'test',status:'not_run',exitCode:null,signal:null};
     }else test=await job.runCandidateInterruptible({receipt:identity,admitted:live,signal,phase:'test'});
    }
   }
  }
 }catch(error){infrastructure=/^[a-z_]+$/.test(error?.message??'')?error.message:'unexpected';}
 // Capture/export while the container still exists, only inside the lease and never eating the removal reserve.
 if(exporter&&record&&job.owned){
  if(identity.executionDeadline-now()<=REMOVAL_RESERVE_MS)exported={state:'skipped_no_budget'};
  else{try{exported=await exporter({receipt:identity,container:{id:record.id,owner:record.owner},observedTest:test,signal,deadline:identity.executionDeadline-REMOVAL_RESERVE_MS});}
   catch{exported={state:'failed'};}}
 }
 if(record){
  try{
   job.cleanup(identity);
   if(job.verifyRemoved(record)){store.remove(record.owner);cleanup={state:'complete'};}
   else cleanup={state:'unverified',retained:true};
  }catch{cleanup={state:'failed',retained:true};}
 }
 const outcome=classifyOutcome({install,test,exported,cleanup,infrastructure,aborted:Boolean(signal?.aborted)});
 log(JSON.stringify({component:'runner-executor',event:'container_outcome',category:outcome.category,result:outcome.result,supervisorExit:outcome.code,cleanupComplete:outcome.cleanupComplete,install,test,export:exported,cleanup,infrastructure}));
 if(output)output({category:outcome.category,result:outcome.result,test_exit:test?.exitCode??'',cleanup:cleanup.state,export:exported.state});
 return outcome.code;
}

/**
 * Exact recovery from the durable store: remove the recorded container only while the engine still reports its
 * ID, label and name, and delete the record only once the engine reports it gone. A record whose recovery fails
 * or stays uncertain is kept for a later attempt. `select` limits which records this caller may act on.
 */
export async function recoverRetained(store,{recover,verifyRemoved,select=()=>true,log=console.error}){
 const results=[];
 for(const record of store.list()){
  if(record.invalid){results.push({record:record.invalid,state:'invalid_retained'});continue;}
  if(!select(record))continue;
  try{
   const outcome=recover(record);
   if(outcome==='removed'||outcome==='absent'){
    if(verifyRemoved(record)){store.remove(record.owner);results.push({owner:record.owner,state:outcome});}
    else results.push({owner:record.owner,state:'unverified_retained'});
   }else results.push({owner:record.owner,state:'unknown_retained'});
  }catch{results.push({owner:record.owner,state:'failed_retained'});}
 }
 if(results.length)log(JSON.stringify({component:'runner-executor',event:'container_recovery',results}));
 return results;
}

/** A reviewed adapter may be supplied by trusted code; no environment/request field injects receipt JSON as authority. */
export async function main(mode,env=process.env,dependencies={}){
 const paths=ownedPaths({runnerTemp:env.RUNNER_TEMP,workspace:env.GITHUB_WORKSPACE,childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT});
 if(mode==='prepare'){
  // A container a lost or failed earlier run left on this host is recovered exactly before new work; a record
  // that still cannot be recovered is kept, and does not block this run's own preparation.
  if(dependencies.store)await recoverRetained(dependencies.store,dependencies);
  prepareOwned(paths);return 0;
 }
 if(mode==='cleanup'){
  // This run's own records only. Its files are removed either way; a retained record fails the step visibly.
  const prefix=`${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-`;
  let retained=[];
  if(dependencies.store){
   try{retained=(await recoverRetained(dependencies.store,{...dependencies,select:r=>r.owner.startsWith(prefix)})).filter(r=>/retained$/.test(r.state));}
   catch{retained=[{state:'store_unreadable_retained'}];}
  }
  cleanupOwned(paths);
  need(retained.length===0,'container_recovery_retained');return 0;
 }
 need(mode==='verify-plan'||mode==='run','invalid_execution_mode');
 const initial=JSON.parse(env.ADMITTED_JSON??'null');
 need(initial?.allowed===true&&initial.identity,'initial_admission_missing');
 const {admitRunnerJob,githubReadApi}=await import('./runner-admission.mjs');
 const request={requestId:initial.identity.requestId,generation:initial.identity.generation,shard:initial.identity.logicalShard,profile:initial.identity.profile};
 const context={repository:env.GITHUB_REPOSITORY,executorSha:env.EXECUTOR_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowSha:env.CHILD_WORKFLOW_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowPath:env.CHILD_WORKFLOW_PATH??'.github/workflows/runner-executor.yml',childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT};
 const {job:_job,executionIsolation:_exec,admissionIsolation,store:_s,exporter:_e,recover:_r,verifyRemoved:_v,...admission}=dependencies;
 const readReceipt=()=>admitRunnerJob(request,{api:githubReadApi(env.GH_TOKEN),verifyIsolation:admissionIsolation,...admission,context,phase:'execute',signal:AbortSignal.timeout(60000)});
 const current=await readReceipt();need(current.allowed&&JSON.stringify(current.identity)===JSON.stringify(initial.identity),'receipt_superseded_before_execution');
 const sqlite=await import('node:sqlite');
 verifyRuntime(current.profile,{sqlite:()=>{const db=new sqlite.DatabaseSync(':memory:');try{return db.prepare('SELECT 1 AS ok').get().ok===1;}finally{db.close();}}});
 const python=execFileSync('python3',['-c','import platform,sqlite3,sys;print(platform.machine());print(platform.python_version());print(sqlite3.sqlite_version)'],{encoding:'utf8'}).trim().split('\n');
 need(python[0]===(current.profile.arch==='arm64'?'arm64':'x86_64')&&python[1]===current.profile.pythonVersion&&/^3\./.test(python[2]),'python_runtime_mismatch');
 need(execFileSync('git',['rev-parse','HEAD'],{cwd:paths.source,encoding:'utf8'}).trim()===current.sourceSha,'candidate_checkout_sha_mismatch');
 const scripts=JSON.parse(readFileSync(join(paths.source,'package.json'),'utf8')).scripts;
 const artifact=current.plan.mode==='parent-artifact'?readFileSync(join(paths.temp,'parent-plan','suite-plan.json')):null;
 const bytes=verifiedPlan({event:current.originalEvent,part:current.shard,expectedDigest:current.plan.digest,artifactBytes:artifact,scripts,sourceRoot:paths.source});
 const planPath=join(paths.temp,'suite-plan.json');writeFileSync(planPath,bytes,{mode:0o600});
 if(mode==='verify-plan'){
  console.log(JSON.stringify({profile:current.profile.id,runner:env.RUNNER_NAME??'unknown',source:current.sourceSha,executor:context.executorSha,part:current.shard,event:current.originalEvent,parentRun:current.originalRunId,parentAttempt:current.originalAttempt,planDigest:current.plan.digest,node:process.version,python:python[1],pythonSqlite:python[2],os:process.platform,arch:process.arch,cpu:availableParallelism(),memoryBytes:totalmem()}));
  return 0;
 }
 // Cancellation is live before any container exists, so a stop during create, re-admission or the run cleans up.
 return await withCancellation(async signal=>{
  {
   // Installs and tests run only inside a verified boundary job (the Linux container today); nothing runs on the host.
   const job=requireExecutionBoundary(dependencies);
   const {executionIsolation,job:_job,admissionIsolation:_pre,store:_store,exporter:_exporter,...rest}=dependencies;
   const exporter=dependencies.exporter??(await import('./runners/trace-exporter.mjs')).createTraceExporter({stagingRoot:join(paths.temp,'trace-export'),engine:job.engine});
   return runInContainer({job,executionIsolation,current,paths,planPath,signal,store:dependencies.store,exporter,
    recheck:()=>executionIsolation({receipt:current.identity,context,profile:current.profile,phase:'execute',signal}),
    output:env.GITHUB_OUTPUT?values=>appendFileSync(env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>`${k}=${v}\n`).join('')):null,
    admit:verifyIsolation=>admitRunnerJob(request,{api:githubReadApi(env.GH_TOKEN),...rest,verifyIsolation,context,phase:'execute',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])})});
  }
 });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const mode=process.argv[2];let dependencies={};
  if(mode==='run'||mode==='verify-plan'){
   const { isolationFor }=await import('./runners/executor-isolation.mjs');
   const { trustedAuthority }=await import('./executor-authority.mjs');
   dependencies={...await trustedAuthority(process.env),...(isolationFor(JSON.parse(process.env.ADMITTED_JSON??'null')?.identity?.profile)??{})};
  }
  if(mode==='run'&&dependencies.job){
   const { recoveryStore }=await import('./runners/recovery-store.mjs');
   dependencies.store=recoveryStore({create:true});
  }
  if(mode==='cleanup'||mode==='prepare'){
   const { JobContainer }=await import('./runners/job-container.mjs');
   const { recoveryStore }=await import('./runners/recovery-store.mjs');
   dependencies={store:recoveryStore(),recover:record=>JobContainer.recover(record),verifyRemoved:record=>JobContainer.isRemoved(record)};
  }
  process.exitCode=await main(mode,process.env,dependencies);}catch{console.error('runner_execution_denied_or_failed');process.exitCode=1;}
}
