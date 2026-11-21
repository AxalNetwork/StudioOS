/** D7909: bounded pilot metadata, without OIDC or waiting; authority/planner independently verify it. */
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { plannerFile } from './capacity-planner.mjs';
import { capacityJson } from './capacity-client.mjs';
const REPOSITORY='AxalNetwork/StudioOS';
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&/^[1-9][0-9]{0,14}$/.test(String(value));
export const PILOT_PREREQUISITES=Object.freeze(['ci / fast','test deps','api ↔ worker drift']);
export async function capacitySubmission(env=process.env,api){
 if(env.CI_CAPACITY_ENABLED!=='true')return {accepted:false,reason:'capacity_disabled'};
 // The first pilot is main-push only. Queue/PR CI keeps its existing runner-free planning contract.
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main'
  ||!positive(env.GITHUB_RUN_ID)||!positive(env.GITHUB_RUN_ATTEMPT)||!positive(env.CAPACITY_PLAN_ARTIFACT_ID)
  ||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||!/^[a-f0-9]{40}$/.test(env.CI_CAPACITY_EXECUTOR_SHA??''))throw Error('capacity_submission_context');
 const path=`/repos/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
 const read=api??(async()=>{
  if(typeof env.GH_TOKEN!=='string'||!env.GH_TOKEN)throw Error('capacity_submission_token');
  return capacityJson(await fetch(`https://api.github.com${path}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:`Bearer ${env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}}),128*1024);
 });
 const run=await read('GET',path);
 if(run?.id!==Number(env.GITHUB_RUN_ID)||run.run_attempt!==Number(env.GITHUB_RUN_ATTEMPT)||!positive(run.workflow_id)
  ||run.path!=='.github/workflows/ci.yml'||run.head_sha!==env.GITHUB_SHA||run.event!=='push'||run.head_branch!=='main'
  ||run.repository?.full_name!==REPOSITORY||run.head_repository?.full_name!==REPOSITORY
  ||run.repository?.id!==run.head_repository?.id)throw Error('capacity_submission_parent');
 const plan=plannerFile(env.CAPACITY_PLAN_FILE,8*1024*1024);
 const bytes=createHash('sha256').update(`${REPOSITORY}\0${run.id}\0${run.run_attempt}`).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex'),requestId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 const submission={version:1,requestId,repository:REPOSITORY,parentRunId:run.id,parentAttempt:run.run_attempt,parentWorkflowId:run.workflow_id,
  event:'push',sourceSha:env.GITHUB_SHA,queueBaseSha:null,executorSha:env.CI_CAPACITY_EXECUTOR_SHA,
  planDigest:'sha256:'+createHash('sha256').update(plan).digest('hex'),planArtifactId:Number(env.CAPACITY_PLAN_ARTIFACT_ID),
  shards:Array.from({length:6},(_,i)=>`worker-${i+1}-of-6`),prerequisites:[...PILOT_PREREQUISITES]};
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`capacity_submission=${JSON.stringify(submission)}\n`);
 return submission;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{await capacitySubmission();}catch{console.error('capacity submission metadata refused');process.exitCode=1;}
}
