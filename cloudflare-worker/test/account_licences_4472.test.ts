/** D4472 (#4472): synthetic accounts, real SQLite batches, licence union and appointment rollback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import routes from '../src/routes/account_licences.ts';
import authRoutes from '../src/routes/auth.ts';
import adminRoutes from '../src/routes/admin.ts';
import appointments from '../src/routes/admin_licences.ts';
import { requireRole, requireAdmin, getCurrentUser } from '../src/auth.ts';
import { heldLicences, grantLicence, revokeLicence, holdsLicence, holdsOnlyLicence } from '../src/services/accountLicences.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ensureRoleProfile } from '../src/services/ensureRoleProfile.ts';
import { canAccessFounderResource, canViewLpData, canViewPartnerDemand } from '../src/auth.ts';
import { isFounder, isInvestor, isPartner } from '../src/routes/_t13t14t15_helpers.ts';
import { canHoldValidateSource, canWritePitchDeck } from '../src/routes/_founder_validate_helpers.ts';
import { canAccessProject, isProjectManager } from '../src/services/projectAccess.ts';
import { verifiedInvestor } from '../src/services/roundCallPolicy.ts';
import { canMoveRound } from '../src/services/dealStudioLens.ts';
import { canReadOperatorReview } from '../src/services/section83bOperatorReview.ts';
import { modulePageAllowed } from '../src/routes/ai_modules.ts';
import { PipelineRoom } from '../src/durable-objects/pipeline-room.ts';
import diligence from '../src/routes/dd.ts';
import projects from '../src/routes/projects.ts';
import advisors from '../src/routes/advisors.ts';
import performance from '../src/routes/fund_performance.ts';


const SECRET = 'synthetic-4472-account-licence-secret';
const migration = readdirSync(new URL('../sql/migrations/', import.meta.url)).find(n => n.endsWith('_account_licences.sql'))!;
const ddl = readFileSync(new URL('../sql/migrations/' + migration, import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users(id,email,name,role,is_active) VALUES
    (9000,'admin@example.test','Synthetic admin','admin',1),
    (9001,'founder@example.test','Synthetic founder','founder',1),
    (9002,'other@example.test','Synthetic other','advisor',1),
    (9003,'explorer@example.test','Synthetic explorer','exploring',1),
    (9004,'partner@example.test','Synthetic partner','partner',1),
    (9005,'investor@example.test','Synthetic investor','investor',1);
    INSERT INTO super_admins(user_id) VALUES (9000);
    INSERT INTO territory_licences(uid,licence_ref,legal_entity_name,brand_name,status)
      VALUES ('synthetic-territory','TEST-4472','Synthetic entity','Synthetic brand','active');`);
  // Apply to existing primary-role accounts: any forbidden backfill is observable.
  db.exec(ddl);
  for (const id of [9000,9001,9002,9003,9004,9005]) db.prepare(`INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at)
    VALUES (?,?,'totp','totp',datetime('now'))`).run(id,'synthetic-'+id);
  const DB = d1Over(db);
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  let grantReads = 0;
  env.DB = { ...DB, prepare(sql: string) { if (sql.startsWith('SELECT licence FROM account_licences')) grantReads++; return DB.prepare(sql); } };
  const app = new Hono<any>();
  app.route('/api/projects',projects);
  app.route('/api/dd',diligence).route('/api/advisors',advisors).route('/api/fund-performance',performance);
  app.route('/api', routes).route('/api/auth', authRoutes).route('/api/admin/licences', appointments).route('/api/admin', adminRoutes);
  app.get('/role/:licence', async c => c.json({ id: (await requireRole(c,c.req.param('licence') as any)).id }));
  app.get('/investor-only', async c => c.json({ id: (await requireRole(c,'investor')).id }));
  app.get('/admin-only', async c => c.json({ id: (await requireAdmin(c)).id }));
  app.get('/twice', async c => { const a = await getCurrentUser(c); const b = await getCurrentUser(c); return c.json({ a: a?.licences, b: b?.licences }); });
  app.onError((error,c) => c.json({ error: 'test_failure', code: AUTH_ERROR_STATUSES[error.message] ? 'access_refused' : 'unavailable' }, (AUTH_ERROR_STATUSES[error.message] || 503) as any));
  return { db, env, DB: env.DB, reads: () => grantReads, async call(path: string, user: number | null=9001, method='GET', body?: unknown, support=false) {
    const headers: Record<string,string> = { 'Content-Type':'application/json' };
    if (user !== null) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id:user,jti:'synthetic-'+user,...(support?{impersonated_by:9000}:{}) })
      .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const response = await app.request(path,{method,headers,body:body === undefined?undefined:JSON.stringify(body)},env);
    return { status:response.status, body:await response.json() as any };
  } };
}
const change = (licence: string, userId=9001) => ({ userId, licence, actorId:9000, source:'admin' });
const count = (db: DatabaseSync, table: string) => Number(db.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n);

test('migration creates empty grant/event stores and rejects non-licence grant values', () => {
  const f=fixture(); try {
    assert.equal(count(f.db,'account_licences'),0); assert.equal(count(f.db,'account_licence_events'),0);
    for (const licence of ['admin','exploring']) assert.throws(()=>f.db.prepare('INSERT INTO account_licences(user_id,licence,source) VALUES (9001,?,?)').run(licence,'synthetic'),/CHECK constraint/);
    f.db.prepare('INSERT INTO account_licences(user_id,licence,source) VALUES (9001,?,?)').run('investor','synthetic');
    assert.equal(count(f.db,'account_licences'),1);
  } finally { f.db.close(); }
});

test('grants union with primary in licence order; retries and revocations write exactly one event, never backfill primary', async () => {
  const f=fixture(); try {
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'founder'}),['founder']);
    assert.equal(await grantLicence(f.DB,change('founder')),'already_held'); assert.equal(count(f.db,'account_licences'),0);
    for (const licence of ['partner','advisor','investor']) assert.equal(await grantLicence(f.DB,change(licence)),'granted');
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'founder'}),['founder','investor','advisor','partner']);
    assert.equal(count(f.db,'account_licence_events'),3);
    assert.deepEqual(await Promise.all([grantLicence(f.DB,change('investor')),grantLicence(f.DB,change('investor'))]),['already_held','already_held']);
    assert.equal(count(f.db,'account_licence_events'),3);
    assert.equal(await revokeLicence(f.DB,change('advisor')),'revoked');
    assert.equal(await revokeLicence(f.DB,change('advisor')),'not_held');
    assert.equal(count(f.db,'account_licence_events'),4); assert.equal(count(f.db,'account_licences'),3);
    const revoked=f.db.prepare("SELECT granted_by,revoked_by,revoked_at FROM account_licences WHERE user_id=9001 AND licence='advisor'").get()!; assert.equal(revoked.granted_by,9000); assert.equal(revoked.revoked_by,9000); assert.ok(revoked.revoked_at);
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'founder'}),['founder','investor','partner']);
    assert.equal(await grantLicence(f.DB,change('advisor')),'granted');
    assert.equal(count(f.db,'account_licence_events'),5);
    const restored=f.db.prepare("SELECT revoked_at,revoked_by FROM account_licences WHERE user_id=9001 AND licence='advisor'").get()!; assert.equal(restored.revoked_at,null); assert.equal(restored.revoked_by,null);
    const audit=f.db.prepare('SELECT action,actor_id,source FROM account_licence_events ORDER BY id').all();
    assert.deepEqual(audit.map(r=>r.action),['grant','grant','grant','revoke','grant']);
    assert.ok(audit.every(r=>r.actor_id===9000&&r.source==='admin'));
    assert.equal(count(f.db,'investors'),1); assert.equal(count(f.db,'investor_profiles'),1); assert.equal(count(f.db,'advisors'),1);
    await ensureRoleProfile(f.env,{id:9001,email:'founder@example.test',name:'Synthetic founder',role:'investor'} as any);
    assert.equal(count(f.db,'investors'),1);
    assert.equal(f.db.prepare("SELECT required FROM legal_obligations WHERE user_id=9001 AND obligation_key='kyc_v1'").get()!.required,1);
  } finally { f.db.close(); }
});

test('request union grants investor access until revoked, never grants Admin, and hydrates once as the support subject', async () => {
  const f=fixture(); try {
    assert.equal((await f.call('/investor-only')).status,403);
    await grantLicence(f.DB,change('investor'));
    assert.equal((await f.call('/investor-only')).status,200);
    assert.equal((await f.call('/admin-only')).status,403);
    assert.equal((await f.call('/admin-only',9000)).status,200);
    const start=f.reads(); const twice=await f.call('/twice'); assert.deepEqual(twice.body,{a:['founder','investor'],b:['founder','investor']}); assert.equal(f.reads()-start,1);
    await grantLicence(f.DB,change('founder',9000)); await grantLicence(f.DB,change('partner',9002));
    assert.deepEqual((await f.call('/twice',9002,'GET',undefined,true)).body.a,['advisor','partner']);
    await revokeLicence(f.DB,change('investor')); assert.equal((await f.call('/investor-only')).status,403);
    assert.equal(holdsLicence({role:'admin',licences:['admin']},'investor'),false);
  } finally { f.db.close(); }
});

test('account/me contracts preserve primary, expose ordered held grants and contact-only addable licences', async () => {
  const f=fixture(); try {
    await grantLicence(f.DB,change('partner'));
    const r=await f.call('/api/account/licences'); assert.equal(r.status,200);
    assert.equal(r.body.primary,'founder'); assert.deepEqual(r.body.held.map((x:any)=>x.licence),['founder','partner']);
    assert.deepEqual(r.body.held[0],{licence:'founder',label:'Founder',granted_at:null,source:'primary',is_primary:true});
    assert.equal(r.body.held[1].label,'Operating Partner'); assert.equal(r.body.held[1].source,'admin'); assert.ok(r.body.held[1].granted_at);
    assert.deepEqual(r.body.addable,[{licence:'investor',label:'Investor',how:'contact'},{licence:'advisor',label:'Advisor',how:'contact'}]);
    const me=await f.call('/api/auth/me'); assert.equal(me.status,200); assert.equal(me.body.role,'founder'); assert.deepEqual(me.body.licences,['founder','partner']);
    assert.equal((await f.call('/api/admin/accounts/9001/licences',9000)).status,200);
    assert.equal((await f.call('/api/account/licences',null)).status,401);
  } finally { f.db.close(); }
});

test('admin route refusals carry fixed codes; failures never reveal exception text; idempotent writes do not append events', async () => {
  const f=fixture(); try {
    const path='/api/admin/accounts/9001/licences';
    assert.equal((await f.call(path,9001,'POST',{licence:'investor'})).status,403);
    for (const licence of ['admin','exploring','bogus',null]) { const r=await f.call(path,9000,'POST',{licence}); assert.equal(r.status,400); assert.equal(r.body.error,'invalid_licence'); }
    const absent=await f.call('/api/admin/accounts/9999/licences',9000); assert.equal(absent.status,404); assert.equal(absent.body.error,'not_found');
    const primary=await f.call(path+'/founder',9000,'DELETE'); assert.equal(primary.status,409); assert.equal(primary.body.error,'primary_licence');
    const added=await f.call(path,9000,'POST',{licence:'investor'}); assert.equal(added.status,200); assert.equal(added.body.code,'granted');
    assert.equal((await f.call(path,9000,'POST',{licence:'investor'})).body.code,'already_held');
    assert.equal((await f.call(path+'/investor',9000,'DELETE')).body.code,'revoked');
    assert.equal((await f.call(path+'/investor',9000,'DELETE')).body.code,'not_held'); assert.equal(count(f.db,'account_licence_events'),2);
    f.db.exec("CREATE TRIGGER synthetic_refusal BEFORE INSERT ON account_licences BEGIN SELECT RAISE(ABORT,'synthetic internal exception'); END;");
    const failed=await f.call(path,9000,'POST',{licence:'advisor'}); assert.equal(failed.status,503); assert.equal(failed.body.error,'licences_unreadable'); assert.ok(!JSON.stringify(failed.body).includes('synthetic internal exception'));
    assert.equal(count(f.db,'account_licence_events'),2);
  } finally { f.db.close(); }
});

test('real admin appointment atomically retains the old licence, binding and audits; a failed batch writes none', async () => {
  const path='/api/admin/licences/synthetic-territory/admins';
  const f=fixture(); try {
    const r=await f.call(path,9000,'POST',{email:'founder@example.test',reason:'Synthetic appointment reason'}); assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(f.db.prepare('SELECT role FROM users WHERE id=9001').get()!.role,'admin');
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'admin'}),['founder']);
    const event=f.db.prepare('SELECT licence,action,source,actor_id FROM account_licence_events').all();
    assert.deepEqual(event.map(r=>({...r})),[{licence:'founder',action:'grant',source:'admin_appointment',actor_id:9000}]);
    assert.equal(count(f.db,'licence_admins'),1); assert.equal(count(f.db,'licence_events'),1); assert.equal(count(f.db,'activity_logs'),2);
  } finally { f.db.close(); }
  const broken=fixture(); try {
    broken.db.exec("CREATE TRIGGER synthetic_abort BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'synthetic appointment failure'); END;");
    const r=await broken.call(path,9000,'POST',{email:'founder@example.test',reason:'Synthetic appointment reason'}); assert.equal(r.status,503); assert.equal(r.body.error,'admin_appointment_failed'); assert.ok(!JSON.stringify(r.body).includes('synthetic appointment failure'));
    assert.equal(broken.db.prepare('SELECT role FROM users WHERE id=9001').get()!.role,'founder');
    for (const table of ['account_licences','account_licence_events','licence_admins','licence_events','activity_logs']) assert.equal(count(broken.db,table),0,table);
  } finally { broken.db.close(); }
});

test('primary correction drops the old primary unless explicitly granted; retention is appointment-only', async () => {
  const f=fixture(); try {
    await assert.rejects(grantLicence(f.DB,{...change('founder'),retainPrimary:true}),(e:any)=>e.code==='invalid_retention');
    assert.equal(count(f.db,'account_licences'),0); assert.equal(count(f.db,'account_licence_events'),0);
    const r=await f.call('/api/admin/users/9001/role',9000,'PATCH',{role:'investor'}); assert.equal(r.status,200,JSON.stringify(r.body));
    const u=f.db.prepare('SELECT id,role FROM users WHERE id=9001').get()!;
    assert.deepEqual(await heldLicences(f.DB,u as any),['investor']); assert.equal(count(f.db,'account_licences'),0);
    await grantLicence(f.DB,change('founder')); assert.deepEqual(await heldLicences(f.DB,u as any),['founder','investor']);
  } finally { f.db.close(); }
});

test('an active grant matching the primary is de-duplicated, while revoked rows grant nothing', async () => {
  const f=fixture(); try {
    f.db.exec("INSERT INTO account_licences(user_id,licence,source,revoked_at) VALUES (9001,'founder','synthetic',NULL),(9001,'investor','synthetic','2000-01-01');");
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'founder'}),['founder']);
    assert.deepEqual(await heldLicences(f.DB,{id:9003,role:'exploring'}),[]);
    await grantLicence(f.DB,change('investor',9003));
    assert.deepEqual(await heldLicences(f.DB,{id:9003,role:'exploring'}),['investor']);
    assert.equal((await f.call('/investor-only',9003)).status,200);
  } finally { f.db.close(); }
});

test('every additional licence admits its own gate and revocation removes it without changing primary', async () => {
  const f=fixture(); try {
    for (const licence of ['founder','investor','advisor','partner']) {
      assert.equal((await f.call('/role/'+licence,9003)).status,403);
      await grantLicence(f.DB,change(licence,9003));
      assert.equal((await f.call('/role/'+licence,9003)).status,200,licence);
      await revokeLicence(f.DB,change(licence,9003));
      assert.equal((await f.call('/role/'+licence,9003)).status,403,licence);
    }
    assert.equal(f.db.prepare('SELECT role FROM users WHERE id=9003').get()!.role,'exploring');
    assert.equal(count(f.db,'account_licence_events'),8);
  } finally { f.db.close(); }
});

test('inline access helpers use held licences, preserve ownership, KYC and lead checks, and keep Admin separate', async () => {
  const f=fixture(); try {
    const user:any={id:9001,role:'investor',licences:['investor','founder','advisor','partner'],founder_id:41,is_active:1,kyc_status:'approved'};
    assert.equal(isFounder(user),true); assert.equal(isInvestor(user),true); assert.equal(isPartner(user),true);
    assert.equal(canAccessFounderResource(user,41),true); assert.equal(canAccessFounderResource(user,42),false);
    assert.equal(canViewLpData(user),true); assert.equal(canViewPartnerDemand(user),true);
    assert.equal(canHoldValidateSource(user),true); assert.equal(canWritePitchDeck({id:1,founder_id:41},user),true);
    assert.equal(await canAccessProject(f.env,user,{id:1,founder_id:41},{write:true}),true);
    assert.equal(isProjectManager(user,{founder_id:41}),true); assert.equal(isProjectManager(user,{founder_id:42}),false);
    assert.equal(verifiedInvestor(user),true); assert.equal(verifiedInvestor({...user,kyc_status:'pending'}),false);
    assert.equal(canMoveRound(user,9001),true); assert.equal(canMoveRound(user,9002),false);
    for (const licence of ['founder','investor','advisor','partner']) {
      const only:any={...user,licences:[licence],role:'exploring'};
      assert.equal(isFounder(only),licence==='founder'); assert.equal(isInvestor(only),licence==='investor'); assert.equal(isPartner(only),licence==='partner');
      assert.equal(canViewLpData(only),licence==='investor'); assert.equal(canViewPartnerDemand(only),licence==='partner');
      const label={founder:'Founder',investor:'Investor',advisor:'Advisor',partner:'Operating Partner'}[licence];
      assert.equal(modulePageAllowed(only,label+' · Example'),true);
    }
    assert.equal(isProjectManager({...user,licences:['investor']},{founder_id:41}),false);
    assert.equal(modulePageAllowed(user,'Investor · Deals'),true);
    assert.equal(modulePageAllowed(user,'Super Admin · Accounts'),false);
  } finally { f.db.close(); }
});

test('secondary investor diligence and fund reads stay scoped; revoked Advisor access stops with profile rows retained', async () => {
  const f=fixture(); try {
    f.db.exec("INSERT INTO projects(id,name,founder_id) VALUES (447201,'Visible synthetic startup',41),(447202,'Private synthetic startup',42);");
    assert.equal((await f.call('/api/dd/subjects?type=project')).status,403);
    await grantLicence(f.DB,change('investor'));
    const scope=await f.call('/api/dd/subjects?type=project'); assert.equal(scope.status,200,JSON.stringify(scope.body)); assert.deepEqual(scope.body.items,[]);
    f.db.exec("INSERT INTO deals(id,project_id) VALUES (447201,447201); INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (447201,9001);");
    const related=await f.call('/api/dd/subjects?type=project'); assert.equal(related.status,200); assert.deepEqual(related.body.items.map((row:any)=>row.id),[447201]);
    await revokeLicence(f.DB,change('investor')); assert.equal((await f.call('/api/dd/subjects?type=project')).status,403);
    await grantLicence(f.DB,change('investor'));
    assert.equal((await f.call('/api/fund-performance')).status,200);
    await grantLicence(f.DB,change('advisor'));
    const profile=await f.call('/api/advisors/me'); assert.equal(profile.status,200); assert.ok(profile.body);
    await revokeLicence(f.DB,change('advisor'));
    assert.equal((await f.call('/api/advisors/me')).body,null);
    assert.equal(count(f.db,'advisors'),1);
  } finally { f.db.close(); }
});

test('an additional investor grant opens pipeline fanout only while active; personal notifications are independent', async () => {
  const f=fixture(); try {
    const frames:string[]=[];
    const socket={deserializeAttachment:()=>({userId:'9001',role:'founder'}),send:(frame:string)=>frames.push(frame)};
    const room=new PipelineRoom({getWebSockets:()=>[socket]} as any,f.env);
    const publish=async (body:any)=>room.fetch(new Request('https://room/broadcast',{method:'POST',body:JSON.stringify(body)}));
    await publish({type:'stage_change'}); assert.equal(frames.length,0);
    await grantLicence(f.DB,change('investor')); await publish({type:'stage_change'}); assert.equal(frames.length,1);
    f.db.exec('UPDATE users SET is_active=0 WHERE id=9001'); await publish({type:'stage_change'}); assert.equal(frames.length,1); f.db.exec('UPDATE users SET is_active=1 WHERE id=9001');
    await revokeLicence(f.DB,change('investor')); await publish({type:'stage_change'}); assert.equal(frames.length,1);
    await publish({type:'notification',user_id:9001}); assert.equal(frames.length,2);
    await publish({type:'notification',user_id:9002}); assert.equal(frames.length,2);
  } finally { f.db.close(); }
});

test('concurrent fresh grants append once; legacy primary casing is recognized without rewriting the role', async () => {
  const f=fixture(); try {
    assert.deepEqual(await Promise.all([grantLicence(f.DB,change('investor')),grantLicence(f.DB,change('investor'))]),['granted','already_held']);
    assert.equal(count(f.db,'account_licence_events'),1); assert.equal(count(f.db,'account_licences'),1);
    // Reproduce a legacy row without weakening the production schema or grant CHECK.
    f.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE users SET role='FOUNDER' WHERE id=9001; PRAGMA ignore_check_constraints=OFF;");
    assert.equal(await grantLicence(f.DB,change('founder')),'already_held');
    const me=await f.call('/api/auth/me'); assert.equal(me.body.role,'FOUNDER'); assert.deepEqual(me.body.licences,['founder','investor']);
    const own=await f.call('/api/account/licences'); assert.deepEqual(own.body.held.map((row:any)=>row.licence),['founder','investor']); assert.equal(own.body.held[0].is_primary,true);
    const revoked=await f.call('/api/admin/accounts/9001/licences/founder',9000,'DELETE'); assert.equal(revoked.status,409); assert.equal(revoked.body.error,'primary_licence');
  } finally { f.db.close(); }
});

test('retained Investor licences never take away scalar Admin permissions', async () => {
  const f=fixture(); try {
    const admin:any={id:9000,role:'admin',licences:['investor'],founder_id:null};
    assert.equal(holdsOnlyLicence(admin,'investor'),false);
    assert.equal(await canReadOperatorReview(f.env,admin,{id:1,name:'Synthetic project',founder_id:41}),true);
    assert.equal(canViewLpData(admin),true); assert.equal(canViewPartnerDemand(admin),true);
  } finally { f.db.close(); }
});

test('adding Investor preserves accepted co-founder edits, roster reads and Spin-Out override access', async () => {
  const f=fixture(); try {
    f.db.exec("INSERT INTO founders(id,name,email) VALUES (447901,'Synthetic owner','owner@example.test'); INSERT INTO users(id,email,name,role,founder_id) VALUES (9010,'owner@example.test','Synthetic owner','founder',447901); INSERT INTO projects(id,name,founder_id) VALUES (447301,'Synthetic shared venture',447901); INSERT INTO project_members(project_id,user_id,role,status) VALUES (447301,9001,'cofounder','accepted'),(447301,9005,'cofounder','accepted'); UPDATE users SET subscription_tier='studio',subscription_status='active',kyc_status='approved' WHERE id=9001;");
    const paths=['/api/projects/447301/members','/api/projects/447301/spinout-deck/overrides','/api/projects/447301/market-assumptions'];
    assert.equal((await f.call('/api/projects/447301',9001,'PUT',{description:'Before investor licence'})).status,200);
    for (const path of paths) assert.equal((await f.call(path)).status,200,path);
    await grantLicence(f.DB,change('investor'));
    assert.equal((await f.call('/api/projects/447301',9001,'PUT',{description:'After investor licence'})).status,200);
    for (const path of paths) assert.equal((await f.call(path)).status,200,path);
    assert.equal(f.db.prepare('SELECT description FROM projects WHERE id=447301').get()!.description,'After investor licence');
    assert.equal((await f.call('/api/projects/447301',9005,'PUT',{description:'Not allowed'})).status,403);
    assert.equal((await f.call(paths[0],9005)).status,403);
    assert.equal((await f.call('/api/projects/447301',9002,'PUT',{description:'No membership'})).status,403);
  } finally { f.db.close(); }
});

test('a residual founder ID after primary correction grants no ownership without an explicit Founder licence', async () => {
  const f=fixture(); try {
    await ensureRoleProfile(f.env,f.db.prepare('SELECT * FROM users WHERE id=9001').get() as any);
    f.db.exec("UPDATE users SET subscription_tier='studio',subscription_status='active' WHERE id=9001");
    const founderId=f.db.prepare('SELECT founder_id FROM users WHERE id=9001').get()!.founder_id;
    f.db.prepare('INSERT INTO projects(id,name,founder_id) VALUES (447302,?,?)').run('Synthetic own venture',founderId);
    assert.equal((await f.call('/api/projects/447302',9001,'PUT',{description:'Primary Founder'})).status,200);
    assert.equal((await f.call('/api/projects/447302/market-assumptions')).status,200);
    assert.equal((await f.call('/api/projects/447302/spinout-deck/overrides')).status,200);
    assert.equal((await f.call('/api/admin/users/9001/role',9000,'PATCH',{role:'partner'})).status,200);
    assert.equal((await f.call('/api/projects/447302',9001,'PUT',{description:'Old ID alone'})).status,403);
    assert.equal((await f.call('/api/projects/447302/market-assumptions')).status,403);
    assert.equal((await f.call('/api/projects/447302/spinout-deck/overrides')).status,403);
    await grantLicence(f.DB,change('founder'));
    assert.equal((await f.call('/api/projects/447302',9001,'PUT',{description:'Explicit Founder grant'})).status,200);
    assert.equal((await f.call('/api/projects/447302/market-assumptions')).status,200);
    assert.equal((await f.call('/api/projects/447302/spinout-deck/overrides')).status,200);
  } finally { f.db.close(); }
});

test('ordinary Admins manage members and their own licence reads; another Admin remains Super Admin only', async () => {
  const f=fixture(); try {
    f.db.exec("INSERT INTO users(id,email,name,role) VALUES (9006,'other-admin@example.test','Synthetic administrator','admin'); INSERT INTO user_sessions(user_id,jti,factor,assurance_level,last_step_up_at) VALUES (9006,'synthetic-9006','totp','totp',datetime('now'));");
    const other='/api/admin/accounts/9000/licences';
    for (const [method,path,body] of [['GET',other,undefined],['POST',other,{licence:'advisor'}],['DELETE',other+'/founder',undefined]] as const) {
      const r=await f.call(path,9006,method,body); assert.equal(r.status,403); assert.equal(r.body.error,'forbidden');
    }
    assert.equal(count(f.db,'account_licence_events'),0);
    assert.equal((await f.call('/api/admin/accounts/9006/licences',9006)).status,200);
    assert.equal((await f.call('/api/admin/accounts/9001/licences',9006,'POST',{licence:'investor'})).status,200);
    assert.equal(f.db.prepare('SELECT actor_id FROM account_licence_events').get()!.actor_id,9006);
    assert.equal((await f.call('/api/admin/accounts/9006/licences',9000,'POST',{licence:'founder'})).status,200);
    assert.equal((await f.call('/api/admin/accounts/9006/licences',9000)).status,200);
    const own=await f.call('/api/admin/accounts/9006/licences',9006); assert.deepEqual(own.body.held.map((row:any)=>row.licence),['founder']);
    assert.equal((await f.call('/api/admin/accounts/9006/licences/founder',9000,'DELETE')).status,200);
  } finally { f.db.close(); }
});

test('a primary correction racing an appointment cannot commit a territory binding or partial audit', async () => {
  const f=fixture(); try {
    const prepare=f.DB.prepare.bind(f.DB), batch=f.DB.batch.bind(f.DB); let corrected=false;
    f.DB.prepare=(sql:string)=>Object.assign(prepare(sql),{syntheticSql:sql});
    f.DB.batch=async (statements:any[])=>{
      if (!corrected && statements.some(statement=>/INSERT\s+INTO\s+account_licences\b/i.test(statement.syntheticSql || ''))) {
        corrected=true; f.db.exec("UPDATE users SET role='investor' WHERE id=9001");
      }
      return batch(statements);
    };
    const r=await f.call('/api/admin/licences/synthetic-territory/admins',9000,'POST',{email:'founder@example.test',reason:'Synthetic concurrent appointment'});
    assert.equal(corrected,true); assert.notEqual(r.status,200);
    assert.equal(f.db.prepare('SELECT role FROM users WHERE id=9001').get()!.role,'investor');
    for (const table of ['account_licences','account_licence_events','licence_admins','licence_events','activity_logs']) assert.equal(count(f.db,table),0,table);
  } finally { f.db.close(); }
});

test('appointment reuses an active grant matching the corrected primary without duplicating its event', async () => {
  const f=fixture(); try {
    f.db.exec("UPDATE users SET role='partner' WHERE id=9001");
    await grantLicence(f.DB,change('founder'));
    f.db.exec("UPDATE users SET role='founder' WHERE id=9001");
    const r=await f.call('/api/admin/licences/synthetic-territory/admins',9000,'POST',{email:'founder@example.test',reason:'Synthetic existing grant appointment'});
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(f.db.prepare('SELECT role FROM users WHERE id=9001').get()!.role,'admin');
    assert.equal(count(f.db,'account_licences'),1); assert.equal(count(f.db,'account_licence_events'),1);
    assert.equal(f.db.prepare('SELECT source FROM account_licence_events').get()!.source,'admin');
    assert.equal(count(f.db,'licence_admins'),1); assert.equal(count(f.db,'licence_events'),1); assert.equal(count(f.db,'activity_logs'),2);
    assert.deepEqual(await heldLicences(f.DB,{id:9001,role:'admin'}),['founder']);
  } finally { f.db.close(); }
});
