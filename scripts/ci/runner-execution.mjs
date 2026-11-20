#!/usr/bin/env node
/** D7886 (#7886): exact-plan Worker execution, immutable event context, scoped cleanup and real child-result truth. */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  need(profile && ['hosted', 'linux-x64', 'macos-arm64'].includes(profile.id), 'unknown_profile');
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
  return { ...baseEnv, GITHUB_EVENT_NAME: admitted.originalEvent, GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: admitted.sourceSha, GITHUB_REF: admitted.sourceRef, GITHUB_RUN_ID: String(admitted.originalRunId), GITHUB_RUN_ATTEMPT: String(admitted.originalAttempt),
    TEST_TRACE_DIR: join(paths.temp, 'test-traces'), TEST_TRACE_ROOT: paths.source, TMPDIR: join(paths.temp, 'tmp') };
}

/** Both the exact real test step and its owning job AND run must pass. No dispatcher/upload status is authority. */
export function childResult({ run, jobs }, owned) {
  const same = (a,b) => ID.test(String(a)) && String(a) === String(b);
  const wrapper=owned.childWorkflowPath==='.github/workflows/runner-dispatch.yml',expectedSha=owned.childWorkflowSha??owned.executorSha;
  if(wrapper&&owned.workflowAttested!==true)return {outcome:'unknown',reason:'callee_not_attested'};
  if (!same(run?.id,owned.childRunId) || !same(run?.run_attempt,owned.childAttempt) || run?.path !== (wrapper?'.github/workflows/runner-dispatch.yml':'.github/workflows/runner-executor.yml') || run?.repository?.full_name !== 'AxalNetwork/StudioOS' || run?.head_sha !== expectedSha) return { outcome:'unknown',reason:'child_run_identity_mismatch' };
  const selected=Array.isArray(jobs)?jobs.filter(job=>job.name===(wrapper?'execute / '+TEST_JOB:TEST_JOB)):[];
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

/** A reviewed adapter may be supplied by trusted code; no environment/request field injects receipt JSON as authority. */
export async function main(mode,env=process.env,dependencies={}){
 const paths=ownedPaths({runnerTemp:env.RUNNER_TEMP,workspace:env.GITHUB_WORKSPACE,childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT});
 if(mode==='prepare'){prepareOwned(paths);return 0;}
 if(mode==='cleanup'){cleanupOwned(paths);return 0;}
 need(mode==='verify-plan'||mode==='run','invalid_execution_mode');
 const initial=JSON.parse(env.ADMITTED_JSON??'null');
 need(initial?.allowed===true&&initial.identity,'initial_admission_missing');
 const {admitRunnerJob,githubReadApi}=await import('./runner-admission.mjs');
 const request={requestId:initial.identity.requestId,generation:initial.identity.generation,shard:initial.identity.logicalShard,profile:initial.identity.profile};
 const context={repository:env.GITHUB_REPOSITORY,executorSha:env.EXECUTOR_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowSha:env.CHILD_WORKFLOW_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowPath:env.CHILD_WORKFLOW_PATH??'.github/workflows/runner-executor.yml',childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT};
 const readReceipt=()=>admitRunnerJob(request,{api:githubReadApi(env.GH_TOKEN),...dependencies,context,phase:'execute',signal:AbortSignal.timeout(60000)});
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
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{const result=await executeShard({admitted:current,paths,testDriver:join(paths.source,'scripts','test-drift-parts.mjs'),planPath,readReceipt,signal:cancellation.signal});return result.code;}
 finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{process.exitCode=await main(process.argv[2]);}catch{console.error('runner_execution_denied_or_failed');process.exitCode=1;}
}
