/** D7902: verified expired Mac children and fixed, non-sensitive API diagnostics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reclaimExpiredChild, delegateWorker, expectedTitle, GitHubRequestError, githubApi } from '../../scripts/ci/macbook-worker.mjs';
const REPO='AxalNetwork/StudioOS', ROOT=`/repos/${REPO}`, FLOW=`${ROOT}/actions/workflows/macbook-worker.yml`;
const NOW=Date.UTC(2026,10,20,12), SOURCE='a'.repeat(40), TARGET='b'.repeat(40);
const CONFIG={enabled:true,repo:REPO,event:'push',ref:'refs/heads/main',sourceSha:SOURCE,parentRunId:'101',parentRunAttempt:'1',part:'worker-1-of-6',queueBaseSha:''};
const parent=id=>({id,run_attempt:1,repository:{full_name:REPO},head_repository:{full_name:REPO},path:'.github/workflows/ci.yml',head_sha:SOURCE,event:'push',head_branch:'main',status:id===101?'in_progress':'completed',conclusion:id===101?null:'success'});
function orphan(options={}) {
 const calls=[];let reads=0,cancelled=false;
 const child={id:201,workflow_id:42,run_attempt:1,repository:{full_name:REPO},head_repository:{full_name:REPO},event:'workflow_dispatch',path:'.github/workflows/macbook-worker.yml',head_branch:'main',head_sha:TARGET,
   display_title:expectedTitle({...CONFIG,parentRunId:'99'}),created_at:new Date(NOW-90_000).toISOString(),status:'queued',conclusion:null,...options.child};
 const request=async(method,path)=>{
  calls.push({method,path});
  if(method==='GET'&&path===`${ROOT}/actions/runs/201`){reads++;return {...child,...(reads===2?options.recheck:{}),...(cancelled&&!options.pending?{status:'completed',conclusion:'cancelled'}:{})};}
  if(method==='GET'&&path===`${ROOT}/actions/runs/99`)return {...parent(99),...options.parent};
  if(method==='GET'&&path.endsWith('/jobs?per_page=100'))return options.jobs??{total_count:1,jobs:[{id:301,status:'queued',runner_id:0,steps:[]}]};
  if(method==='POST'&&path.endsWith('/cancel')){if(options.cancelError)throw new GitHubRequestError(403);cancelled=true;return {};}
  throw Error('Unexpected fixture request');
 };
 return {child,calls,request,run:()=>reclaimExpiredChild({listed:{id:201,status:'queued'},workflowId:42,request,now:()=>NOW,startTimeoutMs:90_000})};
}
const cancellations=f=>f.calls.filter(c=>c.method==='POST');

test('an expired queued child is independently bound before cancelling its exact ID and confirming termination',async()=>{
 const f=orphan();assert.deepEqual(await f.run(),{reason:'stale_mac_run_reconciled',cleanupRunId:'201'});
 assert.deepEqual(cancellations(f),[{method:'POST',path:`${ROOT}/actions/runs/201/cancel`}]);
 assert.ok(f.calls.some(c=>c.path===`${ROOT}/actions/runs/99`));
 assert.equal(f.calls.filter(c=>c.path===`${ROOT}/actions/runs/201`&&c.method==='GET').length,3);
});

test('fresh, future, malformed, foreign and wrong-parent children are never cancellation authority',async()=>{
 for(const change of [{created_at:new Date(NOW-89_999).toISOString()},{created_at:new Date(NOW+1).toISOString()},{created_at:'unknown'},
  {id:202},{workflow_id:43},{run_attempt:2},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}},
  {event:'pull_request'},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{head_sha:'main'},{display_title:'not a receipt'}]){
  const f=orphan({child:change});assert.equal(await f.run(),null,JSON.stringify(change));assert.equal(cancellations(f).length,0);
 }
 for(const change of [{id:100},{run_attempt:2},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'other/repo'}},
  {path:'.github/workflows/other.yml'},{head_sha:TARGET},{event:'pull_request'},{head_branch:'feature'}]){
  const f=orphan({parent:change});assert.equal(await f.run(),null);assert.equal(cancellations(f).length,0);
 }
});

test('assigned/running/partial jobs and a pickup race retain the run without arbitrary busy cancellation',async()=>{
 for(const jobs of [
  {total_count:2,jobs:[{status:'queued',runner_id:0,steps:[]}]},
  {total_count:1,jobs:[{status:'in_progress',runner_id:22,steps:[]}]},
  {total_count:1,jobs:[{status:'in_progress',runner_id:0,steps:[]}]},
  {total_count:1,jobs:[{status:'queued',runner_id:22,steps:[]}]},
  {total_count:1,jobs:[{status:'queued',steps:[]}]},
  {total_count:1,jobs:[{status:'queued',runner_id:0}]},
  {total_count:1,jobs:[{status:'queued',runner_id:0,steps:[{conclusion:'failure'}]}]},
 ]){const f=orphan({jobs});assert.equal(await f.run(),null);assert.equal(cancellations(f).length,0);}
 const raced=orphan({recheck:{status:'in_progress'}});assert.equal(await raced.run(),null);assert.equal(cancellations(raced).length,0);
});

test('pending or refused cancellation has its own reason and cannot dispatch another Mac job',async()=>{
 for(const options of [{pending:true},{cancelError:true}]){
  const f=orphan(options);assert.deepEqual(await f.run(),{reason:options.pending?'stale_mac_cancel_pending':'stale_mac_cancel_unconfirmed',cleanupRunId:'201'});
  const api=async(method,path,body,opts)=>{
   if(path===`${ROOT}/actions/runs/101`)return parent(101);
   if(path===FLOW)return {id:42,path:'.github/workflows/macbook-worker.yml',state:'active'};
   if(path.startsWith(`${FLOW}/runs?`))return path.includes('status=queued')?{total_count:1,workflow_runs:[{id:201,status:'queued'}]}:{total_count:0,workflow_runs:[]};
   return f.request(method,path,body,opts);
  };
  const result=await delegateWorker({config:CONFIG,api,now:()=>NOW});
  assert.equal(result.delegated,false);assert.match(result.reason,/^stale_mac_cancel_/);
  assert.equal(f.calls.some(c=>c.path.endsWith('/dispatches')),false);
 }
});

test('a post-dispatch HTTP error and unconfirmed cancellation retain separate redacted operation/status diagnostics',async()=>{
 const api=async(method,path)=>{
  if(path===`${ROOT}/actions/runs/101`)return parent(101);
  if(path===FLOW)return {id:42,path:'.github/workflows/macbook-worker.yml',state:'active'};
  if(path.startsWith(`${FLOW}/runs?`))return {total_count:0,workflow_runs:[]};
  if(path===`${ROOT}/branches/main`)return {commit:{sha:TARGET}};
  if(path.endsWith('/dispatches'))return {workflow_run_id:201};
  if(method==='POST'&&path.endsWith('/cancel'))throw new GitHubRequestError(409);
  if(path===`${ROOT}/actions/runs/201`)throw new GitHubRequestError(403);
  throw Error('private diagnostic token=synthetic');
 };
 const result=await delegateWorker({config:CONFIG,api,now:()=>NOW});
 assert.equal(result.reason,'child_status_unavailable_cancel_unconfirmed');
 assert.ok(result.diagnostics.some(d=>d.operation==='child_status'&&d.kind==='http'&&d.status===403));
 assert.ok(result.diagnostics.some(d=>d.operation==='cancel_request'&&d.kind==='http'&&d.status===409));
 assert.doesNotMatch(JSON.stringify(result),/token|Authorization|private diagnostic/);
 const raw=await delegateWorker({config:CONFIG,api:async()=>{throw Error('private diagnostic token=synthetic');},now:()=>NOW});
 assert.deepEqual(raw.diagnostics,[{operation:'parent_status',kind:'transport_or_unavailable'}]);
});

test('the real API boundary records status without reading or disclosing an error response body',async()=>{
 let bodyRead=false;
 const api=githubApi('synthetic',{fetchImpl:async()=>({ok:false,status:403,text:async()=>{bodyRead=true;return 'private response';}})});
 await assert.rejects(()=>api('GET',`${ROOT}/actions/runs/201`),error=>error instanceof GitHubRequestError&&error.status===403&&error.message==='github_request_failed');
 assert.equal(bodyRead,false);
});
