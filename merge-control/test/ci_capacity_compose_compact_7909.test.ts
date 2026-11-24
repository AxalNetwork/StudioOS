/** D7909 compact composition: compact records of passing requests, against real SQLite, the real coordinator and the real outbox. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CiCapacity, SqlCapacityStore, CAPACITY_REQUEST_LIMIT, CAPACITY_RETENTION_MS } from '../src/ciCapacity.ts';
import type { CapacityPorts } from '../src/ciCapacity.ts';
import { compactEncode, compactProject, compactReceipt } from '../src/ciCapacityCompact.ts';
import type { CapacityCompactConsumer, CompactMode } from '../src/ciCapacityCompact.ts';
import { CapacityOutbox } from '../src/ciCapacityOutbox.ts';
import { publicationConsumer, publicationSettled } from '../src/ciCapacityRetention.ts';
import { CI_CAPACITY_BUDGETS } from '../src/lib/ciCapacityPolicy.ts';
import type { CapacityPolicy, CapacityRequest, CiAttempt, CiSubmission, ExecutionReceipt } from '../src/lib/ciCapacityPolicy.ts';

const repository = 'AxalNetwork/StudioOS';
const START = 1_800_000_000_000;
const LEASES_OVER = 6 * 60 * 60_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (n: number): CiSubmission => ({
  version: 1, requestId: uuid(n), repository,
  parentRunId: 100 + n, parentAttempt: 1, parentWorkflowId: 9, event: 'push',
  sourceSha: 'a'.repeat(40), queueBaseSha: null, executorSha: 'b'.repeat(40), planDigest: `sha256:${'c'.repeat(64)}`, planArtifactId: 45,
  shards: Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`),
  prerequisites: ['fast'],
});
const policy = (): CapacityPolicy => ({
  version: 1, maxExternalWorkerShards: 2, maxIncludedWorkerShards: 0, minimumHostedWorkerShards: 1, approvedGroupId: 77,
  budgets: { ...CI_CAPACITY_BUDGETS },
});
const bound = (a: CiAttempt): ExecutionReceipt => {
  const { phase: _p, cancelDeadline: _c, reason: _r, verifiedTestFailure: _f, rejectedWorkflowSha: _w, ...receipt } = a;
  return { ...receipt, childRunId: a.childRunId! };
};
type Sent = 'failure' | 'cancelled' | 'success';

function fixture(t: { after(fn: () => void): void; mock: { timers: { enable(o: object): void; setTime(n: number): void } } }) {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const state = { now: START, mode: 'pilot' as CompactMode | null, breakOn: null as string | null, compactReads: 0 };
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      if (state.breakOn && query.startsWith(state.breakOn)) throw new Error('fixture: storage failed');
      if (query.includes('FROM ci_capacity_compact\n') && query.includes('completed_at <= ?')) state.compactReads++;
      const rows = db.prepare(query).all(...values); return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as DurableObjectStorage;
  const results=new SqlCapacityResults(storage);
  const publicationGuard = publicationSettled(storage, () => state.mode),publication=publicationConsumer(storage, () => state.mode);
  const guard:ReturnType<typeof publicationSettled>=(request,superseded)=>results.pendingFailure(request.submission.requestId)?'owed':publicationGuard(request,superseded);
  const consumer:CapacityCompactConsumer={mode:publication.mode,evidence:(record,superseded)=>results.pendingFailure(record.submission.requestId)?'owed':publication.evidence(record,superseded)};
  const open = (with_: CapacityCompactConsumer | null = consumer) => new SqlCapacityStore(storage, guard, with_);
  const store = open();
  const ports = {
    async verify(s: CiSubmission) { return { ...structuredClone(s), parentLive: true, trustedSource: true, executorOnMain: true }; },
    async inventory() { return null; }, async parent() { return true; }, async prerequisites() { return null; },
    async dispatch() { return 900_000; }, async discover() { return null; }, async observe() { return null; }, async cancel() { /* none */ },
  } as unknown as CapacityPorts;
  const capacity = (over: SqlCapacityStore = store) => new CiCapacity(over, ports, repository, policy(), () => state.now,id=>results.pendingFailure(id),id=>new SqlCapacityCorrections(storage).enqueue(id));
  storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publications (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
  let template: CapacityRequest | null = null;
  /** A settled request built from one the coordinator really accepted. `fallback` shards carry a fenced first attempt. */
  const request = async (n: number, outcome: Sent, completedAt: number, fallback = 0): Promise<CapacityRequest> => {
    if (!template) {
      const scratch = new DatabaseSync(':memory:'); t.after(() => scratch.close());
      const other = new SqlCapacityStore({ sql: { exec: (q: string, ...v: (string | number | null)[]) => { const rows = scratch.prepare(q).all(...v); return { toArray: () => rows }; } },
        transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage);
      await capacity(other).submit(input(1)); template = other.get(uuid(1))!;
    }
    const r = structuredClone(template); r.submission = input(n); r.completedAt = completedAt;
    r.parentLive = outcome !== 'cancelled';
    r.prerequisites = r.prerequisites.map(p => ({ ...p, conclusion: 'success' }));
    for (const shard of r.shards) {
      const a = shard.attempts[0], index = Number(shard.name.split('-')[1]);
      a.requestId = r.submission.requestId; a.parentRunId = r.submission.parentRunId;
      a.phase = outcome === 'failure' ? 'failed' : outcome === 'cancelled' ? 'cancelled' : 'passed';
      a.childRunId = n * 100 + index;
      if (index <= fallback) {
        shard.attempts.push({ ...structuredClone(a), generation: 2, profile: 'hosted', childRunId: n * 100 + 50 + index });
        a.phase = 'cancelled'; shard.generation = 2;
      }
    }
    return r;
  };
  const settled = async (n: number, outcome: Sent, completedAt: number, patch: (r: CapacityRequest) => void = () => {}) => {
    const r = await request(n, outcome, completedAt); patch(r); store.save(r); return r;
  };
  /** The intent the outbox leaves once a concluded result is on the check (shape proven in the D8339 tests). */
  const sent = (n: number, status: Sent, patch: object = {}) => {
    const reason = status === 'failure' ? 'verified_failure' : status === 'cancelled' ? 'parent_inactive' : 'entire_expected_set_verified';
    storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(n)}:pilot`, JSON.stringify({
      requestId: uuid(n), mode: 'pilot', checkId: 100_000 + n, phase: 'known', sent: JSON.stringify({ status, reason }), failed: status === 'failure',
      createAttempts: 1, lastCreateAt: START, ...patch }));
  };
  /** A compact record placed directly, for tests that are about the table and not the handoff. */
  const place = async (n: number, completedAt: number) => {
    const r = await request(n, 'success', completedAt); r.deadline = Math.max(r.deadline, completedAt + 1);
    const record = compactProject(r, 'pilot', false)!;
    storage.sql.exec('INSERT INTO ci_capacity_compact (id, completed_at, failed, failure, state) VALUES (?, ?, 0, NULL, ?)', uuid(n), completedAt, compactEncode(record));
    return record;
  };
  const advance = (ms: number) => { state.now += ms; t.mock.timers.setTime(state.now); };
  const sweep = (over: SqlCapacityStore = store) => { const from = state.compactReads; over.prune(state.now - CAPACITY_RETENTION_MS); return state.compactReads - from; };
  const cursor = () => storage.sql.exec<{ id: string }>('SELECT id FROM ci_capacity_compact_cursor').toArray()[0]?.id ?? null;
  const fences = () => ['ci_capacity_seen', 'ci_capacity_parents', 'ci_capacity_children'].map(table =>
    JSON.stringify(storage.sql.exec(`SELECT * FROM ${table} ORDER BY 1`).toArray()));
  return { db, storage, store, state, guard, consumer, open, capacity, request, settled, sent, place, advance, sweep, cursor, fences,results };
}


import { pruneCapacityHistory } from '../src/ciCapacityHistory.ts';
import { SqlCapacityCorrections } from '../src/ciCapacityCorrections.ts';
import { SqlCapacityResults } from '../src/lib/ciCapacityResults.ts';
import { CapacityTransport } from '../src/ciCapacityTransport.ts';
import { GithubCapacityPorts } from '../src/ciCapacityGithub.ts';
import { CapacityControl } from '../src/ciCapacityRuntime.ts';
import { authenticateCapacity } from '../src/ciCapacityAuth.ts';
import { generateKeyPairSync, sign } from 'node:crypto';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'compact-fixture',alg:'RS256',use:'sig'};
const good={testStep:'success' as const,executionOutcome:'completed' as const,cleanupConfirmed:true,exportComplete:true};
const bad={testStep:'failure' as const,executionOutcome:'cleanup_failure' as const,cleanupConfirmed:false,exportComplete:false};
const config={repository,repositoryId:7,appId:23,executorSha:'b'.repeat(40),approvedGroupId:5,prerequisiteJobs:['fast'],fullSuiteJobs:[],selfHostedProfiles:['linux-x64' as const]};
function network(){
 const calls:{method:string;path:string;body?:any}[]=[];const state={patchDown:false,parentDown:false,nextCheck:10000};
 const api=async(method:string,path:string,body?:unknown):Promise<any>=>{
  calls.push({method,path,body});
  if(method==='PATCH'){if(state.patchDown)throw Error('fixture: patch unavailable');return {};}
  if(method==='POST')return {id:state.nextCheck++};
  if(state.parentDown)throw Error('fixture: parent unavailable');
  const match=/\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?$/.exec(path);
  if(match)return {id:Number(match[1]),run_attempt:Number(match[2]??1),workflow_id:9,path:'.github/workflows/ci.yml',head_sha:'a'.repeat(40),head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:{full_name:repository,id:7},head_repository:{full_name:repository,id:7}};
  throw Error('fixture unserved '+path);
 };return {calls,state,api};
}
async function outcome(f:ReturnType<typeof fixture>,receipt:ExecutionReceipt,result:typeof good|typeof bad,jobId=77,capacity=f.capacity(),beforeJob:()=>void=()=>{}){
 const check=String(jobId+1000);const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'capacity',sub:`repo:${repository}:ref:refs/heads/main`,repository,repository_id:'7',run_id:String(receipt.childRunId),run_attempt:'1',event_name:'workflow_dispatch',ref:'refs/heads/main',sha:receipt.childWorkflowSha??receipt.executorSha,workflow_sha:receipt.childWorkflowSha??receipt.executorSha,workflow_ref:`${repository}/.github/workflows/runner-executor.yml@refs/heads/main`,runner_environment:'github-hosted',check_run_id:check,exp:Math.floor(f.state.now/1000)+300,iat:Math.floor(f.state.now/1000),nbf:Math.floor(f.state.now/1000)-1};
 const payload=enc({alg:'RS256',kid:jwk.kid})+'.'+enc(claims),token=payload+'.'+sign('RSA-SHA256',Buffer.from(payload),keys.privateKey).toString('base64url');
 const identity=await authenticateCapacity(new Request('https://fixture.invalid',{headers:{Authorization:`Bearer ${token}`}}),'capacity',repository,async()=>Response.json({keys:[jwk]}),()=>f.state.now);
 const ports=new GithubCapacityPorts(async(_method,path)=>{beforeJob();return path.endsWith(`/actions/runs/${receipt.childRunId}`)?{
  id:receipt.childRunId,event:'workflow_dispatch',path:'.github/workflows/runner-executor.yml',head_sha:claims.sha,head_branch:'main',run_attempt:1,
  display_title:`Worker executor | ${receipt.requestId} | ${receipt.logicalShard} | generation ${receipt.generation}`,repository:{id:7,full_name:repository},head_repository:{id:7,full_name:repository},
 }:{total_count:1,jobs:[{id:jobId,name:'Admitted Worker shard',run_id:receipt.childRunId,run_attempt:1,head_sha:claims.sha,check_run_url:`https://api.github.com/repos/${repository}/check-runs/${check}`}]};},config,()=>f.state.now);
 return new CapacityTransport(capacity,config,async()=>false,async()=>{}).outcome({receipt,result},identity,ports,f.results);
}

test('D7909 compact handoff preserves intents and result/job associations beyond 1000 passing requests',async t=>{
 const f=fixture(t),net=network();let original:CapacityRequest|null=null;
 for(let n=2;n<=CAPACITY_REQUEST_LIMIT+1;n++){const r=await f.settled(n,'success',START+n);f.sent(n,'success');if(n===2)original=r;}
 const receipt=bound(original!.shards[0].attempts[0]);f.results.put(receipt,77,good,START+10);
 f.advance(LEASES_OVER);await f.capacity().submit(input(2001));
 assert.equal(f.store.get(uuid(2)),null);assert.notEqual(f.store.compact(uuid(2)),null);
 const visited:string[]=[];await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>{visited.push(id);return f.capacity().status(id);},'pilot');
 assert.ok(visited.includes(uuid(2)));assert.ok(visited.includes(uuid(2001)));assert.ok(visited.length<=4);
 assert.equal(f.consumer.evidence(f.store.compact(uuid(2))!,false),'revisable');
 f.results.put(bound(f.store.get(uuid(3))!.shards[0].attempts[0]),78,good,f.state.now);
 assert.equal(f.results.read(receipt,77,f.state.now)!.jobId,77);
 await f.capacity().submit(input(2002));assert.equal(f.store.compactCount(),2);
});

test('D7909 ongoing priority work cannot starve full-history or compact corrections',async t=>{
 const f=fixture(t),net=network();
 for(let n=2;n<12;n++){await f.settled(n,'success',START+n);f.sent(n,'success');}
 const full=f.store.get(uuid(2))!;full.shards[0].attempts[0].verifiedTestFailure=true;f.store.save(full);
 for(let n=20;n<30;n++){const r=await f.place(n,START+n);f.sent(n,'success');if(n===20)f.store.compactFailure(compactReceipt(r,'worker-1-of-6',1)!,77);}
 await f.capacity().submit(input(2001));
 const box=new CapacityOutbox(f.storage,net.api,config),visited=new Set<string>();
 for(let tick=0;tick<20;tick++){let count=0;await box.publish(f.store,id=>{count++;visited.add(id);return f.capacity().status(id);},'pilot');assert.ok(count<=4);f.advance(15_000);}
 const failures=net.calls.filter(c=>c.method==='PATCH'&&c.body.conclusion==='failure').map(c=>c.path);
 assert.ok(failures.some(path=>path.endsWith('/check-runs/100002')));assert.ok(failures.some(path=>path.endsWith('/check-runs/100020')));
 assert.ok(visited.has(uuid(2001)));assert.ok(visited.has(uuid(11)));assert.ok(visited.has(uuid(29)));
});

test('D7909 compact outcomes are authenticated negative-only history with immutable job association',async t=>{
 const f=fixture(t),r=await f.place(2,START+2);f.sent(2,'success');
 const a=compactReceipt(r,'worker-1-of-6',1)!,b=compactReceipt(r,'worker-2-of-6',1)!;
 f.results.put(a,77,good,START);f.results.put(b,80,good,START);
 assert.equal(f.capacity().ownsResult(a)!.current,false);
 await assert.rejects(outcome(f,a,good),/generation/);
 assert.deepEqual(await outcome(f,a,bad,77),{accepted:true});assert.deepEqual(await outcome(f,b,bad,80),{accepted:true});
 const first=f.store.compact(uuid(2))!.failure;await assert.rejects(outcome(f,b,bad,81),/result_conflict/);
 assert.deepEqual(f.store.compact(uuid(2))!.failure,first);assert.equal(f.results.read(b,80,START)!.testStep,'failure');
 assert.equal(f.capacity().status(uuid(2))!.status,'failure');assert.equal(await f.capacity().receipt(uuid(2),a.logicalShard,a.childRunId,1),null);
});

test('D7909 crash after authenticated result persistence fences expiry and replays the sticky failure',async t=>{
 const f=fixture(t),r=await f.place(2,START+2);f.sent(2,'success');const receipt=compactReceipt(r,'worker-1-of-6',1)!;
 const capacity=f.capacity();capacity.recordExecutionFailure=async()=>{throw Error('fixture: process lost after journal');};
 await assert.rejects(outcome(f,receipt,bad,77,capacity),/process lost/);
 assert.equal(f.store.compact(uuid(2))!.failed,false);assert.equal(f.results.pendingFailure(uuid(2)),true);
 assert.equal(f.capacity().status(uuid(2))!.status,'failure');
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);f.sweep();assert.notEqual(f.store.compact(uuid(2)),null);
 const restarted=new SqlCapacityResults(f.storage);assert.equal(await restarted.replayFailures((r,j)=>f.capacity().recordExecutionFailure(r,j)),false);
 assert.equal(f.store.compact(uuid(2))!.failed,true);assert.equal(restarted.pendingFailure(uuid(2)),false);
 const net=network();await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.filter(c=>c.method==='PATCH').at(-1)!.body.conclusion,'failure');f.sweep();assert.equal(f.store.compact(uuid(2)),null);
});

test('D7909 a failed result transaction is not acknowledged, and a post-commit fault retains recoverable negative truth',async t=>{
 for(const fault of ['rollback','post-commit','after-application'])await t.test(fault,async t=>{
  const f=fixture(t),r=await f.place(2,START+2);f.sent(2,'success');const receipt=compactReceipt(r,'worker-1-of-6',1)!;
  if(fault==='rollback')f.state.breakOn='INSERT INTO capacity_result_failures';
  else if(fault==='post-commit'){const put=f.results.put.bind(f.results);f.results.put=(...args)=>{put(...args);throw Error('fixture: lost after durable journal');};}
  else f.results.appliedFailure=()=>{throw Error('fixture: lost before completion marker');};
  await assert.rejects(outcome(f,receipt,bad));
  if(fault==='rollback'){assert.equal(f.results.read(receipt,77,START),null);assert.equal(f.store.compact(uuid(2))!.failed,false);}
  else{assert.equal(f.results.pendingFailure(uuid(2)),true);assert.equal(f.capacity().status(uuid(2))!.status,'failure');}
 });
});

test('D7909 legacy unapplied negative results fence retention before a bounded recovery scan',async t=>{
 const f=fixture(t),r=await f.place(2,START+2);f.sent(2,'success');const receipt=compactReceipt(r,'worker-1-of-6',1)!;
 f.results.put(receipt,77,bad,START);f.storage.sql.exec('DELETE FROM capacity_result_failures');
 const row=f.storage.sql.exec<{id:string;state:string}>('SELECT id,state FROM capacity_execution_results').toArray()[0];
 const state=JSON.parse(row.state);delete state.failureApplied;f.storage.sql.exec('UPDATE capacity_execution_results SET state=? WHERE id=?',JSON.stringify(state),row.id);
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);f.sweep();assert.notEqual(f.store.compact(uuid(2)),null);
 const results=new SqlCapacityResults(f.storage);results.prune();await results.replayFailures((r,j)=>f.capacity().recordExecutionFailure(r,j));
 assert.equal(f.store.compact(uuid(2))!.failed,true);
});

test('D7909 bounded history GC retains compact evidence and drains orphan pages',async t=>{
 const f=fixture(t);for(let n=2;n<72;n++){
  const r=await f.request(n,'success',START+n),receipt=bound(r.shards[0].attempts[0]);
  f.storage.sql.exec('INSERT INTO capacity_execution_results(id,request_id,state) VALUES(?,?,?)',String(n).padStart(5,'0'),uuid(n),JSON.stringify({receipt,jobId:77,...good,receivedAt:START}));
  f.sent(n,'success');
 }
 assert.equal(f.results.prune(),true);assert.equal(f.storage.sql.exec('SELECT id FROM capacity_execution_results').toArray().length,6);
 f.results.prune();assert.equal(f.storage.sql.exec('SELECT id FROM capacity_execution_results').toArray().length,0);
 const net=network(),box=new CapacityOutbox(f.storage,net.api,config);
 assert.equal(await box.publish(f.store,()=>null,'pilot'),true);assert.equal(f.storage.sql.exec('SELECT id FROM capacity_publications').toArray().length,6);
 assert.equal(await box.publish(f.store,()=>null,'pilot'),false);assert.equal(f.storage.sql.exec('SELECT id FROM capacity_publications').toArray().length,0);
});

test('D7909 failed publication retries across restart, and original mode is never reinterpreted',async t=>{
 const f=fixture(t),r=await f.place(2,START+2);f.sent(2,'success');f.store.compactFailure(compactReceipt(r,'worker-1-of-6',1)!,77);
 const net=network();net.state.patchDown=true;await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);f.sweep();assert.notEqual(f.store.compact(uuid(2)),null);
 net.state.patchDown=false;await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'full-suite');
 assert.equal(f.storage.sql.exec('SELECT id FROM capacity_publications WHERE id=?',uuid(2)+':full-suite').toArray().length,0);
 await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 f.sweep();assert.equal(f.store.compact(uuid(2)),null);
});

function runtime(f:ReturnType<typeof fixture>,enabled=false){
 const settings={...config,maxExternalWorkerShards:2,maxIncludedWorkerShards:0,publication:'pilot'};
 const env={REPOSITORY:repository,CAPACITY_ENABLED:enabled?'true':'false',CAPACITY_PUBLICATION:'pilot',CAPACITY_CONFIG:JSON.stringify(settings),GITHUB_APP_ID:'23',GITHUB_INSTALLATION_ID:'1',GITHUB_APP_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
 let deleted=0;const alarms:number[]=[];
 const storage={...f.storage,get:async()=>!enabled,setAlarm:async(time:number)=>{alarms.push(time);},deleteAlarm:async()=>{deleted++;}};
 const control=new CapacityControl({storage} as unknown as DurableObjectState,env);
 return {control,env,settings,alarms,deleted:()=>deleted,store:(control as unknown as {store:SqlCapacityStore}).store};
}
import { CapacityReconciliation } from '../src/ciCapacityReconciliation.ts';
import worker from '../src/index.ts';
test('8376 reconciliation counts stalled evidence and adopts only an exact independently observed check',async t=>{
  const f=fixture(t), id=uuid(2), checkId=910;
  await f.settled(2,'failure',START+2,r=>{r.shards[0].attempts[0].phase='cancellation_unknown';});
  const creating={phase:'creating',checkId:null,sent:null,failed:true,createAttempts:2,lastCreateAt:START};
  f.sent(2,'failure',creating);
  f.advance(37*24*60*60_000);
  const run=runtime(f);
  run.store.prune(f.state.now-CAPACITY_RETENTION_MS);
  const open=()=>new CapacityReconciliation(f.storage,run.store,f.results,run.settings as typeof config & {publication:'pilot'});
  const review=open(), item=review.inspect(id);
  assert.equal(item.adoptable,true);
  assert.deepEqual(item.issues,['create_exhausted','negative_pending','cleanup_unknown']);
  const match={id:checkId,external_id:item.key,name:'ci-capacity/worker-pilot',head_sha:item.source,app:{id:config.appId}};
  const parent={id:102,run_attempt:1,head_sha:item.source,repository:{id:7,full_name:repository}};
  const scoped=(checks:()=>Promise<unknown>)=>async(method:string,path:string)=>{
    assert.equal(method,'GET');
    if(path==='/repos/'+repository+'/actions/runs/102/attempts/1')return parent;
    assert.ok(path.startsWith('/repos/'+repository+'/commits/'+item.source+'/check-runs?'));
    return checks();
  };
  assert.equal(await review.adopt(id,item.fingerprint,checkId,async(_method,path)=>path.includes('/actions/runs/')
    ?{...parent,repository:{id:999,full_name:repository}}:{total_count:1,check_runs:[match]}),false);
  for(const rows of [[],[match,{...match,id:911}],[{...match,head_sha:'d'.repeat(40)}],
    [{...match,app:{id:44}}],[{...match,name:'ci-capacity/full-suite'}],[{...match,external_id:uuid(3)+':pilot'}]]){
    assert.equal(await review.adopt(id,item.fingerprint,checkId,scoped(async()=>({total_count:rows.length,check_runs:rows}))),false);
    assert.equal(open().inspect(id).fingerprint,item.fingerprint);
  }
  assert.equal(await review.adopt(id,item.fingerprint,checkId,scoped(async()=>({total_count:2,check_runs:[match]}))),false);
  const found=scoped(async()=>({total_count:1,check_runs:[match]}));
  // A concurrent update after discovery must invalidate the owner's observation.
  assert.equal(await review.adopt(id,item.fingerprint,checkId,scoped(async()=>{
    f.sent(2,'failure',{...creating,lastCreateAt:START+1});
    return {total_count:1,check_runs:[match]};
  })),false);
  const restarted=open();
  const fresh=restarted.inspect(id);
  assert.equal(await restarted.adopt(id,fresh.fingerprint,checkId,found),true);
  assert.equal(await restarted.adopt(id,fresh.fingerprint,checkId,found),false);
  const saved=JSON.parse(f.db.prepare('SELECT state FROM capacity_publications WHERE id=?').get(item.key)!.state as string);
  assert.equal(saved.ownerAdoption.priorFingerprint,fresh.fingerprint);assert.equal(saved.checkId,checkId);assert.equal(saved.createAttempts,2);assert.equal(saved.failed,true);assert.equal(saved.sent,null);
  assert.deepEqual(restarted.inspect(id).issues,['intent_unresolved','negative_pending','cleanup_unknown']);
  assert.equal(run.store.get(id)!.shards[0].attempts[0].phase,'cancellation_unknown');
  for(let n=3;n<38;n++) await f.place(n,START+n);
  const first=restarted.counts(''),second=restarted.counts(first.next!);
  assert.equal(first.scanned,32);assert.equal(second.scanned,4);assert.equal(second.next,null);
  assert.equal(first.counts.cleanup_unknown,1);assert.equal(first.counts.intent_unresolved+second.counts.intent_unresolved,36);
  const changed=new CapacityReconciliation(f.storage,run.store,f.results,{...config,publication:'full-suite'});
  assert.ok(changed.inspect(uuid(3)).issues.includes('mode_conflict'));
});

test('8376 owner reconciliation authenticates both entry points and requires the explicit drain switch',async t=>{
  const f=fixture(t),run=runtime(f,true),token='test-only-owner';
  Object.assign(run.env,{CAPACITY_OWNER_TOKEN:token});
  const get=(auth:string)=>new Request('https://example.invalid/capacity/publications',{headers:{authorization:'Bearer '+auth}});
  const post=(auth:string)=>new Request('https://example.invalid/capacity/reconcile',{method:'POST',headers:{authorization:'Bearer '+auth},
    body:JSON.stringify({requestId:uuid(3),mode:'pilot',fingerprint:'test',checkId:4})});
  const env={...run.env,CAPACITY_CONTROL:{getByName:()=>run.control}} as any;
  for(const req of [get('wrong'),post('wrong')]) {
    assert.equal((await worker.fetch(req,env)).status,401);
    assert.equal((await run.control.fetch(req)).status,401);
  }
  assert.equal((await worker.fetch(get(token),env)).status,200);
  assert.equal((await worker.fetch(post(token),env)).status,409);
});

test('8376 drained owner adopts a landed check after two lost creates through the Worker route',async t=>{
  const f=fixture(t),run=runtime(f),id=uuid(2);
  await f.settled(2,'failure',START);
  let creates=0;
  const publisher=new CapacityOutbox(f.storage,async(method)=>{
    if(method==='POST'){creates++;throw Error('fixture lost check-create acknowledgement');}
    assert.equal(method,'GET');
    return {total_count:0,check_runs:[]};
  },config);
  const publish=()=>publisher.publish(run.store,()=>({status:'failure',reason:'verified_failure'}),'pilot');
  await publish();
  f.advance(1_000);await publish();
  f.advance(60_000);await publish();
  assert.equal(creates,2);
  f.advance(37*24*60*60_000);await publish();
  assert.equal(creates,2);
  run.store.prune(f.state.now-CAPACITY_RETENTION_MS);
  const env={...run.env,CAPACITY_CONTROL:{getByName:()=>run.control},CAPACITY_OWNER_TOKEN:'fixture'};
  Object.assign(run.env,{CAPACITY_OWNER_TOKEN:env.CAPACITY_OWNER_TOKEN});
  const headers={authorization:'Bearer fixture'};
  const item=await (await worker.fetch(new Request('https://fixture.invalid/capacity/publications?requestId='+id,{headers}),env as any)).json() as any;
  assert.deepEqual(item.issues,['create_exhausted','negative_pending']);
  const gets:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
    const path=new URL(String(input)).pathname;
    if(path.includes('/app/installations/')) return Response.json({token:'fixture'});
    assert.equal(init.method,'GET');gets.push(path);
    return Response.json(path.includes('/actions/runs/')?{id:102,run_attempt:1,head_sha:item.source,repository:{id:7,full_name:repository}}
      :{total_count:1,check_runs:[{id:19,external_id:item.key,head_sha:item.source,app:{id:23},name:'ci-capacity/worker-pilot'}]});
  });
  const adoption=()=>new Request('https://fixture.invalid/capacity/reconcile',{method:'POST',headers,
    body:JSON.stringify({requestId:id,mode:'pilot',checkId:19,fingerprint:item.fingerprint})});
  run.env.GITHUB_APP_ID='999';
  assert.equal((await worker.fetch(adoption(),env as any)).status,409);
  assert.deepEqual(gets,[]);
  run.env.GITHUB_APP_ID=String(config.appId);
  const response=await worker.fetch(adoption(),env as any);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{adopted:true});
  assert.equal(gets.length,2);
  assert.equal(run.alarms.at(-1),f.state.now+1000);
  assert.ok(run.store.get(id));
});

test('D7909 actual runtime composes only validated modes and preserves unknown/changed configurations on restart',async t=>{
 const f=fixture(t);for(let n=2;n<=CAPACITY_REQUEST_LIMIT+1;n++){await f.settled(n,'success',START+n);f.sent(n,'success');}
 const run=runtime(f);f.advance(LEASES_OVER);run.store.prune(f.state.now-CAPACITY_RETENTION_MS);assert.notEqual(run.store.compact(uuid(2)),null);
 run.env.CAPACITY_CONFIG='not json';f.advance(CAPACITY_RETENTION_MS);run.store.prune(f.state.now-CAPACITY_RETENTION_MS);assert.notEqual(run.store.compact(uuid(2)),null);
 run.env.CAPACITY_CONFIG=JSON.stringify({...run.settings,publication:'full-suite'});run.env.CAPACITY_PUBLICATION='full-suite';run.store.prune(f.state.now-CAPACITY_RETENTION_MS);assert.notEqual(run.store.compact(uuid(2)),null);
 run.env.CAPACITY_CONFIG=JSON.stringify(run.settings);run.env.CAPACITY_PUBLICATION='pilot';run.store.prune(f.state.now-CAPACITY_RETENTION_MS);assert.equal(run.store.compact(uuid(2)),null);
 assert.equal(run.env.CAPACITY_ENABLED,'false');
});
test('D7909 actual alarm continues when only compact history remains and does no dispatch while off',async t=>{
 const f=fixture(t);await f.place(2,START+2);f.sent(2,'success');const run=runtime(f),net=network();
 t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
  const url=String(input);
  if(url.includes('/app/installations/'))return Response.json({token:'fixture-installation-token'});
  return Response.json(await net.api(init.method,new URL(url).pathname+new URL(url).search,init.body?JSON.parse(init.body):undefined));
 });
 await run.control.alarm();assert.equal(run.deleted(),0);assert.equal(run.alarms.length,1);
 assert.equal(net.calls.some(c=>c.path.endsWith('/dispatches')),false);assert.notEqual(run.store.compact(uuid(2)),null);
});

test('D7909 pending failure replay is bounded and one unresolved identity cannot starve others',async t=>{
 const f=fixture(t);
 for(let n=1;n<=70;n++){const r=await f.place(n,START+n);f.results.put(compactReceipt(r,'worker-1-of-6',1)!,77,bad,START);}
 f.storage.sql.exec('DELETE FROM ci_capacity_compact WHERE id=?',uuid(1));
 let calls=0;assert.equal(await f.results.replayFailures(async(r,j)=>{calls++;await f.capacity().recordExecutionFailure(r,j);}),true);assert.equal(calls,64);
 calls=0;await f.results.replayFailures(async(r,j)=>{calls++;await f.capacity().recordExecutionFailure(r,j);});assert.equal(calls,6);
 for(let n=2;n<=70;n++)assert.equal(f.store.compact(uuid(n))!.failed,true);
 assert.equal(f.results.pendingFailure(uuid(1)),true,'unresolved negative is retained, not silently discarded');
});
test('D7909 missing or malformed compact publication intent cannot create a replacement check',async t=>{
 const f=fixture(t);await f.place(2,START+2);const net=network(),box=new CapacityOutbox(f.storage,net.api,config);
 await box.publish(f.store,id=>f.capacity().status(id),'pilot');assert.equal(net.calls.length,0);
 f.storage.sql.exec('INSERT INTO capacity_publications(id,state) VALUES(?,?)',uuid(2)+':pilot','broken JSON');
 await box.publish(f.store,id=>f.capacity().status(id),'pilot');assert.equal(net.calls.length,0);
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);f.sweep();assert.notEqual(f.store.compact(uuid(2)),null);
});

test('D7909 inconsistent duplicate authority permits no late positive and preserves negative on both sides',async t=>{
 const f=fixture(t),record=await f.place(2,START+2);await f.settled(2,'success',START+2);f.sent(2,'success');
 const receipt=compactReceipt(record,'worker-1-of-6',1)!;await assert.rejects(outcome(f,receipt,good),/generation/);
 await outcome(f,receipt,bad);assert.equal(f.store.compact(uuid(2))!.failed,true);assert.equal(f.store.get(uuid(2))!.shards[0].attempts[0].verifiedTestFailure,true);
 const net=network();await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.length,0);assert.notEqual(f.store.compact(uuid(2)),null);assert.notEqual(f.store.get(uuid(2)),null);
});

test('D7909 runtime retention is fenced by unapplied authenticated negatives, not just compact flags',async t=>{
 const f=fixture(t),record=await f.place(2,START+2);f.sent(2,'success');const run=runtime(f);
 f.results.put(compactReceipt(record,'worker-1-of-6',1)!,77,bad,START);
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);run.store.prune(f.state.now-CAPACITY_RETENTION_MS);
 assert.notEqual(run.store.compact(uuid(2)),null);assert.equal(run.store.compact(uuid(2))!.failed,false);
});
test('D7909 awaited job validation cannot reopen late positive authority after handoff',async t=>{
 for(const [name,result] of [['positive',good],['negative',bad]] as const)await t.test(name,async t=>{
  const f=fixture(t);for(let n=2;n<=CAPACITY_REQUEST_LIMIT+1;n++){await f.settled(n,'success',START+n);f.sent(n,'success');}
  f.advance(LEASES_OVER);const receipt=bound(f.store.get(uuid(2))!.shards[0].attempts[0]);let moved=false;
  const transition=()=>{if(!moved){moved=true;f.sweep();}};
  const delivery=outcome(f,receipt,result,77,f.capacity(),transition);
  if(name==='positive')await assert.rejects(delivery,/generation/);
  else{assert.deepEqual(await delivery,{accepted:true});assert.equal(f.store.compact(uuid(2))!.failed,true);}
  assert.equal(f.store.get(uuid(2)),null);assert.equal(await f.capacity().receipt(uuid(2),receipt.logicalShard,receipt.childRunId,1),null);
 });
});

test('D7909 orphan ambiguity and legacy negative evidence remain until explicit reconciliation',async t=>{
 const f=fixture(t),record=await f.place(2,START+2),receipt=compactReceipt(record,'worker-1-of-6',1)!;
 f.results.put(receipt,77,bad,START);f.sent(2,'success');
 f.storage.sql.exec('DELETE FROM ci_capacity_compact');f.storage.sql.exec('DELETE FROM capacity_result_failures');
 pruneCapacityHistory(f.storage,'results');pruneCapacityHistory(f.storage,'publications');
 assert.notEqual(f.results.read(receipt,77,START),null);
 assert.equal(f.storage.sql.exec('SELECT id FROM capacity_publications WHERE id=?',uuid(2)+':pilot').toArray().length,1);
 f.sent(3,'success',{phase:'creating',checkId:null,sent:null});pruneCapacityHistory(f.storage,'publications');
 assert.equal(f.storage.sql.exec('SELECT id FROM capacity_publications WHERE id=?',uuid(3)+':pilot').toArray().length,1);
});

test('D7909 R2 full-request expiry is fenced until an authenticated negative is applied and published',async t=>{
 const f=fixture(t),request=await f.settled(2,'success',START+2);f.sent(2,'success');
 const run=runtime(f),receipt=bound(request.shards[0].attempts[0]);
 f.results.put(receipt,77,bad,START);assert.equal(f.results.pendingFailure(uuid(2)),true);
 f.advance(CAPACITY_RETENTION_MS+LEASES_OVER);run.store.prune(f.state.now-CAPACITY_RETENTION_MS);
 assert.notEqual(run.store.get(uuid(2)),null,'the full runtime guard retains unapplied negative authority');
 assert.equal(run.store.compact(uuid(2)),null);
 assert.deepEqual(f.capacity(run.store).status(uuid(2)),{status:'failure',reason:'verified_failure'});
 const restarted=runtime(f);restarted.store.prune(f.state.now-CAPACITY_RETENTION_MS);
 assert.notEqual(restarted.store.get(uuid(2)),null,'restart cannot drop the full request before journal replay');
 assert.equal(await f.results.replayFailures((r,j)=>f.capacity(restarted.store).recordExecutionFailure(r,j)),false);
 assert.equal(f.results.pendingFailure(uuid(2)),false);
 const net=network();await new CapacityOutbox(f.storage,net.api,config).publish(restarted.store,id=>f.capacity(restarted.store).status(id),'pilot');
 assert.ok(net.calls.some(c=>c.method==='PATCH'&&c.body.conclusion==='failure'));
 restarted.store.prune(f.state.now-CAPACITY_RETENTION_MS);
 assert.equal(restarted.store.get(uuid(2)),null,'a delivered negative may leave at its original expiry');
});

test('D7909 R2 unresolved duplicate status cannot expose the full row as success',async t=>{
 const f=fixture(t);await f.place(2,START+2);await f.settled(2,'success',START+2);f.sent(2,'success');
 assert.equal(f.store.compact(uuid(2))!.failed,false);
 assert.deepEqual(f.capacity().status(uuid(2)),{status:'pending',reason:'capacity_history_conflict'});
 assert.notEqual(f.store.get(uuid(2)),null);assert.notEqual(f.store.compact(uuid(2)),null);
});

test('D7909 R1 a late full failure just behind history is corrected first without a new full-store port',async t=>{
 const f=fixture(t),net=network();
 for(let n=2;n<402;n++){await f.settled(n,'success',START+n);f.sent(n,'success');}
 await f.capacity().submit(input(2001));await f.place(500,START+500);f.sent(500,'success');
 const box=new CapacityOutbox(f.storage,net.api,config);
 f.storage.sql.exec('INSERT OR REPLACE INTO capacity_publication_cursor(mode,last) VALUES(?,?)','pilot:history',uuid(200));
 const late=f.store.get(uuid(200))!;late.shards[0].attempts[0].verifiedTestFailure=true;f.store.save(late);
 let visited=0;await box.publish(f.store,id=>{visited++;return f.capacity().status(id);},'pilot');
 assert.equal(net.calls[0].method,'PATCH');assert.ok(net.calls[0].path.endsWith('/100200'));
 assert.equal(net.calls[0].body.conclusion,'failure');assert.ok(visited<=4);
});

test('D7909 R1 journaled compact negative bypasses identity cursors before application and survives restart',async t=>{
 const f=fixture(t),net=network();
 for(let n=2;n<402;n++){await f.place(n,START+n);f.sent(n,'success');}
 const box=new CapacityOutbox(f.storage,net.api,config),queue=new SqlCapacityCorrections(f.storage);
 f.storage.sql.exec('INSERT OR REPLACE INTO capacity_publication_cursor(mode,last) VALUES(?,?)','pilot:compact',uuid(200));
 f.storage.sql.exec('INSERT OR REPLACE INTO capacity_correction_progress(name,value) VALUES(?,?)','failed-after',uuid(400));
 const receipt=compactReceipt(f.store.compact(uuid(200))!,'worker-1-of-6',1)!;
 f.results.put(receipt,77,bad,START);assert.equal(queue.pending(),true);assert.equal(f.store.compact(uuid(200))!.failed,false);
 net.state.patchDown=true;await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.ok(net.calls[0].path.endsWith('/100200'));assert.equal(queue.pending(),true);
 net.state.patchDown=false;net.calls.length=0;
 await new CapacityOutbox(f.storage,net.api,config).publish(f.open(),id=>f.capacity().status(id),'pilot');
 assert.ok(net.calls[0].path.endsWith('/100200'));assert.equal(net.calls[0].body.conclusion,'failure');assert.equal(queue.pending(),false);
 await f.results.replayFailures((r,j)=>f.capacity().recordExecutionFailure(r,j));
 assert.equal(queue.pending(),true,'application also recovers the durable notification');
 net.calls.length=0;await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.filter(c=>c.method==='PATCH'&&c.path.endsWith('/100200')).length,0,'already delivered failure is not republished');
 assert.equal(queue.pending(),false);
});

test('D7909 R1 indexed legacy failures outrank positive compact history and corrected rows do not use slots again',async t=>{
 const f=fixture(t),net=network();for(let n=2;n<402;n++){await f.place(n,START+n);f.sent(n,'success');}
 const receipt=compactReceipt(f.store.compact(uuid(200))!,'worker-1-of-6',1)!;f.store.compactFailure(receipt,77);
 const box=new CapacityOutbox(f.storage,net.api,config);
 f.storage.sql.exec('INSERT OR REPLACE INTO capacity_publication_cursor(mode,last) VALUES(?,?)','pilot:compact',uuid(200));
 await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.ok(net.calls[0].path.endsWith('/100200'));assert.equal(net.calls[0].body.conclusion,'failure');
 assert.equal(f.store.compactFailedPage('',100).length,1,'sticky failed record remains in the indexed read');
 net.calls.length=0;await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.filter(c=>c.method==='PATCH').length,0);
});

test('D7909 R1 correction notification rolls back with the result and is not an alternative authority',async t=>{
 const f=fixture(t),r=await f.place(2,START+2),receipt=compactReceipt(r,'worker-1-of-6',1)!;f.sent(2,'success');
 const queue=new SqlCapacityCorrections(f.storage);f.state.breakOn='INSERT OR IGNORE INTO capacity_publication_corrections';
 assert.throws(()=>f.results.put(receipt,77,bad,START),/storage failed/);f.state.breakOn=null;
 assert.equal(f.results.read(receipt,77,START),null);assert.equal(f.results.pendingFailure(uuid(2)),false);assert.equal(queue.pending(),false);
 queue.enqueue(uuid(2));const net=network();await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.length,0,'a due hint alone cannot publish failure or success');assert.equal(queue.pending(),true);
});

test('D7909 R1 blocked corrections cannot starve the due cursor and a compact intent cannot be recreated',async t=>{
 const f=fixture(t),queue=new SqlCapacityCorrections(f.storage),net=network();
 for(let n=2;n<112;n++){await f.place(n,START+n);queue.enqueue(uuid(n));}
 const r=await f.place(500,START+500);f.sent(500,'success');f.store.compactFailure(compactReceipt(r,'worker-1-of-6',1)!,77);queue.enqueue(uuid(500));
 let reads=0;const original=f.storage.sql.exec;f.storage.sql.exec=((query:string,...args:any[])=>{if(query.includes('SELECT seq,request_id'))reads++;return original(query,...args);}) as typeof original;
 const box=new CapacityOutbox(f.storage,net.api,config);await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(net.calls.length,0);assert.ok(reads<=2);reads=0;
 await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.ok(net.calls[0].path.endsWith('/100500'));assert.ok(reads<=2);assert.equal(net.calls.some(c=>c.method==='POST'),false);
});

test('D7909 R1 cold legacy backfill is paged and enablement waits for completed correction publication',async t=>{
 const f=fixture(t),queue=new SqlCapacityCorrections(f.storage),net=network();
 for(let n=2;n<203;n++){const r=await f.place(n,START+n);f.store.compactFailure(compactReceipt(r,'worker-1-of-6',1)!,77);f.sent(n,n===202?'success':'failure');}
 const run=runtime(f,true),enabled=()=> (run.control as unknown as {enabled():Promise<boolean>}).enabled();
 assert.equal(await enabled(),false);
 const box=new CapacityOutbox(f.storage,net.api,config);await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(queue.legacyReady(),false);assert.equal(await enabled(),false);
 await box.publish(f.store,id=>f.capacity().status(id),'pilot');assert.equal(queue.legacyReady(),false);
 net.state.patchDown=true;await box.publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(queue.legacyReady(),false,'scanned is not complete while the correction ACK is missing');
 net.state.patchDown=false;await new CapacityOutbox(f.storage,net.api,config).publish(f.store,id=>f.capacity().status(id),'pilot');
 assert.equal(queue.legacyReady(),true);assert.equal(await enabled(),true);
 assert.ok(net.calls.some(c=>c.method==='PATCH'&&c.path.endsWith('/100202')&&c.body.conclusion==='failure'));
});
