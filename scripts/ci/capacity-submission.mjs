/** D7909: bounded pilot metadata, without OIDC or waiting; authority/planner independently verify it. D8626: the merge-queue contract. */
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { plannerFile } from './capacity-planner.mjs';
import { capacityJson } from './capacity-client.mjs';
import { buildPlan } from '../test-drift-parts.mjs';
const REPOSITORY='AxalNetwork/StudioOS';
/** The App-owned check the coordinator posts on a routed candidate. Routing never starts unless main requires it. */
export const FULL_SUITE_CHECK='ci-capacity/full-suite';
const QUEUE_REF=/^refs\/heads\/(gh-readonly-queue\/main\/pr-[1-9][0-9]*-([a-f0-9]{40}))$/;
const SHA=/^[a-f0-9]{40}$/;
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&/^[1-9][0-9]{0,14}$/.test(String(value));
export const PILOT_PREREQUISITES=Object.freeze(['ci / fast','test deps','api ↔ worker drift']);
/**
 * D8626: whether main's live rules require `ci-capacity/full-suite` from one GitHub App. A context any token could
 * post as a commit status is not enough: the entry must name its App (`integration_id`), and when the expected App
 * id is configured, that App. Anything unreadable or malformed is `false`.
 */
export function fullSuiteRequired(rules,appId){
 if(!Array.isArray(rules))return false;
 if(appId!==undefined&&appId!==''&&!positive(appId))return false;
 return rules.some(rule=>rule?.type==='required_status_checks'&&Array.isArray(rule.parameters?.required_status_checks)
  &&rule.parameters.required_status_checks.some(check=>check?.context===FULL_SUITE_CHECK&&positive(check.integration_id)
   &&(appId===undefined||appId===''||Number(check.integration_id)===Number(appId))));
}
function requestIdOf(runId,attempt){
 const bytes=createHash('sha256').update(`${REPOSITORY}\0${runId}\0${attempt}`).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function capacitySubmission(env=process.env,api){
 if(env.CI_CAPACITY_ENABLED!=='true')return {accepted:false,reason:'capacity_disabled'};
 const queue=env.GITHUB_EVENT_NAME==='merge_group';
 // D8626: the queue has its own flag, switched on only with the ruleset change that requires FULL_SUITE_CHECK.
 if(queue&&env.CI_CAPACITY_QUEUE_ROUTING!=='true')return {accepted:false,reason:'queue_routing_disabled'};
 // D7881's Mac handoff would run a routed Worker part a second time. The two never run together.
 if(queue&&env.MACBOOK_WORKER_ENABLED==='true')return {accepted:false,reason:'macbook_worker_enabled'};
 const ref=queue?QUEUE_REF.exec(env.GITHUB_REF??''):null;
 // Main pushes and merge-queue candidates only. Pull-request CI keeps its runner-free planning contract.
 if(env.GITHUB_REPOSITORY!==REPOSITORY||(queue?!ref:(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main'))
  ||!positive(env.GITHUB_RUN_ID)||!positive(env.GITHUB_RUN_ATTEMPT)||(queue?env.CAPACITY_PLAN_ARTIFACT_ID!==undefined&&env.CAPACITY_PLAN_ARTIFACT_ID!=='':!positive(env.CAPACITY_PLAN_ARTIFACT_ID))
  ||!SHA.test(env.GITHUB_SHA??'')||!SHA.test(env.CI_CAPACITY_EXECUTOR_SHA??'')||(env.CI_CAPACITY_CHILD_WORKFLOW_SHA!==undefined&&!SHA.test(env.CI_CAPACITY_CHILD_WORKFLOW_SHA)))throw Error('capacity_submission_context');
 let queueBaseSha=null;
 if(queue){
  const group=JSON.parse(plannerFile(env.GITHUB_EVENT_PATH,1024*1024)).merge_group;
  if(group?.head_sha!==env.GITHUB_SHA||group.head_ref!==env.GITHUB_REF||!SHA.test(group.base_sha??'')||group.base_sha!==ref[2])throw Error('capacity_submission_context');
  queueBaseSha=group.base_sha;
 }
 const read=api??(async(method,path)=>{
  if(typeof env.GH_TOKEN!=='string'||!env.GH_TOKEN)throw Error('capacity_submission_token');
  return capacityJson(await fetch(`https://api.github.com${path}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}}),128*1024);
 });
 // D8626: before anything is submitted, main must already require the coordinator's App-owned result. Otherwise a
 // routed candidate's skipped Worker parts would leave `test:drift (full suite)` green with nothing holding the merge.
 if(queue&&!fullSuiteRequired(await read('GET',`/repos/${REPOSITORY}/rules/branches/main`),env.CI_CAPACITY_FULL_SUITE_APP_ID))return {accepted:false,reason:'full_suite_not_required'};
 const path=`/repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
 const run=await read('GET',path);
 if(run?.id!==Number(env.GITHUB_RUN_ID)||run.run_attempt!==Number(env.GITHUB_RUN_ATTEMPT)||!positive(run.workflow_id)
  ||run.path!=='.github/workflows/ci.yml'||run.head_sha!==env.GITHUB_SHA||run.event!==(queue?'merge_group':'push')||run.head_branch!==(queue?ref[1]:'main')
  ||run.repository?.full_name!==REPOSITORY||run.head_repository?.full_name!==REPOSITORY
  ||run.repository?.id!==run.head_repository?.id)throw Error('capacity_submission_parent');
 // A push submits the plan its `plan` job uploaded, which is the equal-weight plan of this commit (D8693): the bytes
 // every hosted suite part writes and capacity-planner.mjs requires. A queue candidate has no plan job (D7108 part 2):
 // it submits the equal-weight plan of its own checkout, the same bytes capacity-planner.mjs rebuilds from the candidate.
 const root=resolve(env.CAPACITY_SOURCE_ROOT??'.');
 const plan=queue?JSON.stringify(buildPlan(JSON.parse(plannerFile(resolve(root,'package.json'),256*1024)).scripts,{},root),null,2)+'\n'
  :plannerFile(env.CAPACITY_PLAN_FILE,8*1024*1024);
 const submission={version:1,requestId:requestIdOf(run.id,run.run_attempt),repository:REPOSITORY,parentRunId:run.id,parentAttempt:run.run_attempt,parentWorkflowId:run.workflow_id,
  event:queue?'merge_group':'push',sourceSha:env.GITHUB_SHA,queueBaseSha,executorSha:env.CI_CAPACITY_EXECUTOR_SHA,...(env.CI_CAPACITY_CHILD_WORKFLOW_SHA?{childWorkflowSha:env.CI_CAPACITY_CHILD_WORKFLOW_SHA}:{}),
  planDigest:'sha256:'+createHash('sha256').update(plan).digest('hex'),planArtifactId:queue?null:Number(env.CAPACITY_PLAN_ARTIFACT_ID),
  shards:Array.from({length:6},(_,i)=>`worker-${i+1}-of-6`),prerequisites:[...PILOT_PREREQUISITES]};
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`capacity_submission=${JSON.stringify(submission)}\n`);
 return submission;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{const result=await capacitySubmission();if(result.accepted===false)console.log(`capacity submission not prepared: ${result.reason}`);}catch{console.error('capacity submission metadata refused');process.exitCode=1;}
}
