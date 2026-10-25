/** D1156: real SQL and routes with synthetic branch reports; never a provider call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import grants from '../src/routes/admin_program_grants.ts';
import licencePrograms from '../src/routes/licence_programs.ts';
import { recordProgramUsage, readProgramUsage, collectProgramUsage, pushProgramUsage, sendProgramUsageNow, PROGRAM_REPORT_STALE_MS } from '../src/services/programUsage.ts';

const root = resolve(process.cwd(), 'cloudflare-worker/sql');
const migration = readFileSync(resolve(root, 'migrations/601_program_usage_reports.sql'), 'utf8');
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(root, 'schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(resolve(root, 'migrations')).filter(f => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations)) {
    if (migrationNumber(f) > BASELINE_CUTOFF) db.exec(readFileSync(resolve(root, 'migrations', f), 'utf8'));
  }
  return (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(x => x.sql);
})();
const secret = 'synthetic-program-report-secret';
const jwtSecret = 'synthetic-jwt-secret-at-least-32-characters';
const at = '2026-10-25T12:00:00.000Z';
const now = () => new Date(at);
const figure = (program_key = 'perks', claims: number | null = 3) => ({ program_key, people: 2, cohorts: null, referrals: null, claims, unreadable: 0 });
async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const sql of ddl) { try { db.exec(sql); } catch { /* schema-only trigger/view dependency ordering */ } }
  for (const [id, role] of [[1,'admin'],[2,'admin'],[3,'founder']] as const) db.prepare("INSERT INTO users (id, name, email, role, is_active) VALUES (?, 'Synthetic member', ?, ?, 1)").run(id, `synthetic-${id}@example.test`, role);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(1);
  for (const [id, uid] of [[1,'lic_a'],[2,'lic_b']] as const) db.prepare("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, ?, ?, 'Synthetic entity', 'Synthetic studio', 'active')").run(id, uid, `SYN-${id}`);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map(x => x.toString(16).padStart(2,'0')).join('');
  for (const [uid, code] of [['lic_a','aa'],['lic_b','bb']]) db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status, rpc_secret_hash) VALUES (?, ?, 'synthetic.invalid', 'synthetic', 'synthetic', 'live', ?)").run(uid,code,hash);
  for (const [lic, key] of [[1,'perks'],[1,'learning'],[2,'perks']] as const) addGrant(db, lic, key);
  return { db, env: { DB: d1Over(db), JWT_SECRET: jwtSecret, ENVIRONMENT: 'development' } as any };
}
function addGrant(db: DatabaseSync, id: number, key: string, state = 'granted') {
  db.prepare('INSERT INTO program_grants (uid, licence_id, program_key, state, set_by_user_id, set_at) VALUES (?, ?, ?, ?, ?, ?)').run(`grant-${id}-${key}`, id, key, state, 1, at);
}
const report = (env: any, figures: any[] = [figure()], stamp = at, code = 'aa') => recordProgramUsage(env,code,secret,stamp.slice(0,7),stamp,figures,now());
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM program_usage_reports ORDER BY licence_uid, program_key').all() as any[];
function localCopy(db: DatabaseSync, keys = ['perks','learning']) {
  db.prepare("INSERT INTO branch_licence (id, licence_uid, status, pushed_at, program_grants_json) VALUES (1, 'lic_a', 'active', '2026-10-01T00:00:00.000Z', ?)")
    .run(JSON.stringify({ grants: keys.map(program_key => ({ program_key, state:'granted' })), offered:{} }));
}
const app = new Hono<any>();
app.onError((err,c) => c.json({error:'refused'},AUTH_ERROR_STATUSES[err.message] || 500));
app.route('/api/admin/program-grants',grants); app.route('/api/licence',licencePrograms);
async function call(env: any, id: number | null, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string,string> = {};
  if (id) headers.Authorization = `Bearer ${await new SignJWT({ user_id:id, role:id === 3 ? 'founder' : 'admin' }).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(jwtSecret))}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await withThrownResponses(() => app.request(path,{method,headers,...(body ? {body:JSON.stringify(body)} : {})},env));
  return {status:response.status,body:await response.json() as any};
}

test('migration: latest key is unique; unknown licence and invalid counts refuse', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE territory_licences(uid TEXT PRIMARY KEY)'); db.exec(migration);
  const insert = db.prepare("INSERT INTO program_usage_reports (licence_uid,program_key,branch_code,period,people,reported_at,received_at) VALUES ('a','perks','aa','2026-10',?, ?, ?)");
  assert.throws(() => insert.run(1,at,at));
  db.exec("INSERT INTO territory_licences VALUES ('a')");
  for (const v of [-1,1.5,'private']) assert.throws(() => insert.run(v,at,at));
  insert.run(0,at,at); assert.throws(() => insert.run(2,at,at));
  assert.equal(db.prepare('SELECT people FROM program_usage_reports').get()!.people,0);
});

test('missing reports are absent, never synthetic zero; only current grants and one studio', async () => {
  const {db,env} = await fixture(); addGrant(db,1,'refer-and-earn','ended');
  const read = await readProgramUsage(env,1,'lic_a',now());
  assert.deepEqual(read.programs.map(p => [p.program_key,p.state,p.counts,p.reported_at]),[['perks','not_reported',null,null],['learning','not_reported',null,null]]);
  assert.equal(read.programs[0].reason,'This studio has not reported program figures yet.');
  assert.equal(read.licence_uid,'lic_a');
});

test('reports authenticate before writing and accept neither another studio nor personal fields', async () => {
  const {db,env} = await fixture();
  for (const [code,key] of [['aa','wrong'],['zz',secret],['bb','wrong']]) await assert.rejects(recordProgramUsage(env,code,key,'2026-10',at,[figure()],now()), /program_usage_auth_refused/);
  await assert.rejects(report({...env,BRANCH_CODE:'aa'}),/program_usage_auth_refused/);
  db.prepare("UPDATE licence_deployments SET rpc_secret_hash = NULL WHERE code = 'aa'").run();
  await assert.rejects(report(env),/program_usage_auth_refused/);
  assert.equal(rows(db).length,0);
  const other = await fixture();
  for (const f of [{...figure(),email:'private@example.test'},{...figure(),licence_uid:'lic_b'},figure('spinout-lab'),figure('perks',-1),figure('perks',1.5),figure('perks',Number.MAX_SAFE_INTEGER+1),{...figure(),people:'2'},{...figure(),unreadable:1},{...figure(),unreadable:16}]) await assert.rejects(report(other.env,[f]),/program_usage_report_invalid/);
  for (const stamp of ['2026-10-99T12:00:00.000Z','2026-02-30T12:00:00.000Z','2026-11-25T12:00:00.000Z','private']) await assert.rejects(report(other.env,[figure()],stamp),/program_usage_report_invalid/);
  await assert.rejects(report(other.env,[figure(),figure()]),/program_usage_report_invalid/);
  await assert.rejects(report(other.env,[figure('learning',null)],at,'bb'),/program_usage_report_invalid/);
  await assert.rejects(recordProgramUsage(other.env,'aa',secret,'2026-09',at,[figure()],now()),/program_usage_report_invalid/);
  assert.equal(rows(other.db).length,0);
});

test('newest per studio/program wins, retries are idempotent, stale evidence stays dated and measured zero survives', async () => {
  const {db,env} = await fixture();
  assert.deepEqual(await report(env),{ok:true,programs:1});
  await report(env,[figure('perks',8)]); // same timestamp cannot race-replace
  assert.equal(rows(db)[0].claims,3);
  const earlier = '2026-09-25T12:00:00.000Z'; await report(env,[figure('perks',9)],earlier);
  assert.equal(rows(db)[0].period,'2026-10');
  const later = '2026-10-25T12:01:00.000Z'; await report(env,[{...figure('perks',0),people:null,unreadable:1}],later);
  await report(env,[figure('perks',7)],at,'bb');
  const read = await readProgramUsage(env,1,'lic_a',new Date(Date.parse(later)+PROGRAM_REPORT_STALE_MS+1));
  const p = read.programs[0]; assert.equal(p.state,'reported'); assert.equal(p.reported_at,later); assert.equal(p.stale,true); assert.ok(p.age_seconds! >= 172800);
  assert.deepEqual(p.counts,{people:{value:null,state:'unreadable',reason:'This studio could not read this program figure. Try again after its next report.'},cohorts:{value:null,state:'not_recorded',reason:'This studio has no recorded measure for this program figure.'},referrals:{value:null,state:'not_recorded',reason:'This studio has no recorded measure for this program figure.'},claims:{value:0,state:'recorded',reason:null}});
  assert.equal((await readProgramUsage(env,1,'lic_a',new Date(later))).programs[0].stale,false);
  assert.equal(rows(db).length,2); assert.equal(rows(db)[1].claims,7); assert.equal(rows(db)[0].branch_code,'aa');
  assert.deepEqual(Object.keys(rows(db)[0]).sort(),['branch_code','claims','cohorts','licence_uid','people','period','program_key','received_at','referrals','reported_at','unreadable'].sort());
});

test('a report transaction rolls back every program if storage fails', async () => {
  const {db,env} = await fixture();
  const real = env.DB;
  env.DB = {...real,batch: async (statements: any[]) => real.batch([...statements,real.prepare("INSERT INTO program_usage_reports (licence_uid) VALUES (?)").bind('invalid')])};
  await assert.rejects(report(env,[figure(),figure('learning',null)])); assert.equal(rows(db).length,0);
});

test('collector counts local monthly events and distinct participants, drops member fields, isolates failed metrics', async () => {
  const {db,env} = await fixture(); localCopy(db,['perks','learning','refer-and-earn','referral-partners','mentor-cohorts','spinout-lab','ai-native-venture']);
  // Source rows contain private fields: only SQL aggregates are allowed onto the wire.
  db.prepare("INSERT INTO perk_claims (uid,perk_id,user_id,code,created_at) VALUES ('c1',1,3,'private-code','2026-10-02'),('c2',2,3,'private-code','2026-10-03'),('old',1,2,'private-code','2026-09-02')").run();
  db.prepare("INSERT INTO learning_programs (id,uid,name,status,created_by) VALUES (1,'lp','Private curriculum','published',1)").run();
  db.prepare("INSERT INTO learning_enrollments (program_id,user_id,enrolled_by,enrolled_at) VALUES (1,3,1,'2026-10-01')").run();
  db.prepare("INSERT INTO referral_submissions (uid,referrer_user_id,referred_name,referred_contact,status,created_at) VALUES ('r1',3,'Private name','private contact','submitted','2026-10-03'),('draft',2,'Draft','private','draft','2026-10-02')").run();
  const branch = {...env,BRANCH_CODE:'aa'};
  const read = await collectProgramUsage(branch,now());
  const by = Object.fromEntries(read.figures.map(f => [f.program_key,f]));
  assert.equal(read.period,'2026-10'); assert.equal(read.reported_at,at);
  assert.equal(by.perks.people,1); assert.equal(by.perks.claims,2);
  assert.equal(by.learning.people,1); assert.equal(by.learning.cohorts,null);
  assert.equal(by['refer-and-earn'].people,1); assert.equal(by['refer-and-earn'].referrals,1);
  assert.equal(by['referral-partners'].referrals,0); assert.equal(by['mentor-cohorts'].cohorts,0); assert.equal(by['spinout-lab'].cohorts,0);
  assert.deepEqual(by['ai-native-venture'],{program_key:'ai-native-venture',people:null,cohorts:null,referrals:null,claims:null,unreadable:0});
  assert.doesNotMatch(JSON.stringify(read),/Private|private|@|user_id|code"/);
  db.exec('DROP TABLE perk_claims');
  const failed = await collectProgramUsage(branch,now());
  assert.equal(failed.figures.find(f => f.program_key === 'perks')!.unreadable,9);
  assert.equal(failed.figures.find(f => f.program_key === 'perks')!.claims,null);
  assert.equal(failed.figures.find(f => f.program_key === 'learning')!.people,1);
});

test('cohort and partner metrics count their own recorded rows and refuse old/future events', async () => {
  const {db,env} = await fixture(); localCopy(db,['spinout-lab','mentor-cohorts','referral-partners']);
  db.prepare("INSERT INTO cohort_cycles (id,year,month,start_at,end_at,status,app_status) VALUES (1,2026,10,'2026-10-01','2026-10-29','active','active'),(2,2026,9,'2026-09-01','2026-09-29','completed','active'),(3,2026,11,'2026-11-01','2026-11-29','scheduled','open'),(4,2026,8,'2026-10-01','2026-10-29','scheduled','postponed'),(5,2026,7,'2026-10-01','2026-10-29','scheduled','postponed')").run();
  db.prepare("INSERT INTO cohort_applicants (application_id,user_id,cohort_cycle_id,status) VALUES (1,3,1,'activated'),(2,3,1,'activated'),(3,2,1,'approved'),(4,2,2,'activated'),(5,2,4,'activated')").run();
  db.prepare("INSERT INTO advisor_cohort_assignments (uid,advisor_user_id,cohort_cycle_id,assigned_at,is_active,unassigned_at) VALUES ('m1',2,1,'2026-09-01',1,NULL),('m2',2,2,'2026-10-01',0,'2026-10-05'),('m3',3,2,'2026-08-01',0,'2026-09-01'),('m4',3,3,'2026-11-01',1,NULL)").run();
  db.prepare("INSERT INTO partner_referral_redemptions (partner_deal_id,redeemed_by_user_id,attribution_kind,redeemed_at) VALUES (1,3,'referral','2026-10-01'),(2,3,'referral','2026-10-02'),(3,2,'deal_sourcing_revshare','2026-10-01'),(4,2,'referral','2026-09-01'),(5,2,'referral','2026-11-01'),(6,1,'referral','2026-11-01')").run();
  const read = await collectProgramUsage({...env,BRANCH_CODE:'aa'},now());
  const by = Object.fromEntries(read.figures.map(f=>[f.program_key,f]));
  assert.equal(by['spinout-lab'].cohorts,1); assert.equal(by['spinout-lab'].people,1);
  assert.equal(by['mentor-cohorts'].cohorts,2); assert.equal(by['mentor-cohorts'].people,1);
  assert.equal(by['referral-partners'].referrals,2); assert.equal(by['referral-partners'].people,1);
});

test('push fails closed on tier/config/copy, checks HQ acknowledgement, bounds time, never returns private failure text', async () => {
  const {db,env} = await fixture(); localCopy(db);
  let calls = 0, args: any[] = [];
  const branch = {...env,BRANCH_CODE:'aa',RPC_SECRET:secret,HQ:{reportProgramUsage:async (...a:any[]) => {calls++;args=a;return {ok:true,programs:2};}}};
  assert.equal((await pushProgramUsage(env,now())).sent,false);
  assert.equal((await pushProgramUsage({...branch,RPC_SECRET:''},now())).sent,false);
  assert.equal((await pushProgramUsage({...branch,HQ:{}},now())).sent,false); assert.equal(calls,0);
  assert.deepEqual(await pushProgramUsage(branch,now()),{sent:true,programs:2});
  assert.equal(args[0],'aa'); assert.equal(args[1],secret); assert.equal(args[2],'2026-10'); assert.equal(args[3],at);
  assert.equal(args[4].length,2); assert.equal(Object.hasOwn(args[4][0],'user_id'),false);
  assert.equal((await pushProgramUsage({...branch,HQ:{reportProgramUsage:async () => ({ok:false,programs:2})}},now())).sent,false);
  assert.equal((await pushProgramUsage({...branch,HQ:{reportProgramUsage:async () => ({ok:true,programs:999})}},now())).sent,false);
  const failed = await pushProgramUsage({...branch,HQ:{reportProgramUsage:async () => {throw new Error('private-credentials-and-figures');}}},now());
  assert.equal(failed.sent,false); assert.doesNotMatch(JSON.stringify(failed),/private/);
  assert.equal((await pushProgramUsage({...branch,HQ:{reportProgramUsage:() => new Promise(()=>{})}},now(),5)).sent,false);
  db.exec('DELETE FROM branch_licence'); assert.equal((await pushProgramUsage(branch,now())).sent,false); assert.equal(calls,1);
});

test('Send now limits calls and fails closed when its throttle is absent or unreadable', async () => {
  const {db,env} = await fixture(); localCopy(db);
  let calls = 0, value: string | null = null;
  const branch = {...env,BRANCH_CODE:'aa',RPC_SECRET:secret,HQ:{reportProgramUsage:async () => {calls++;return {ok:true,programs:2};}},RATE_LIMITS:{get:async()=>value,put:async(_k:string,v:string,options:any)=>{assert.equal(options.expirationTtl,300);value=v;}}};
  assert.equal((await sendProgramUsageNow({...branch,RATE_LIMITS:undefined},now())).status,503);
  assert.equal((await sendProgramUsageNow({...branch,RATE_LIMITS:{get:async()=>{throw new Error('private');}}},now())).status,503);
  assert.equal(calls,0);
  assert.equal((await sendProgramUsageNow(branch,now())).status,200); assert.equal(calls,1);
  assert.equal((await sendProgramUsageNow(branch,now())).status,429); assert.equal(calls,1);
});

test('HQ read gates Super Admin before storage, scopes uid, preserves partial absence and returns safe unreadable errors', async () => {
  const {env,db} = await fixture(); await report(env);
  for (const id of [null,2,3]) assert.ok([401,403].includes((await call(env,id,'/api/admin/program-grants/licences/lic_a/in-use')).status));
  assert.equal((await call(env,1,'/api/admin/program-grants/licences/missing/in-use')).status,404);
  const a = await call(env,1,'/api/admin/program-grants/licences/lic_a/in-use'); assert.equal(a.status,200); assert.equal(a.body.programs[0].counts.claims.value,3); assert.equal(a.body.programs[1].state,'not_reported');
  const b = await call(env,1,'/api/admin/program-grants/licences/lic_b/in-use'); assert.equal(b.body.programs[0].state,'not_reported');
  assert.equal((await call({...env,BRANCH_CODE:'aa'},1,'/api/admin/program-grants/licences/lic_a/in-use')).status,403);
  db.exec('DROP TABLE program_usage_reports'); const bad = await call(env,1,'/api/admin/program-grants/licences/lic_a/in-use');
  assert.equal(bad.status,503); assert.match(bad.body.message,/unreadable.*Try again/i); assert.doesNotMatch(JSON.stringify(bad.body),/SQL|SELECT|table/);
});

test('on-demand endpoint accepts only a local branch admin, ignores body figures and records actor', async () => {
  const {db,env} = await fixture(); localCopy(db); let args:any[]=[];
  const branch={...env,BRANCH_CODE:'aa',RPC_SECRET:secret,RATE_LIMITS:{get:async()=>null,put:async()=>{}},HQ:{reportProgramUsage:async(...a:any[])=>{args=a;return {ok:true,programs:2};}}};
  assert.equal((await call(env,2,'/api/licence/mine/programs/report','POST')).status,403);
  assert.equal((await call(branch,3,'/api/licence/mine/programs/report','POST')).status,403);
  assert.equal((await call(branch,null,'/api/licence/mine/programs/report','POST')).status,401);
  const out=await call(branch,2,'/api/licence/mine/programs/report','POST',{people:999,email:'private@example.test'});
  assert.equal(out.status,200);assert.equal(out.body.sent,true);assert.doesNotMatch(JSON.stringify(args[4]),/999|private/);
  const audit=db.prepare("SELECT admin_user_id,filters_json FROM admin_audit_log WHERE action='program_usage.sent'").get() as any;
  assert.equal(audit.admin_user_id,2); assert.deepEqual(JSON.parse(audit.filters_json),{programs:2});
});

test('daily schedule and RPC entrypoint call the tested functions; RPC takes the branch secret', () => {
  const entry=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/rpc/index.ts'),'utf8');
  assert.match(entry,/reportProgramUsage\(callerCode: string, secret: string, period: string, reportedAt: string, figures: ProgramFigure\[\]\)/);
  assert.match(entry,/return recordProgramUsage\(this.env, callerCode, secret, period, reportedAt, figures\)/);
  const main=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/index.ts'),'utf8');
  assert.match(main,/if \(!hqCadences && now.getUTCHours\(\) === 5 && now.getUTCMinutes\(\) === 15\) \{[\s\S]{0,240}await pushProgramUsage\(env, now\)/);
});
