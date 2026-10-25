/** D992: verdict validation and explicit field clearing on the canonical SQLite schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import profiling from '../src/routes/profiling.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';
import { userMeetsTier } from '../src/middleware/requireTier.ts';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const later = postCutoffMigrations(process.cwd()).map((m: any) => m.sql);
const email = 'profile@example.test';
// Build the canonical world once; each test gets its own byte-for-byte copy.
const templateDir = mkdtempSync(join(tmpdir(), 'd992-template-'));
const templatePath = join(templateDir, 'schema.sqlite');
const canonical = buildFresh(baseline, later);
canonical.exec(`VACUUM INTO '${templatePath.replaceAll("'", "''")}'`);
canonical.close();
const schemaBytes = readFileSync(templatePath);
rmSync(templateDir, { recursive: true });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'd992-test-'));
  const path = join(dir, 'db.sqlite');
  writeFileSync(path, schemaBytes);
  const db = new DatabaseSync(path);
  // Durability is outside this test: avoid disk journal fsyncs for disposable copies.
  db.exec('PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF');
  const close = db.close.bind(db);
  db.close = () => { close(); rmSync(dir, { recursive: true }); };
  db.prepare("INSERT INTO users(id,email,name,role,email_verified) VALUES(1,'admin@example.test','Synthetic admin','admin',1),(2,?,'Synthetic member','founder',1)").run(email);
  db.prepare("INSERT INTO partner_profiles(email,user_id,admin_status,admin_notes,agreement_type,updated_at) VALUES(?,2,'pending','Previous note','previous-agreement','2000-01-01')").run(email);
  return db;
}
const app = new Hono<any>();
app.route('/api/profiling', profiling);
app.onError((e: any, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : e.message === 'Admin required' ? 403 : 500));
async function call(db: any, body: any, user = 1, target = email, DB = d1Over(db)) {
  const token = user ? await new SignJWT({user_id:user,role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET)) : '';
  const res = await app.request(`/api/profiling/admin/${encodeURIComponent(target)}/verify`, {method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)}, {DB,JWT_SECRET,ENVIRONMENT:'development'});
  return {status:res.status,body:await res.json() as any};
}
const profile = (db: any) => ({...db.prepare('SELECT * FROM partner_profiles WHERE email=?').get(email)});
const logs = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all();
for (const status of ['unknown','pending','VERIFIED','',null,17,{},undefined]) {
 test(`an invalid verdict ${JSON.stringify(status)} refuses without changing the profile or audit`,async()=>{
  const db=fixture();try {const before=profile(db);const r=await call(db,{status,admin_notes:'New note',agreement_type:''});assert.equal(r.status,400);assert.equal(r.body.error,'invalid_status');assert.match(r.body.message,/Verified.*Rejected.*Reopen/);assert.deepEqual(profile(db),before);assert.equal(logs(db).length,0);}finally{db.close();}
 });
}
for (const field of ['admin_notes','agreement_type']) for (const value of ['',null]) {
 test(`${field} clears explicitly with ${JSON.stringify(value)} and preserves the omitted other field`,async()=>{
  const db=fixture();try {const before=profile(db);const r=await call(db,{status:'rejected',[field]:value});assert.equal(r.status,200);assert.equal(profile(db)[field],null);assert.equal(r.body[field],null);const other=field==='admin_notes'?'agreement_type':'admin_notes';assert.equal(profile(db)[other],before[other]);assert.equal(r.body[other],before[other]);assert.equal(profile(db).admin_status,'rejected');assert.equal(logs(db).length,2);}finally{db.close();}
 });
}
test('both fields can be replaced, then omitted on verification without sending an old agreement',async()=>{
 const db=fixture();try {assert.equal((await call(db,{status:'rejected',agreement_type:'replacement',admin_notes:'Replacement note'})).status,200);const r=await call(db,{status:'verified'});assert.equal(r.status,200);assert.equal(r.body.agreement_type,'replacement');assert.equal(r.body.admin_notes,'Replacement note');assert.equal(r.body.esign,null);assert.equal(profile(db).admin_status,'verified');const audit=logs(db);assert.equal(audit.length,4);assert.ok(audit.every((r:any)=>!r.details.includes(email)));assert.deepEqual(audit.map((r:any)=>r.user_id),[1,2,1,2]);}finally{db.close();}
});
for (const user of [0,2]) test(`verify refuses ${user ? 'a non-admin' : 'an anonymous request'} without writes`,async()=>{
 const db=fixture();try {const before=profile(db);assert.equal((await call(db,{status:'verified',agreement_type:''},user)).status,user?403:401);assert.deepEqual(profile(db),before);assert.equal(logs(db).length,0);}finally{db.close();}
});
test('an absent profile is a 404 and writes no audit',async()=>{
 const db=fixture();try {const before=profile(db);assert.equal((await call(db,{status:'rejected'},1,'absent@example.test')).status,404);assert.deepEqual(profile(db),before);assert.equal(logs(db).length,0);}finally{db.close();}
});
test('a failed profile read is a 5xx without a verdict or audit',async()=>{
 const db=fixture();try {const before=profile(db);const DB=d1Over(db);const faulty={...DB,prepare(sql:string){if(/^SELECT \* FROM partner_profiles WHERE email/.test(sql))throw new Error('Synthetic read failure');return DB.prepare(sql);}};assert.equal((await call(db,{status:'rejected'},1,email,faulty)).status,500);assert.deepEqual(profile(db),before);assert.equal(logs(db).length,0);}finally{db.close();}
});
test('the existing shared plan policy exempts admins, including free-plan admins',()=>{
 assert.equal(userMeetsTier({role:'admin',subscription_tier:'free'} as any,'studio'),true);
 assert.equal(userMeetsTier({role:'founder',subscription_tier:'free'} as any,'studio'),false);
});

// The present admin exemption makes a plan refusal unreachable naturally.
// An isolated child forces ONLY that policy answer; auth and every SQL write
// still run through the actual route. No production test seam is introduced.
for (const providerKey of ['provider','via_provider']) test(`DocuSign preflight refuses before verdict and audit via ${providerKey}`,async()=>{
 const db=fixture();const dir=mkdtempSync(join(tmpdir(),'d992-policy-'));
 try {
  const before=profile(db);const path=join(dir,'world.sqlite');
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  const loader=join(dir,'policy.mjs');
  const hooks=`export async function load(url,context,nextLoad){const r=await nextLoad(url,context);if(url.endsWith('/middleware/requireTier.ts')){const s=String(r.source);if(!s.includes('if (!user) return false;'))throw new Error('Policy fault setup changed');return {...r,source:s.replace('if (!user) return false;','return false;')};}return r;}`;
  writeFileSync(loader,`import {register} from 'node:module';register('data:text/javascript,'+encodeURIComponent(${JSON.stringify(hooks)}),import.meta.url);`);
  const url=(file:string)=>JSON.stringify(pathToFileURL(join(process.cwd(),file)).href);
  const runner=join(dir,'run.mjs');
  writeFileSync(runner,`import {DatabaseSync} from 'node:sqlite';
import {Hono} from ${JSON.stringify(import.meta.resolve('hono'))};
import {SignJWT} from ${JSON.stringify(import.meta.resolve('jose'))};
import profiling from ${url('cloudflare-worker/src/routes/profiling.ts')};
import {d1Over} from ${url('cloudflare-worker/test/_d1_sqlite.mjs')};
const db=new DatabaseSync(process.argv[2]);const app=new Hono();app.route('/api/profiling',profiling);
const secret=${JSON.stringify(JWT_SECRET)};const token=await new SignJWT({user_id:1,role:'admin'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
const res=await app.request('/api/profiling/admin/profile%40example.test/verify',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({status:'verified',agreement_type:'new-agreement',admin_notes:'Changed',[process.argv[3]]:'DOCUSIGN'})},{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'});
console.log(JSON.stringify({status:res.status,body:await res.json(),profile:db.prepare('SELECT * FROM partner_profiles').get(),audits:db.prepare('SELECT count(*) n FROM activity_logs').get().n,envelopes:db.prepare('SELECT count(*) n FROM esign_envelopes').get().n}));db.close();`);
  const child=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings','--import','./cloudflare-worker/test/_ts-loader.mjs','--import',loader,runner,path,providerKey],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const r=JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  assert.equal(r.status,402);assert.equal(r.body.error,'tier_required');assert.match(r.body.message,/Raise \+ Grow/);assert.deepEqual(r.profile,before);assert.equal(r.audits,0);assert.equal(r.envelopes,0);
 }finally{db.close();rmSync(dir,{recursive:true});}
});
