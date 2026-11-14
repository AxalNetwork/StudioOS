/** D4438 (#4438) — real scoped segment reads, synthetic HQ/branch databases and no remote personal fields. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import route from '../src/routes/admin_persona_segment_scopes.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { branchSegmentOverview, combineSegmentSummaries, localSegmentOverview, scopedSegmentOverview } from '../src/services/personaSegmentScopes.ts';
import { readPersonaSegments } from '../src/services/personaSegments.ts';
const SECRET = 'synthetic-scoped-persona-secret-'.repeat(2);
const NOW = Date.parse('2026-11-04T12:00:00Z');
test.after(removeMigratedDatabases);
function fixture(code?: string, members = 2) {
  const db = migratedDatabase();
  db.exec("INSERT INTO users (id,email,name,role,is_active) VALUES (1,'hq@example.test','Synthetic HQ','admin',1),(2,'admin@example.test','Synthetic Admin','admin',1),(3,'member@example.test','Synthetic member','founder',1); INSERT INTO super_admins (user_id) VALUES (1);");
  for (let i=0;i<members;i++) { db.prepare("INSERT INTO users (id,email,name,role,is_active) VALUES (?,?,'Synthetic member','founder',1)").run(10+i,`synthetic${i}@example.test`); db.prepare("INSERT INTO user_personas (user_id,persona_id,is_primary,source,confidence) VALUES (?,'founder_new',1,'router',.9)").run(10+i); }
  const env: any = { DB:d1Over(db), JWT_SECRET:SECRET, ENVIRONMENT:'development', ...(code ? {BRANCH_CODE:code}: {}) };
  const app=new Hono<any>().route('/api/admin/persona-segment-scopes',route);
  app.onError((e,c)=>c.json({message:e.message},AUTH_ERROR_STATUSES[e.message]??500));
  async function call(path='',who:number|null=1) { const headers:any={};if(who)headers.Authorization=`Bearer ${await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;const res=await app.request('/api/admin/persona-segment-scopes'+path,{headers},env);return {status:res.status,body:await res.json() as any}; }
  function registry(code:string,status='linked') { db.prepare("INSERT INTO licence_deployments (licence_uid,code,hostname,worker_name,d1_name,status) VALUES (?,?,?,?,?,?)").run('lic-'+code,code,code+'.example.test','worker-'+code,'db-'+code,status); }
  return {db,env,call,registry};
}

test('Super Admin alone can read; scopes come from deployed registry rows, never arbitrary bindings',async()=>{
  const f=fixture();f.registry('fr');f.registry('de','requested');f.env.BRANCH_GHOST={personaSegmentOverview:()=>{throw new Error('must not call');}};
  assert.equal((await f.call('',null)).status,401);assert.equal((await f.call('',2)).status,403);assert.equal((await f.call('',3)).status,403);
  const r=await f.call();assert.equal(r.status,200);assert.deepEqual(r.body.scopes.map((s:any)=>s.code),['hq','fr','*']);
  for(const path of ['/overview?scope=ghost','/suggestions?scope=ghost'])assert.equal((await f.call(path)).status,404);
  const branch=fixture('fr');assert.equal((await branch.call()).status,403);
});

test('HQ is default and matches the existing count queries; projections carry only aggregate keys',async()=>{
  const f=fixture();const existing=await readPersonaSegments(f.env,NOW);const read=await localSegmentOverview(f.env,NOW);
  assert.deepEqual(read.summary.members,existing.members);
  assert.deepEqual(read.summary.by_profile,existing.by_profile);
  const result=await f.call('/overview');assert.equal(result.status,200);assert.equal(result.body.scope.code,'hq');
  const serialized=JSON.stringify(result.body);assert.doesNotMatch(serialized,/hq@example|member@example|suggested_by|updated_by/);
  assert.equal(result.body.summary.members.total,3,'admins excluded, the unclassified member included');
});

test('one studio reads its database once; all studios sum each summary and include HQ',async()=>{
  const f=fixture(undefined,2);const fr=fixture('fr',5);f.registry('fr');let calls=0;let decoy=0;f.env.BRANCH_DECOY={personaSegmentOverview:()=>{decoy++;throw new Error('unregistered');}};
  f.env.BRANCH_FR={personaSegmentOverview:async(now:number)=>{calls++;return branchSegmentOverview(fr.env,now);}};
  const one=await scopedSegmentOverview(f.env,'fr');assert.equal(calls,1);assert.equal(one.summary.members.in_segment,5);
  const all=await scopedSegmentOverview(f.env,'*');assert.equal(calls,2);assert.equal(all.summary.members.in_segment,7);assert.equal(all.summary.members.no_segment,2);assert.equal(all.sources.complete,true);assert.equal(decoy,0);
  assert.equal(all.coverage.recorded,false,'per-studio needs cannot be invented as a single combined definition');
});

test('unbound, failed, old and wrong-tier replies remain unreadable, never a shrinking all-studio total',async()=>{
  const f=fixture();f.registry('fr');f.registry('es');f.env.BRANCH_FR={personaSegmentOverview:async()=>{throw new Error('synthetic failure');}};
  const all=await f.call('/overview?scope=*');assert.equal(all.status,200);assert.equal(all.body.summary.members.available,false);assert.deepEqual(all.body.sources,{total:2,answered:0,complete:false});
  f.env.BRANCH_FR={personaSegmentOverview:async()=>({branch:'hq',overview:{}})};
  assert.equal((await f.call('/overview?scope=fr')).body.summary.members.available,false);
  f.db.exec('DROP TABLE licence_deployments');assert.equal((await f.call('/overview?scope=fr')).status,503);
});

test('waiting suggestions use existing store, filtered before its limit; plain Admin refused',async()=>{
  const f=fixture();f.registry('fr');const insert=f.db.prepare("INSERT INTO segment_suggestions (uid,segment_key,kind,text,status,suggested_by,suggested_by_name,origin_code) VALUES (?,'founder_new','who',?,?,2,'Synthetic admin',?)");
  insert.run('hq-open','HQ proposal','open','hq');insert.run('fr-open','Branch proposal','open','fr');insert.run('hq-done','Old proposal','accepted','hq');
  const hq=await f.call('/suggestions');assert.deepEqual(hq.body.suggestions.map((s:any)=>s.uid),['hq-open']);
  const fr=await f.call('/suggestions?scope=fr');assert.deepEqual(fr.body.suggestions.map((s:any)=>s.uid),['fr-open']);
  assert.equal((await f.call('/suggestions?scope=*')).body.suggestions.length,2);
  assert.equal((await f.call('/suggestions',2)).status,403);
  f.db.exec('DROP TABLE segment_suggestions');assert.equal((await f.call('/suggestions')).status,503);
});

test('null/missing figures are preserved and arbitrary remote personal fields are dropped',async()=>{
  const f=fixture();const raw=await readPersonaSegments(f.env,NOW);
  const changed={...raw,members:{...raw.members,new_30d:null,email:'hidden@example.test'},segments:{...raw.segments,rows:raw.segments.rows.map((r:any)=>({...r,user_id:987,email:'hidden@example.test'}))}};
  const read=combineSegmentSummaries([changed],NOW);assert.equal(read.members.new_30d,null);assert.doesNotMatch(JSON.stringify(read),/hidden@example|user_id/);
  await assert.rejects(branchSegmentOverview(f.env),/Branch only/);
});
