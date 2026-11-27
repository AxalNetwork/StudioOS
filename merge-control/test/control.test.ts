/** D5618: signatures, cancellation safety, duplicate/retry/restart behavior, kill switch and durable fencing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { RepoControl } from '../src/repoControl.ts';
import { changeLease } from '../src/lib/lease.ts';
import { cancellable } from '../src/lib/reconcile.ts';
import { webhook } from '../src/webhook.ts';
import worker from '../src/index.ts';
import { githubClient } from '../src/github.ts';
import type { Delivery, Env, Run } from '../src/types.ts';

const repo = 'AxalNetwork/StudioOS', sha = 'a'.repeat(40);
const event: Delivery = { delivery:'delivery-one',repo,event:'merge_group',action:'destroyed',reason:'invalidated',headSha:sha,headRef:'refs/heads/gh-readonly-queue/main/pr-1',at:1 };
const run: Run = { id:1,event:'merge_group',head_sha:sha,head_branch:'gh-readonly-queue/main/pr-1',path:'.github/workflows/ci.yml',status:'in_progress' };
function storage() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
  return {
    sql: { exec(query: string,...values: (string|number|null)[]) {
      const stmt=db.prepare(query);const rows=stmt.all(...values); return { toArray:()=>rows,one:()=>rows[0] };
    } },
    async get(key: string) { const row=db.prepare('SELECT value FROM kv WHERE key=?').get(key);return row ? JSON.parse(String(row.value)) : undefined; },
    async put(key: string,value: unknown) {db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));},
    db,
  };
}
function controller() {
  const store=storage();const env={REPOSITORY:repo} as Env;
  const ctx={storage:store} as unknown as DurableObjectState;
  return {store,env,ctx,control:new RepoControl(ctx,env)};
}
function request(payload: unknown, signature?: string) {
  const body=JSON.stringify(payload);
  return new Request('https://local/webhook',{method:'POST',body,headers:{'x-github-event':'merge_group','x-github-delivery':'delivery-one',...(signature?{'x-hub-signature-256':signature}: {})}});
}
const payload={action:'destroyed',reason:'invalidated',repository:{full_name:repo},merge_group:{head_sha:sha,head_ref:event.headRef}};
test('missing/bad/modified signatures enqueue nothing; valid raw signature enqueues minimal payload',async()=>{
 const secret=randomBytes(32).toString('hex');
 const queued:Delivery[]=[];const env={REPOSITORY:repo,WEBHOOK_SECRET:secret,EVENTS:{send:async(v:Delivery)=>{queued.push(v);}}} as unknown as Env;
 assert.equal((await webhook(request(payload),env)).status,401);
 assert.equal((await webhook(request(payload,'sha256='+'0'.repeat(64)),env)).status,401);
 assert.equal(queued.length,0);
 const signature='sha256='+createHmac('sha256',secret).update(JSON.stringify(payload)).digest('hex');
 assert.equal((await webhook(request({...payload,reason:'dequeued'},signature),env)).status,401);
 assert.equal((await webhook(request(payload,signature),env)).status,200);
 assert.equal(queued.length,1);assert.equal(queued[0].headSha,sha);assert.equal('repository' in queued[0],false);
});
test('destroyed cancels only matching-SHA merge_group runs, dedupes across restart and ignores merged',async()=>{
 const {control,store,ctx,env}=controller();await control.setKillSwitch(false);let cancels=0;
 const rows=[run,{...run,id:2,event:'pull_request'},{...run,id:3,event:'push',head_branch:'main'},{...run,id:4,head_sha:'b'.repeat(40)},{...run,id:5,path:'.github/workflows/deploy.yml'},{...run,id:6,status:'completed'},{...run,id:7,head_branch:'main'}];
 const api=async(method:string,path:string)=>{if(method==='POST'){cancels++;assert.equal(path,'actions/runs/1/cancel');return null;}return {workflow_runs:rows};};
 await Promise.all([control.process(event,api),control.process(event,api)]);
 const restarted=new RepoControl(ctx,env);await restarted.process(event,api);
 await restarted.process({...event,delivery:'merged',reason:'merged'},async()=>{throw new Error('merged must call no API');});
 assert.equal(cancels,1);
 assert.equal(store.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE kind='event'").one().n,2);
 assert.equal(cancellable({...run,event:'pull_request'},sha),false);
 store.db.close();
});
test('kill switch defaults on: exactly one event audit row and zero GitHub calls',async()=>{
 const {control,store}=controller();let calls=0;
 await control.process(event,async()=>{calls++;throw new Error('disabled');});
 assert.equal(calls,0);assert.equal((await control.status()).killSwitch,true);
 const rows=store.sql.exec('SELECT kind FROM audit').toArray();assert.deepEqual(rows.map(r=>r.kind),['event']);
 store.db.close();
});
test('failed cancellation is retried; successful cancellation is never repeated within a partial delivery',async()=>{
 const {control,store}=controller();await control.setKillSwitch(false);let fail=true;const calls:number[]=[];
 const api=async(method:string,path:string)=>{
  if(method==='GET')return {workflow_runs:[run,{...run,id:2}]};
  const id=Number(/runs\/(\d+)/.exec(path)?.[1]);calls.push(id);
  if(id===2&&fail){fail=false;throw new Error('temporary');}return null;
 };
 await assert.rejects(control.process(event,api));await control.process(event,api);
 assert.deepEqual(calls,[1,2,2]);store.db.close();
});
test('lease refuses second acquire, increases fence after expiry/release and refuses stale renew',()=>{
 const empty={counter:0,lease:null};const input={operation:'acquire',holder:'s39/Codex/39',ttlSeconds:1} as const;
 const a=changeLease(empty,input,0);assert.equal(a.lease?.fence,1);
 assert.equal(changeLease(a.state,{...input,holder:'other'},999).status,409);
 const b=changeLease(a.state,input,1000);assert.equal(b.lease?.fence,2);
 assert.equal(changeLease(b.state,{operation:'renew',holder:input.holder,fence:1},1001).status,409);
 const released=changeLease(b.state,{operation:'release',holder:input.holder,fence:2},1001);
 assert.equal(released.lease,null);assert.equal(changeLease(released.state,input,1002).lease?.fence,3);
});
test('lease survives a controller restart; release retains the rising counter',async()=>{
 const {control,store,ctx,env}=controller();const a=await control.claim(5618,{operation:'acquire',holder:'session-39'});
 const restarted=new RepoControl(ctx,env);assert.equal((await restarted.claim(5618,{operation:'acquire',holder:'another'})).status,409);
 assert.equal((await restarted.claim(5618,{operation:'renew',holder:'session-39',fence:0})).status,409);
 await restarted.claim(5618,{operation:'release',holder:'session-39',fence:a.lease?.fence});
 assert.equal((await restarted.claim(5618,{operation:'acquire',holder:'session-39'})).lease?.fence,2);store.db.close();
});
test('cron mirrors claim refs and cancels only runs with a positively missing queue ref',async()=>{
 const {control,store}=controller();await control.setKillSwitch(false);const cancelled:string[]=[];
 const api=async(method:string,path:string)=>{
  if(method==='POST'){cancelled.push(path);return null;}
  if(path.startsWith('git/matching-refs/'))return [{ref:'refs/heads/claim/5617',object:{sha}}];
  if(path.startsWith('git/commits/'))return {message:'{"version":1,"issue":5617}'};
  if(path.startsWith('git/ref/')){throw Object.assign(new Error('gone'),{status:404});}
  return {workflow_runs:path.includes('status=queued')?[run,{...run,id:3,event:'push',head_branch:'main'}]:[]};
 };
 await control.reconcile(api);assert.deepEqual(cancelled,['actions/runs/1/cancel']);
 assert.equal((await store.get('claim-mirrors'))[0].issue,5617);assert.equal(typeof (await control.status()).lastReconcile,'number');
 await assert.rejects(control.reconcile(async(m,p)=>{if(p.startsWith('git/ref/'))throw Object.assign(new Error('forbidden'),{status:403});return api(m,p);}));
 store.db.close();
});
test('owner routes refuse missing auth and invalid claim fields; queue retries failures',async()=>{
 const {control,store}=controller();const env={REPOSITORY:repo,OWNER_TOKEN:'test-owner',REPO_CONTROL:{getByName:()=>control}} as unknown as Env;
 assert.equal((await worker.fetch(new Request('https://local/status'),env)).status,401);
 const headers={authorization:'Bearer test-owner','content-type':'application/json'};
 assert.equal((await worker.fetch(new Request('https://local/status',{headers}),env)).status,200);
 assert.equal((await worker.fetch(new Request('https://local/claims',{method:'POST',headers,body:JSON.stringify({issue:1,operation:'acquire',holder:'session-39',ttlSeconds:0})}),env)).status,400);
 let retries=0,acks=0;
 const batch={messages:[{body:event,ack(){acks++;},retry(){retries++;}}]} as unknown as MessageBatch<Delivery>;
 await worker.queue(batch,env);assert.equal(acks,1);assert.equal(retries,0);store.db.close();
});
test('import boundary, no D1/KV, independent gated deploy, audit is insert-only',()=>{
 const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);
 for(const file of walk('merge-control').filter(f=>/\.(ts|mjs)$/.test(f))){
  const text=readFileSync(file,'utf8');
  for(const m of text.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))assert.ok(resolve(dirname(file),m[1]).startsWith(resolve('merge-control')+'/'),file);
  assert.doesNotMatch(text,/cloudflare-worker\/src/);
 }
 const config=readFileSync('wrangler.merge-control.toml','utf8');assert.doesNotMatch(config,/\[\[?(?:d1_databases|kv_namespaces)/);assert.match(config,/new_sqlite_classes = \["RepoControl"\]/);assert.match(config,/dead_letter_queue/);
 const source=readFileSync('merge-control/src/repoControl.ts','utf8');assert.doesNotMatch(source,/\b(?:UPDATE|DELETE FROM) audit\b/);
 const deploy=readFileSync('.github/workflows/merge-control-deploy.yml','utf8');assert.match(deploy,/MERGE_CONTROL_DEPLOY_ENABLED/);assert.match(deploy,/MERGE_CONTROL_CLOUDFLARE_API_TOKEN/);assert.doesNotMatch(deploy,/npm run deploy|migrate-d1/);
});

test('GitHub App accepts its PKCS1 private key, limits token permissions and signs a valid JWT',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const key=privateKey.export({format:'pem',type:'pkcs1'}).toString();
 const env={REPOSITORY:repo,GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',GITHUB_APP_PRIVATE_KEY:key} as Env;
 let count=0;
 const fetcher=async(url:string|URL|Request,init?:RequestInit)=>{
  count++;
  if(count===1){
   assert.equal(String(url),'https://api.github.com/app/installations/456/access_tokens');
   const jwt=(init?.headers as Record<string,string>).Authorization.slice(7);const [header,payload,signature]=jwt.split('.');
   assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),createPublicKey(privateKey),Buffer.from(signature,'base64url')),true);
   assert.equal(JSON.parse(Buffer.from(payload,'base64url').toString()).iss,'123');
   assert.deepEqual(JSON.parse(String(init?.body)).permissions,{actions:'write',contents:'read'});
   return Response.json({token:'test-installation-token'});
  }
  assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-installation-token');
  return Response.json({workflow_runs:[]});
 };
 const api=await githubClient(env,fetcher as typeof fetch);await api('GET','actions/runs?event=merge_group');assert.equal(count,2);
});
test('flipping the switch during a delivery stops all subsequent GitHub reads as well as writes',async()=>{
 const {control,store}=controller();await control.setKillSwitch(false);let calls=0;
 const api=async()=>{calls++;await control.setKillSwitch(true);return {workflow_runs:[run]};};
 await assert.rejects(control.process(event,api),/kill switch/);
 assert.equal(calls,1);
 await control.process(event,async()=>{throw new Error('retry while disabled must not call GitHub');});
 assert.equal(store.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE kind='event'").one().n,1);store.db.close();
});
