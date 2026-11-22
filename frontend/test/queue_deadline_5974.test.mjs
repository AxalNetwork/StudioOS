/** D5974: active native candidates, pending required checks, unreadable evidence and transition-only delivery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { queueDeadlineState, message, transition } from '../../scripts/lib/githubAlerts.mjs';
import { safeHealthFacts, createHealthMonitor } from '../../scripts/health-alert-episodes.mjs';
import { readDeadlineEvidence } from '../../scripts/lib/queueDeadline.mjs';
const NOW=Date.parse('2026-11-01T12:00:00Z'),SHA='a'.repeat(40);
const run=(patch={})=>({id:1,event:'merge_group',head_sha:SHA,head_branch:'gh-readonly-queue/main/pr-42-base',created_at:new Date(NOW-75*60000).toISOString(),status:'in_progress',checks:[{id:1,name:'build',status:'completed'},{id:2,name:'full suite',status:'in_progress'}],...patch});
const state=(patch={})=>queueDeadlineState({runs:[run()],required:['build','full suite'],activeHeads:[{sha:SHA,pr:42}],deadlineMinutes:90,now:NOW,...patch});
test('warn names the pending check on a current candidate; timing and state are injected',()=>{
 const s=state();assert.equal(s.active,true);assert.deepEqual(s.candidates[0].pending,[{name:'full suite',unknown:false}]);
 assert.match(message('queue-deadline','open',{deadlineCandidates:s.candidates}),/#42.*75 min: full suite/);
 assert.equal(state({runs:[],activeHeads:[]}).active,false);
 assert.equal(state({activeHeads:[]}).active,false,'removed/superseded head is absent from native queue');
 assert.equal(state({runs:[run({conclusion:'cancelled',status:'completed'})]}).active,false);
 assert.equal(state({runs:[run({status:'completed',checks:[{name:'build',status:'completed'},{name:'full suite',status:'completed'}]})]}).active,false);
 assert.equal(state({now:NOW-10*60000}).active,false);
 assert.equal(state({now:NOW-10*60000,issueOpen:true}).active,true,'hysteresis retains existing warning');
});
test('unreadable jobs near deadline are unknown pending, never green; global partial reads cannot recover',()=>{
 const s=state({runs:[run({checks:null})]});assert.equal(s.active,true);assert.equal(s.candidates[0].unknown,true);
 assert.match(message('queue-deadline','open',{deadlineCandidates:s.candidates}),/full suite \(unknown\/unreadable\)/);
 assert.equal(state({runs:[]}).active,null);assert.equal(transition(state({required:null}).active,true),'none');
 assert.equal(state({warnShare:2}).active,null);
 assert.equal(state({activeHeads:[{sha:'invalid',pr:42}]}).active,null);
 assert.equal(state({required:[null]}).active,null);
 assert.equal(state({required:[{context:'full suite',integration_id:7}],runs:[run({checks:[{name:'full suite',status:'completed',app:{id:8}}]})]}).candidates[0].pending[0].unknown,true);
});
test('durable facts retain safe pending names without control or mention injection',()=>{
 const facts=safeHealthFacts({deadlineCandidates:state().candidates});
 assert.match(message('queue-deadline','open',facts),/full suite/);
 const bad=state().candidates.map(c=>({...c,pending:[{name:'<@everyone>\n`injected`',unknown:true}]}));
 const clean=message('queue-deadline','open',safeHealthFacts({deadlineCandidates:bad}));
 assert.doesNotMatch(clean,/<@everyone>|`injected`|\n`/);
});
function reader({removed=false,unreadable=false}={}) {
 let graphs=0;
 const graph=async()=>({repository:{mergeQueue:{entries:{totalCount:removed&&++graphs>1?0:1,pageInfo:{hasNextPage:false},nodes:removed&&graphs>1?[]:[{headCommit:{oid:SHA},pullRequest:{number:42}}]}}}});
 const rest=async path=>{
  if(path==='rules/branches/main') return [{type:'merge_queue',parameters:{check_response_timeout_minutes:90}},{type:'required_status_checks',parameters:{required_status_checks:[{context:'build'},{context:'full suite'}]}}];
  if(path.startsWith('actions/')) return {total_count:1,workflow_runs:[run()]};
  if(unreadable) throw new Error('synthetic API unavailable');
  return {total_count:2,check_runs:run().checks};
 };
 return {rest,graph,repo:'AxalNetwork/StudioOS'};
}
test('collector rechecks native membership after reading checks and preserves a failed read',async()=>{
 const e=await readDeadlineEvidence(reader({removed:true}));assert.equal(state(e).active,false);
 const unknown=await readDeadlineEvidence(reader({unreadable:true}));assert.equal(state(unknown).candidates[0].unknown,true);
 const incomplete=reader();incomplete.graph=async()=>({repository:{mergeQueue:{entries:{totalCount:2,nodes:[],pageInfo:{hasNextPage:false}}}}});
 await assert.rejects(readDeadlineEvidence(incomplete),/Partial/);
});
test('existing health episodes notify once on open and once on complete recovery, never for repeats',async()=>{
 let issue=null;const delivered=[];
 const api=async(path,init={})=>{
  if(!init.method) return issue?[issue]:[];
  const body=JSON.parse(init.body);
  if(init.method==='POST') {issue={number:1,title:body.title,body:body.body,state:'open',labels:body.labels,user:{login:'github-actions[bot]'}};return issue;}
  issue={...issue,...body};return issue;
 };
 const monitor=createHealthMonitor({api,repo:'AxalNetwork/StudioOS',now:()=>NOW,deliver:async x=>{delivered.push(x);return {state:'acknowledged',receipt:{transport:'webhook',status:200}};}});
 const facts={deadlineCandidates:state().candidates};
 await monitor.apply('queue-deadline',true,facts,1);await monitor.apply('queue-deadline',true,facts,2);
 await monitor.apply('queue-deadline',null,{},3);assert.equal(issue.state,'open');
 await monitor.apply('queue-deadline',false,{},4);await monitor.apply('queue-deadline',false,{},5);
 assert.deepEqual(delivered.map(x=>x.phase),['open','recovery']);assert.match(delivered[0].text,/full suite/);assert.equal(issue.state,'closed');
});
