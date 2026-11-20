/** D7886 (#7886): durable authority replaces a waiting parent; every receipt/source/child/queue identity is independently checked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitRunnerJob, main, githubReadApi } from '../../scripts/ci/runner-admission.mjs';
const SHA='a'.repeat(40),EXEC='e'.repeat(40),BASE='b'.repeat(40),PR_HEAD='c'.repeat(40),EARLIER='d'.repeat(40),EARLIER_HEAD='f'.repeat(40);
const NOW=1_800_000_000_000,REPO='AxalNetwork/StudioOS',PREFIX='/repos/'+REPO;
const clone=value=>structuredClone(value);
function fixture(event='push'){
 const repo={id:1191713997,full_name:REPO};
 const receipt={version:1,requestId:'request-7886',repository:REPO,logicalShard:'worker-1-of-6',event,parentRunId:101,parentAttempt:2,parentWorkflowId:77,sourceSha:SHA,queueBaseSha:event==='merge_group'?BASE:null,planDigest:'sha256:'+'1'.repeat(64),planArtifactId:event==='merge_group'?null:505,executorSha:EXEC,profile:'hosted',generation:3,childRunId:202,childAttempt:1,startDeadline:NOW+60_000,executionDeadline:NOW+1_000_000};
 const parent={id:101,run_attempt:2,workflow_id:77,path:'.github/workflows/ci.yml',head_sha:SHA,status:'completed',conclusion:'success',event,head_branch:event==='push'?'main':`gh-readonly-queue/main/pr-12-${BASE}`,repository:repo,head_repository:repo};
 const child={id:202,run_attempt:1,workflow_id:88,path:'.github/workflows/runner-executor.yml',head_sha:EXEC,head_branch:'main',event:'workflow_dispatch',status:'in_progress',conclusion:null,repository:repo,head_repository:repo};
 const map=new Map([
  [PREFIX+'/actions/runs/101',parent],[PREFIX+'/actions/runs/101/attempts/2',clone(parent)],
  [PREFIX+'/actions/runs/202',child],
  [PREFIX+'/actions/workflows/runner-executor.yml',{id:88,path:'.github/workflows/runner-executor.yml',state:'active'}],
  [PREFIX+'/git/ref/heads/main',{ref:'refs/heads/main',object:{type:'commit',sha:BASE}}],
  [PREFIX+`/compare/${EXEC}...${BASE}?per_page=100`,{status:'ahead',base_commit:{sha:EXEC},merge_base_commit:{sha:EXEC}}],
  [PREFIX+'/actions/runs/101/artifacts?name=suite-plan&per_page=100',{total_count:1,artifacts:[{id:505,name:'suite-plan',expired:false,workflow_run:{id:101,head_sha:SHA,repository_id:repo.id,head_repository_id:repo.id}}]}],
 ]);
 if(event==='merge_group'){
  map.set(PREFIX+'/git/ref/heads/'+parent.head_branch,{ref:'refs/heads/'+parent.head_branch,object:{type:'commit',sha:SHA}});
  map.set(PREFIX+`/compare/${BASE}...${SHA}?per_page=100`,{status:'ahead',behind_by:0,ahead_by:2,total_commits:2,base_commit:{sha:BASE},merge_base_commit:{sha:BASE},commits:[{sha:PR_HEAD,parents:[{sha:BASE}]},{sha:SHA,parents:[{sha:BASE},{sha:PR_HEAD}]}]});
  map.set(PREFIX+'/pulls/12',{number:12,state:'open',base:{ref:'main',repo},head:{sha:PR_HEAD,repo}});
 }
 const request={requestId:receipt.requestId,generation:receipt.generation,shard:receipt.logicalShard,profile:receipt.profile};
 const context={repository:REPO,executorSha:EXEC,childRunId:202,childAttempt:1};
 const calls=[];let reads=0;
 const profile={id:'hosted',platform:'linux',arch:'x64',target:'ubuntu-latest',nodeVersion:'22.16.0',pythonVersion:'3.11.11',eligibleShards:Array.from({length:6},(_,i)=>`worker-${i+1}-of-6`)};
 const deps={verifyIsolation:async()=>true,api:async(method,path)=>{assert.equal(method,'GET');calls.push(path);assert.ok(map.has(path),'unexpected API read '+path);return clone(map.get(path));},readReceipt:async()=>{reads++;return{active:true,receipt:clone(receipt)};},resolveProfile:async()=>clone(profile),context,now:()=>NOW};
 return{receipt,parent,child,map,request,context,deps,calls,profile,reads:()=>reads};
}
const admit=f=>admitRunnerJob(f.request,f.deps);

test('a completed successful submitter plus a current durable receipt admits the hosted profile without any waiting delegation step',async()=>{
 const f=fixture(),result=await admit(f);assert.equal(result.allowed,true,JSON.stringify(result));assert.equal(result.sourceSha,SHA);assert.equal(result.plan.artifactId,505);assert.equal(result.originalRunId,101);assert.equal(f.reads(),2);assert.ok(!f.calls.some(path=>path.includes('/jobs')));
});
test('missing, revoked, unknown and superseded receipt authority cannot be replaced by caller JSON',async()=>{
 for(const envelope of [null,{active:false},{active:false,receipt:fixture().receipt},{active:true,receipt:null},{active:true,receipt:{version:99}}]){
  const f=fixture();f.deps.readReceipt=async()=>envelope;f.request.receipt=f.receipt;const result=await admit(f);assert.equal(result.allowed,false);assert.equal(f.calls.length,0);
 }
 const unconfigured=fixture();delete unconfigured.deps.readReceipt;assert.equal((await admit(unconfigured)).reason,'receipt_authority_unconfigured');
 const revoked=fixture();let n=0;revoked.deps.readReceipt=async()=>++n===1?{active:true,receipt:clone(revoked.receipt)}:{active:false};assert.equal((await admit(revoked)).allowed,false);
 const changed=fixture();n=0;changed.deps.readReceipt=async()=>({active:true,receipt:{...changed.receipt,generation:++n===1?3:4}});assert.equal((await admit(changed)).reason,'receipt_generation_mismatch');
});
test('each receipt binding, original attempt, source, plan, executor, child and time boundary is fail closed',async()=>{
 const changes={requestId:'different-7886',repository:'Other/Repo',logicalShard:'worker-2-of-6',event:'pull_request',parentRunId:303,parentAttempt:1,parentWorkflowId:99,sourceSha:PR_HEAD,queueBaseSha:BASE,planDigest:'1'.repeat(64),planArtifactId:506,executorSha:PR_HEAD,profile:'macos-arm64',generation:4,childRunId:999,childAttempt:2,startDeadline:NOW-1,executionDeadline:NOW};
 for(const [field,value]of Object.entries(changes)){
  const f=fixture();f.receipt[field]=value;const result=await admit(f);assert.equal(result.allowed,false,field+' was admitted');
 }
 const wrongProfile=fixture();wrongProfile.receipt.profile='macos-arm64';wrongProfile.deps.resolveProfile=async()=>({id:'macos-arm64',platform:'darwin',arch:'arm64',nodeVersion:'22.16.0',pythonVersion:'3.11.11',eligibleShards:['worker-1-of-6'],target:{group:'Synthetic Reviewed Group',labels:['self-hosted','macOS','ARM64','studioos-worker-v1']}});assert.equal((await admit(wrongProfile)).allowed,false);
 const rerun=fixture();rerun.receipt.childAttempt=2;rerun.context.childAttempt=2;rerun.child.run_attempt=2;assert.equal((await admit(rerun)).reason,'child_rerun_not_owned');
 const stringId=fixture();stringId.receipt.parentRunId='101';assert.equal((await admit(stringId)).reason,'receipt_identity_invalid');
 const far=fixture();far.receipt.executionDeadline=NOW+51*60_000;assert.equal((await admit(far)).allowed,false);
 const hostedBudget=fixture();hostedBudget.receipt.startDeadline=NOW+10*60000;hostedBudget.receipt.executionDeadline=NOW+50*60000;assert.equal((await admit(hostedBudget)).allowed,true);
 const executing=fixture();executing.receipt.startDeadline=NOW-30_000;assert.equal((await admitRunnerJob(executing.request,{...executing.deps,phase:'execute'})).allowed,true);
 assert.equal((await admitRunnerJob(executing.request,{...executing.deps,phase:'arbitrary'})).reason,'invalid_admission_phase');
});
test('GitHub provenance refuses a fork, cancelled parent, rerun, branch executor, foreign workflow and unknown main ancestry',async()=>{
 const changes=[
  f=>{f.parent.head_repository={id:9,full_name:'Fork/StudioOS'};},
  f=>{f.parent.conclusion='cancelled';},f=>{f.parent.run_attempt=3;},
  f=>{f.child.head_branch='feature';},f=>{f.child.head_sha=PR_HEAD;},f=>{f.child.path='.github/workflows/unselected.yml';},f=>{f.child.status='completed';},f=>{f.child.workflow_id=999;},
  f=>{f.map.get(PREFIX+'/actions/workflows/runner-executor.yml').state='disabled_manually';},
  f=>{f.map.get(PREFIX+`/compare/${EXEC}...${BASE}?per_page=100`).status='diverged';},
  f=>{f.map.get(PREFIX+'/actions/runs/101/artifacts?name=suite-plan&per_page=100').artifacts[0].expired=true;},
  f=>{f.map.get(PREFIX+'/actions/runs/101/artifacts?name=suite-plan&per_page=100').total_count=2;},
 ];
 for(const change of changes){const f=fixture();change(f);assert.equal((await admit(f)).allowed,false);}
 const unavailable=fixture();unavailable.deps.api=async()=>{throw Error('synthetic private diagnostic');};const result=await admit(unavailable);assert.equal(result.reason,'admission_evidence_unavailable');assert.doesNotMatch(JSON.stringify(result),/private diagnostic/);
});
test('every constituent of a merge group is proven; a same-repository top PR cannot hide a fork underneath',async()=>{
 const f=fixture('merge_group');assert.equal((await admit(f)).allowed,true);
 f.parent.head_branch=`gh-readonly-queue/main/pr-12-${EARLIER}`;
 f.map.get(PREFIX+'/actions/runs/101/attempts/2').head_branch=f.parent.head_branch;
 f.map.set(PREFIX+'/git/ref/heads/'+f.parent.head_branch,{ref:'refs/heads/'+f.parent.head_branch,object:{type:'commit',sha:SHA}});
 const comparison=f.map.get(PREFIX+`/compare/${BASE}...${SHA}?per_page=100`);
 Object.assign(comparison,{ahead_by:4,total_commits:4,commits:[{sha:EARLIER_HEAD,parents:[{sha:BASE}]},{sha:EARLIER,parents:[{sha:BASE},{sha:EARLIER_HEAD}]},{sha:PR_HEAD,parents:[{sha:BASE}]},{sha:SHA,parents:[{sha:EARLIER},{sha:PR_HEAD}]}]});
 f.map.set(PREFIX+`/actions/runs?event=merge_group&head_sha=${EARLIER}&per_page=100`,{total_count:1,workflow_runs:[{...f.parent,head_sha:EARLIER,head_branch:`gh-readonly-queue/main/pr-11-${BASE}`} ]});
 f.map.set(PREFIX+'/pulls/11',{number:11,state:'open',base:{ref:'main',repo:f.parent.repository},head:{sha:EARLIER_HEAD,repo:f.parent.repository}});
 assert.equal((await admit(f)).allowed,true);
 f.map.get(PREFIX+'/pulls/11').head.repo={id:999,full_name:'Fork/Hidden'};
 assert.equal((await admit(f)).reason,'queue_pull_request_not_same_repository');
 f.map.get(PREFIX+'/pulls/11').head.repo=f.parent.repository;
 comparison.total_commits=5;comparison.ahead_by=5;assert.equal((await admit(f)).reason,'incomplete_queue_comparison');
});
test('unknown or not-yet-verified profiles/shards are denied before any GitHub allocation evidence is used',async()=>{
 const f=fixture();f.profile.eligibleShards=[];assert.equal((await admit(f)).reason,'profile_not_verified_for_shard');assert.equal(f.calls.length,0);
 f.request.profile='self-hosted';assert.equal((await admit(f)).reason,'invalid_request');
});
test('GitHub adapter forbids arbitrary origins and paths; the staged CLI denies with no configured receipt authority',async()=>{
 const calls=[];const api=githubReadApi('synthetic-token',async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({ok:true})};});
 assert.deepEqual(await api('GET',PREFIX+'/actions/runs/101'),{ok:true});assert.equal(calls[0].options.redirect,'error');
 for(const path of ['https://attacker.invalid','/repos/Other/Repo/actions/runs/101',PREFIX+'/../secrets',PREFIX+'\\bad'])await assert.rejects(api('GET',path));
 await assert.rejects(api('POST',PREFIX+'/actions/runs/101'));
 const result=await main({REQUEST_ID:'request-7886',LEASE_GENERATION:'3',PART:'worker-1-of-6',PROFILE:'hosted',GITHUB_REPOSITORY:REPO,GITHUB_WORKFLOW_SHA:EXEC,GITHUB_RUN_ID:'202',GITHUB_RUN_ATTEMPT:'1'});assert.equal(result,1);
});

test('a later main-only dispatch wrapper can use the published callee SHA without confusing it with the wrapper SHA',async()=>{
 const f=fixture();f.child.path='.github/workflows/runner-dispatch.yml';f.child.head_sha=BASE;f.child.workflow_id=99;f.context.childWorkflowPath=f.child.path;f.context.childWorkflowSha=BASE;
 f.map.set(PREFIX+'/actions/workflows/runner-dispatch.yml',{id:99,path:f.child.path,state:'active'});
 assert.equal((await admit(f)).allowed,true);
 f.context.childWorkflowPath='.github/workflows/unselected.yml';assert.equal((await admit(f)).allowed,false);
});

test('an isolation claim in request data cannot replace independent job-identity isolation verification',async()=>{
 const missing=fixture();delete missing.deps.verifyIsolation;missing.request.isolationVerified=true;assert.equal((await admit(missing)).reason,'execution_isolation_unconfigured');
 const unsafe=fixture();unsafe.deps.verifyIsolation=async()=>false;assert.equal((await admit(unsafe)).reason,'execution_isolation_unverified');assert.equal(unsafe.calls.length,0);
});
