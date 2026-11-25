/** D7973: trusted reusable planner validates the exact plan then submits once and exits. D8626: and says whether it was accepted. */
import { openSync, closeSync, fstatSync, readSync, constants, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlan, validatePlan } from '../test-drift-parts.mjs';
import { githubOidcToken, submitCapacity } from './capacity-client.mjs';
import { createHash } from 'node:crypto';
/** Open once, bound actual bytes as well as metadata, and reject symlinks/special files. */
export function plannerFile(path,max){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=fstatSync(fd);if(!info.isFile()||info.size>max)throw new Error('planner_file_bound');
  const bytes=Buffer.alloc(max+1);let size=0;
  while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(n===0)break;size+=n;}
  if(size>max)throw new Error('planner_file_bound');
  return bytes.subarray(0,size).toString('utf8');
 }finally{closeSync(fd);}
}
export function plannerSubmission(env, mode='submit'){
 if(typeof env.CAPACITY_SUBMISSION!=='string'||Buffer.byteLength(env.CAPACITY_SUBMISSION)>16*1024)throw new Error('planner_submission_bound');
 const s=JSON.parse(env.CAPACITY_SUBMISSION);
 const event=JSON.parse(plannerFile(env.GITHUB_EVENT_PATH,1024*1024));
 if(env.GITHUB_REPOSITORY!=='AxalNetwork/StudioOS'||s.repository!==env.GITHUB_REPOSITORY||String(s.parentRunId)!==env.GITHUB_RUN_ID||String(s.parentAttempt)!==env.GITHUB_RUN_ATTEMPT||s.sourceSha!==env.GITHUB_SHA||s.event!==env.GITHUB_EVENT_NAME||s.executorSha!==env.CAPACITY_EXECUTOR_SHA||(s.childWorkflowSha!==undefined&&s.childWorkflowSha!==env.CAPACITY_CHILD_WORKFLOW_SHA)||!/^[a-f0-9]{40}$/.test(s.executorSha)||!['push','merge_group'].includes(s.event))throw new Error('planner_parent_mismatch');
 if(s.event==='push'?(env.GITHUB_REF!=='refs/heads/main'||s.queueBaseSha!==null||!Number.isSafeInteger(s.planArtifactId)||s.planArtifactId<=0):(s.queueBaseSha!==event.merge_group?.base_sha||s.sourceSha!==event.merge_group?.head_sha||s.planArtifactId!==null))throw new Error('planner_event_mismatch');
 if(mode==='metadata')return {artifact_id:s.planArtifactId??''};
 const root=resolve(env.CAPACITY_SOURCE_ROOT),scripts=JSON.parse(plannerFile(resolve(root,'package.json'),256*1024)).scripts;
 let plan;
 if(s.event==='push'){
  const path=resolve(env.CAPACITY_PLAN_FILE);
  plan=plannerFile(path,8*1024*1024);
 }else plan=JSON.stringify(buildPlan(scripts,{},root),null,2)+'\n';
 validatePlan(JSON.parse(plan),scripts,root);
 if('sha256:'+createHash('sha256').update(plan).digest('hex')!==s.planDigest)throw new Error('planner_digest_mismatch');
 return {submission:s,plan};
}
export async function main(env=process.env,dependencies={}){
 if(env.CI_CAPACITY_ENABLED!=='true')return {accepted:false,reason:'capacity_disabled'};
 // D8626: a merge-queue candidate is routed only under its own flag, never by CI_CAPACITY_ENABLED alone.
 if(env.GITHUB_EVENT_NAME==='merge_group'&&env.CI_CAPACITY_QUEUE_ROUTING!=='true')return {accepted:false,reason:'queue_routing_disabled'};
 if(env.CAPACITY_MODE==='metadata'){
  const values=plannerSubmission(env,'metadata');
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`artifact_id=${values.artifact_id}\n`);
  return values;
 }
 const {submission,plan}=plannerSubmission(env);
 const result=await submitCapacity(submission,{enabled:true,plan,url:env.CI_CAPACITY_URL,audience:env.CI_CAPACITY_AUDIENCE,oidcToken:githubOidcToken(env),...dependencies});
 // D8626: the caller skips a Worker part only on this output. It is true only for this exact request; anything
 // else (a refusal, a mismatched id, an error before this line) leaves it unset, and every part runs hosted.
 if(env.GITHUB_OUTPUT&&result?.accepted===true&&result.requestId===submission.requestId)appendFileSync(env.GITHUB_OUTPUT,`accepted=true\nrequest_id=${submission.requestId}\n`);
 return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{const result=await main();console.log(JSON.stringify(result));}catch{console.error('capacity planner refused');process.exitCode=1;}}
