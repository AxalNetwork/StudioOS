/** D7973: trusted reusable planner validates the exact plan then submits once and exits. */
import { appendFileSync, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlan, validatePlan } from '../test-drift-parts.mjs';
import { githubOidcToken, submitCapacity } from './capacity-client.mjs';
import { createHash } from 'node:crypto';
export function plannerSubmission(env, mode='submit'){
 const s=JSON.parse(env.CAPACITY_SUBMISSION);
 const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'));
 if(env.GITHUB_REPOSITORY!=='AxalNetwork/StudioOS'||s.repository!==env.GITHUB_REPOSITORY||String(s.parentRunId)!==env.GITHUB_RUN_ID||String(s.parentAttempt)!==env.GITHUB_RUN_ATTEMPT||s.sourceSha!==env.GITHUB_SHA||s.event!==env.GITHUB_EVENT_NAME||s.executorSha!==env.CAPACITY_EXECUTOR_SHA||!/^[a-f0-9]{40}$/.test(s.executorSha)||!['push','merge_group'].includes(s.event))throw new Error('planner_parent_mismatch');
 if(s.event==='push'?(env.GITHUB_REF!=='refs/heads/main'||s.queueBaseSha!==null||!Number.isSafeInteger(s.planArtifactId)||s.planArtifactId<=0):(s.queueBaseSha!==event.merge_group?.base_sha||s.sourceSha!==event.merge_group?.head_sha||s.planArtifactId!==null))throw new Error('planner_event_mismatch');
 if(mode==='metadata')return {artifact_id:s.planArtifactId??''};
 const root=resolve(env.CAPACITY_SOURCE_ROOT),scripts=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).scripts;
 let plan;
 if(s.event==='push'){
  // One open handle: the size bound and the read see the same file, so it cannot be swapped between them.
  const fd=openSync(resolve(env.CAPACITY_PLAN_FILE),'r');
  try {
   const st=fstatSync(fd);
   if(!st.isFile()||st.size>8*1024*1024)throw new Error('planner_plan_bound');
   plan=readFileSync(fd,'utf8');
  } finally { closeSync(fd); }
 }else plan=JSON.stringify(buildPlan(scripts,{},root),null,2)+'\n';
 validatePlan(JSON.parse(plan),scripts,root);
 if('sha256:'+createHash('sha256').update(plan).digest('hex')!==s.planDigest)throw new Error('planner_digest_mismatch');
 return {submission:s,plan};
}
export async function main(env=process.env,dependencies={}){
 if(env.CI_CAPACITY_ENABLED!=='true')return {accepted:false,reason:'capacity_disabled'};
 if(env.CAPACITY_MODE==='metadata'){
  const values=plannerSubmission(env,'metadata');
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`artifact_id=${values.artifact_id}\n`);
  return values;
 }
 const {submission,plan}=plannerSubmission(env);
 return submitCapacity(submission,{enabled:true,plan,url:env.CI_CAPACITY_URL,audience:env.CI_CAPACITY_AUDIENCE,oidcToken:githubOidcToken(env),...dependencies});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){try{const result=await main();console.log(JSON.stringify(result));}catch{console.error('capacity planner refused');process.exitCode=1;}}
