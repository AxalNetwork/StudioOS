#!/usr/bin/env node
/** D7886 (#7886): fail-closed durable receipt admission and independent, bounded GitHub source/plan/child provenance. */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const REPOSITORY = 'AxalNetwork/StudioOS';
const CI_PATH = '.github/workflows/ci.yml';
const EXECUTOR_PATH = '.github/workflows/runner-executor.yml';
const DISPATCH_PATH = '.github/workflows/runner-dispatch.yml';
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REQUEST = /^[A-Za-z0-9-]{8,100}$/;
const SHARD = /^worker-[1-6]-of-6$/;
const QUEUE_BRANCH = /^gh-readonly-queue\/main\/pr-([1-9][0-9]*)-([a-f0-9]{40})$/;
export const ADMISSION_LIMITS = Object.freeze({ commits:100,queueEntries:32,runs:100,apiCalls:100 });
/** Bound to #7887's reviewed initial policy: hosted remains a real, independently budgeted execution pool. */
export const EXECUTION_BUDGETS=Object.freeze({
 hosted:Object.freeze({startMs:10*60000,executionMs:40*60000,jobMinutes:45,testMinutes:41}),
 'linux-x64':Object.freeze({startMs:90000,executionMs:25*60000,jobMinutes:35,testMinutes:26}),
 'macos-arm64':Object.freeze({startMs:90000,executionMs:25*60000,jobMinutes:35,testMinutes:26}),
});

class Denied extends Error {}
const requireThat = (condition,reason)=>{if(!condition)throw new Denied(reason);};
const sameId = (a,b)=>ID.test(String(a??''))&&String(a)===String(b);
const sameRepo=(repository,repo,id)=>repository?.full_name===repo&&sameId(repository.id,id);

/** The authority is an independently configured, authenticated coordinator read, NEVER request JSON. */
export function receiptIdentity(receipt){
 const fields=['version','requestId','repository','logicalShard','event','parentRunId','parentAttempt','parentWorkflowId','sourceSha','queueBaseSha','planDigest','planArtifactId','executorSha','profile','generation','childRunId','childAttempt','startDeadline','executionDeadline'];
 return Object.fromEntries(fields.map(key=>[key,receipt[key]]));
}
function validateReceipt(envelope,request,context,now,phase){
 requireThat(envelope?.active===true,'receipt_inactive_or_unknown');
 const receipt=envelope.receipt;
 requireThat(receipt&&receipt.version===1,'receipt_absent_or_unknown');
 requireThat(receipt.repository===REPOSITORY&&context.repository===REPOSITORY,'receipt_repository_mismatch');
 requireThat(REQUEST.test(receipt.requestId)&&receipt.requestId===request.requestId,'receipt_request_mismatch');
 requireThat(['parentRunId','parentAttempt','parentWorkflowId','generation','childRunId','childAttempt'].every(key=>Number.isSafeInteger(receipt[key])&&receipt[key]>0),'receipt_identity_invalid');
 requireThat(receipt.childAttempt===1&&Number(context.childAttempt)===1,'child_rerun_not_owned');
 requireThat(sameId(receipt.generation,request.generation),'receipt_generation_mismatch');
 requireThat(sameId(receipt.childRunId,context.childRunId)&&sameId(receipt.childAttempt,context.childAttempt),'receipt_child_mismatch');
 requireThat(SHA.test(receipt.sourceSha)&&SHA.test(receipt.executorSha)&&receipt.executorSha===context.executorSha,'receipt_source_or_executor_invalid');
 requireThat(['hosted','linux-x64','macos-arm64'].includes(receipt.profile)&&receipt.profile===request.profile,'receipt_profile_mismatch');
 requireThat(SHARD.test(receipt.logicalShard)&&receipt.logicalShard===request.shard,'receipt_shard_mismatch');
 requireThat(['push','merge_group'].includes(receipt.event),'receipt_original_event_invalid');
 requireThat(receipt.event==='push'?receipt.queueBaseSha===null:SHA.test(receipt.queueBaseSha),'receipt_original_base_invalid');
 requireThat(DIGEST.test(receipt.planDigest),'receipt_plan_invalid');
 requireThat(receipt.event==='push'?Number.isSafeInteger(receipt.planArtifactId)&&receipt.planArtifactId>0:receipt.planArtifactId===null,'receipt_plan_artifact_invalid');
 for(const key of ['startDeadline','executionDeadline'])requireThat(Number.isSafeInteger(receipt[key]),'receipt_time_invalid');
 const budget=EXECUTION_BUDGETS[receipt.profile];
 requireThat(receipt.executionDeadline>now&&receipt.executionDeadline<=now+budget.startMs+budget.executionMs&&receipt.startDeadline<receipt.executionDeadline&&receipt.executionDeadline-receipt.startDeadline<=budget.executionMs,'receipt_execution_deadline_invalid');
 if(phase==='start')requireThat(now<=receipt.startDeadline&&receipt.startDeadline<=now+budget.startMs,'receipt_start_deadline_elapsed');
 return receipt;
}

/** Resolved values come from #7885's trusted catalog adapter, never workflow inputs or receipt-supplied runs-on. */
export function executionTarget(profile){
 requireThat(profile&&['hosted','linux-x64','macos-arm64'].includes(profile.id),'unknown_profile');
 requireThat(/^22\.[0-9]+\.[0-9]+$/.test(profile.nodeVersion??'')&&/^3\.11\.[0-9]+$/.test(profile.pythonVersion??''),'profile_runtime_not_pinned');
 if(profile.id==='hosted'){
  requireThat(profile.target==='ubuntu-latest'&&profile.platform==='linux'&&profile.arch==='x64','invalid_hosted_target');return 'ubuntu-latest';
 }
 const linux=profile.id==='linux-x64',labels=['self-hosted',linux?'Linux':'macOS',linux?'X64':'ARM64','studioos-worker-v1'];
 requireThat(profile.platform===(linux?'linux':'darwin')&&profile.arch===(linux?'x64':'arm64'),'profile_platform_mismatch');
 requireThat(profile.target&&/^[A-Za-z0-9 ._-]{1,100}$/.test(profile.target.group??'')&&JSON.stringify(profile.target.labels)===JSON.stringify(labels),'invalid_self_hosted_target');
 requireThat(profile.eligibleShards?.every(shard=>SHARD.test(shard)),'invalid_profile_shards');
 // Mac v1 is bounded to the benchmarked shard; a shared capability label never widens it by itself.
 if(!linux)requireThat(profile.eligibleShards.length===1&&profile.eligibleShards[0]==='worker-1-of-6','unverified_mac_shards');
 return{group:profile.target.group,labels};
}

function parentIdentity(run,input,repoId){
 requireThat(sameId(run?.id,input.parentRunId)&&sameId(run.run_attempt,input.parentRunAttempt),'parent_attempt_mismatch');
 requireThat(run.path===CI_PATH&&run.head_sha===input.sourceSha,'parent_workflow_or_source_mismatch');
 requireThat(sameRepo(run.repository,input.repo,repoId)&&sameRepo(run.head_repository,input.repo,repoId),'parent_repository_mismatch');
 requireThat(run.event===input.originalEvent&&run.head_branch===input.sourceRef.slice(11)&&
  (run.event==='push'?run.head_branch==='main':QUEUE_BRANCH.test(run.head_branch??'')),'parent_event_or_ref_mismatch');
 // A submitter may have finished successfully. Its in-progress step is deliberately NOT execution authority.
 requireThat(['queued','in_progress','waiting','pending','requested'].includes(run.status)&&run.conclusion==null||run.status==='completed'&&run.conclusion==='success','parent_cancelled_or_failed');
}
async function parentPlan(get,prefix,input,repoId,receipt){
 const page=await get(`${prefix}/actions/runs/${input.parentRunId}/artifacts?name=suite-plan&per_page=100`);
 requireThat(Array.isArray(page?.artifacts)&&page.total_count===page.artifacts.length&&page.total_count<=100,'incomplete_parent_artifacts');
 const plans=page.artifacts.filter(row=>row.name==='suite-plan'&&row.expired===false);
 requireThat(plans.length===1,'parent_plan_not_unique');
 const plan=plans[0];
 requireThat(sameId(plan.id,receipt.planArtifactId)&&sameId(plan.workflow_run?.id,input.parentRunId)&&plan.workflow_run.head_sha===input.sourceSha&&sameId(plan.workflow_run.repository_id,repoId)&&sameId(plan.workflow_run.head_repository_id,repoId),'parent_plan_identity_mismatch');
}
function queueRunIdentity(run, sha, firstParent, input, repoId) {
  requireThat(run?.event === 'merge_group' && run.path === CI_PATH && run.head_sha === sha &&
    sameRepo(run.repository, input.repo, repoId) && sameRepo(run.head_repository, input.repo, repoId), 'queue_run_identity_mismatch');
  const branch = QUEUE_BRANCH.exec(run.head_branch ?? '');
  requireThat(branch && branch[2] === firstParent, 'queue_run_parent_mismatch');
  return branch[1];
}

function completeComparison(comparison, base, source) {
  requireThat(comparison?.status === 'ahead' && comparison.behind_by === 0 &&
    comparison.base_commit?.sha === base && comparison.merge_base_commit?.sha === base, 'queue_base_not_ancestor');
  requireThat(Number.isInteger(comparison.total_commits) && comparison.total_commits > 0 &&
    comparison.total_commits <= ADMISSION_LIMITS.commits && Array.isArray(comparison.commits) &&
    comparison.commits.length === comparison.total_commits && comparison.ahead_by === comparison.total_commits, 'incomplete_queue_comparison');
  const commits = new Map();
  for (const commit of comparison.commits) {
    requireThat(SHA.test(commit?.sha ?? '') && !commits.has(commit.sha) &&
      Array.isArray(commit.parents) && commit.parents.length >= 1 && commit.parents.length <= 2 &&
      commit.parents.every((parent) => SHA.test(parent?.sha ?? '')) &&
      new Set(commit.parents.map((parent) => parent.sha)).size === commit.parents.length, 'invalid_queue_commit_graph');
    commits.set(commit.sha, commit);
  }
  requireThat(commits.has(source) && !commits.has(base), 'queue_source_not_in_comparison');
  return commits;
}

async function proveQueue(get, prefix, input, parent, repoId) {
  const branch = parent.head_branch;
  const refPath = `${prefix}/git/ref/heads/${branch}`;
  const readRef = async (path, expectedRef) => {
    const ref = await get(path);
    requireThat(ref?.ref === expectedRef && ref.object?.type === 'commit' && SHA.test(ref.object.sha ?? ''), 'invalid_queue_ref');
    return ref.object.sha;
  };
  const mainPath = `${prefix}/git/ref/heads/main`;
  const main = await readRef(mainPath, 'refs/heads/main');
  requireThat(await readRef(refPath, `refs/heads/${branch}`) === input.sourceSha, 'queue_ref_changed');
  const comparison = await get(`${prefix}/compare/${main}...${input.sourceSha}?per_page=100`);
  const commits = completeComparison(comparison, main, input.sourceSha);
  const chain = new Set([main]);
  const covered = new Set();
  const pullRequests = new Set();

  // The complete comparison contains every commit reachable from source but not
  // from main. A parent outside it is therefore already in trusted main ancestry.
  // Secondary parents of merge-style queue entries belong to the verified PR.
  function coverBranch(sha, visiting = new Set()) {
    if (!commits.has(sha) || covered.has(sha)) return;
    requireThat(!visiting.has(sha), 'queue_graph_cycle');
    visiting.add(sha);
    for (const parent of commits.get(sha).parents) coverBranch(parent.sha, visiting);
    visiting.delete(sha);
    covered.add(sha);
  }

  let sha = input.sourceSha;
  while (sha !== main) {
    requireThat(chain.size <= ADMISSION_LIMITS.queueEntries && !chain.has(sha), 'queue_chain_limit_or_cycle');
    const commit = commits.get(sha);
    requireThat(commit, 'queue_chain_does_not_reach_main');
    chain.add(sha);
    const firstParent = commit.parents[0].sha;
    let identities;
    if (sha === input.sourceSha) {
      identities = [queueRunIdentity(parent, sha, firstParent, input, repoId)];
    } else {
      const page = await get(`${prefix}/actions/runs?event=merge_group&head_sha=${sha}&per_page=100`);
      requireThat(Array.isArray(page?.workflow_runs) && Number.isInteger(page.total_count) &&
        page.total_count === page.workflow_runs.length && page.total_count <= ADMISSION_LIMITS.runs, 'incomplete_queue_run_history');
      const runs = page.workflow_runs.filter((run) => run.path === CI_PATH && run.event === 'merge_group' && run.head_sha === sha);
      requireThat(runs.length > 0, 'queue_entry_has_no_authenticated_run');
      identities = runs.map((run) => queueRunIdentity(run, sha, firstParent, input, repoId));
    }
    requireThat(new Set(identities).size === 1 && !pullRequests.has(identities[0]), 'ambiguous_queue_entry');
    const number = identities[0];
    pullRequests.add(number);
    const pr = await get(`${prefix}/pulls/${number}`);
    requireThat(sameId(pr?.number, number) && pr.state === 'open' && pr.base?.ref === 'main' &&
      sameRepo(pr.base.repo, input.repo, repoId) && sameRepo(pr.head?.repo, input.repo, repoId) &&
      SHA.test(pr.head?.sha ?? ''), 'queue_pull_request_not_same_repository');
    if (commit.parents.length === 2) {
      requireThat(commit.parents[1].sha === pr.head.sha, 'queue_pull_request_head_changed');
      coverBranch(commit.parents[1].sha);
    }
    covered.add(sha);
    sha = firstParent;
  }
  requireThat(covered.size === commits.size, 'queue_graph_not_fully_covered');
  requireThat(chain.has(input.queueBaseSha), 'queue_event_base_not_proven');
  requireThat(await readRef(mainPath, 'refs/heads/main') === main, 'main_changed_during_admission');
  requireThat(await readRef(refPath, `refs/heads/${branch}`) === input.sourceSha, 'queue_ref_changed');
}

/** Unknown transport, unavailable evidence, revoked leases and any provenance mismatch deny before candidate checkout. */
export async function admitRunnerJob(request,{api,readReceipt,resolveProfile,context,now=Date.now,phase='start',signal}={}){
 const denied={allowed:false,reason:'admission_not_completed'};
 try{
  requireThat(phase==='start'||phase==='execute','invalid_admission_phase');
  requireThat(REQUEST.test(request?.requestId??'')&&ID.test(String(request?.generation??''))&&SHARD.test(request?.shard??'')&&['hosted','linux-x64','macos-arm64'].includes(request?.profile),'invalid_request');
  requireThat(context&&SHA.test(context.executorSha??'')&&ID.test(String(context.childRunId??''))&&ID.test(String(context.childAttempt??'')),'invalid_executor_context');
  requireThat(typeof readReceipt==='function','receipt_authority_unconfigured');
  requireThat(typeof api==='function','github_api_unavailable');
  requireThat(typeof resolveProfile==='function','profile_catalog_unavailable');
  const receipt=validateReceipt(await readReceipt({request,context,phase,signal}),request,context,now(),phase);
  const identity=receiptIdentity(receipt),profile=await resolveProfile(receipt.profile);
  const target=executionTarget(profile);
  requireThat(profile?.id===receipt.profile&&profile.eligibleShards?.includes(receipt.logicalShard),'profile_not_verified_for_shard');
  let calls=0;
  const get=async path=>{requireThat(!signal?.aborted,'admission_cancelled');requireThat(++calls<=ADMISSION_LIMITS.apiCalls,'admission_api_limit');return api('GET',path,undefined,{signal});};
  const prefix=`/repos/${REPOSITORY}`,runPath=`${prefix}/actions/runs/${receipt.parentRunId}`;
  const parent=await get(runPath),repoId=parent?.repository?.id;
  const input={repo:REPOSITORY,sourceSha:receipt.sourceSha,parentRunId:receipt.parentRunId,parentRunAttempt:receipt.parentAttempt,sourceRef:'refs/heads/'+parent.head_branch,originalEvent:receipt.event,queueBaseSha:receipt.queueBaseSha};
  requireThat(sameId(parent.workflow_id,receipt.parentWorkflowId),'parent_workflow_id_mismatch');
  parentIdentity(parent,input,repoId);parentIdentity(await get(`${runPath}/attempts/${receipt.parentAttempt}`),input,repoId);
  // V1 dispatches this trusted definition directly; no same-branch wrapper or candidate workflow is admitted.
  const child=await get(`${prefix}/actions/runs/${context.childRunId}`);
  requireThat(sameId(child?.id,context.childRunId)&&sameId(child.run_attempt,context.childAttempt)&&child.event==='workflow_dispatch'&&child.path===(context.childWorkflowPath??EXECUTOR_PATH)&&[EXECUTOR_PATH,DISPATCH_PATH].includes(child.path)&&child.head_branch==='main'&&child.head_sha===(context.childWorkflowSha??context.executorSha)&&child.status==='in_progress'&&child.conclusion==null&&sameRepo(child.repository,REPOSITORY,repoId)&&sameRepo(child.head_repository,REPOSITORY,repoId),'child_workflow_identity_mismatch');
  const workflow=await get(`${prefix}/actions/workflows/runner-executor.yml`);
  requireThat(workflow?.path===EXECUTOR_PATH&&workflow.state==='active','executor_workflow_unavailable');
  const childWorkflow=child.path===EXECUTOR_PATH?workflow:await get(`${prefix}/actions/workflows/runner-dispatch.yml`);
  requireThat(childWorkflow?.path===child.path&&childWorkflow.state==='active'&&sameId(child.workflow_id,childWorkflow.id),'child_workflow_definition_mismatch');
  const main=await get(`${prefix}/git/ref/heads/main`);
  requireThat(main?.ref==='refs/heads/main'&&main.object?.type==='commit'&&SHA.test(main.object.sha??''),'trusted_main_ref_unavailable');
  const ancestry=await get(`${prefix}/compare/${context.executorSha}...${main.object.sha}?per_page=100`);
  requireThat(['identical','ahead'].includes(ancestry?.status)&&ancestry.base_commit?.sha===context.executorSha&&ancestry.merge_base_commit?.sha===context.executorSha,'executor_revision_not_on_main');
  if(receipt.event==='push')await parentPlan(get,prefix,input,repoId,receipt);else await proveQueue(get,prefix,input,parent,repoId);
  parentIdentity(await get(runPath),input,repoId);
  const final=validateReceipt(await readReceipt({request,context,phase,signal}),request,context,now(),phase);
  requireThat(JSON.stringify(receiptIdentity(final))===JSON.stringify(identity),'receipt_superseded_during_admission');
  return{allowed:true,reason:'durable_receipt_and_github_provenance',identity,profile,target,sourceSha:receipt.sourceSha,sourceRef:'refs/heads/'+parent.head_branch,originalEvent:receipt.event,originalRunId:receipt.parentRunId,originalAttempt:receipt.parentAttempt,queueBaseSha:receipt.queueBaseSha,shard:receipt.logicalShard,plan:{mode:receipt.event==='push'?'parent-artifact':'equal-weights',digest:receipt.planDigest,artifactId:receipt.planArtifactId},executionDeadline:receipt.executionDeadline};
 }catch(error){return{...denied,reason:error instanceof Denied?error.message:signal?.aborted?'admission_cancelled':'admission_evidence_unavailable'};}
}
export function githubReadApi(token, fetcher = globalThis.fetch) {
  return async (method, path, _body, { signal } = {}) => {
    requireThat(method === 'GET' && path.startsWith(`/repos/${REPOSITORY}/`) &&
      !/(^|\/)\.\.(\/|$)/.test(path) && !path.includes('\\'), 'invalid_admission_api_request');
    requireThat(typeof token === 'string' && token.length > 0, 'missing_github_token');
    const timeout = AbortSignal.timeout(10_000);
    const response = await fetcher(`https://api.github.com${path}`, {
      method: 'GET', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error('GitHub metadata request failed');
    return response.json();
  };
}

/** Stage-one CLI deliberately has no coordinator credential or guessed trust endpoint. #7887 must supply the reviewed transport. */
export async function main(env=process.env,dependencies={}){
 const result=await admitRunnerJob({requestId:env.REQUEST_ID,generation:env.LEASE_GENERATION,shard:env.PART,profile:env.PROFILE},{
  context:{repository:env.GITHUB_REPOSITORY,executorSha:env.EXECUTOR_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowSha:env.CHILD_WORKFLOW_SHA??env.GITHUB_WORKFLOW_SHA,childWorkflowPath:env.CHILD_WORKFLOW_PATH??EXECUTOR_PATH,childRunId:env.GITHUB_RUN_ID,childAttempt:env.GITHUB_RUN_ATTEMPT},
  api:githubReadApi(env.GH_TOKEN),signal:AbortSignal.timeout(60000),...dependencies,
 });
 const values={allowed:String(result.allowed),reason:result.reason};
 if(result.allowed)Object.assign(values,{source_sha:result.sourceSha,parent_run_id:result.originalRunId,plan_artifact_id:result.plan.artifactId??'',plan_mode:result.plan.mode,node_version:result.profile.nodeVersion,python_version:result.profile.pythonVersion,target:JSON.stringify(result.target),job_timeout:EXECUTION_BUDGETS[result.profile.id].jobMinutes,test_timeout:EXECUTION_BUDGETS[result.profile.id].testMinutes,admitted_json:JSON.stringify(result)});
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));
 console.log(JSON.stringify({allowed:result.allowed,reason:result.reason}));return result.allowed?0:1;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await main();
