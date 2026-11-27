/** D592: real SQLite routes, snapshots and nightly flips; only synthetic users. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { offBaseline, personaProfiles, comparison } from '../scripts/profile-evidence-blend-comparison.mjs';
import { blendedSkillLevel, evidenceLevel, evidenceBlendEnabled, profileEngineVersion, PROFILE_EVIDENCE_BLEND_KEY } from '../src/services/profileEvidenceBlend.ts';
import { PROFILE_EVIDENCE_BLEND_WEIGHT, ENGINE_VERSION, scoringItemsFor } from '../src/services/archetypeScoring.ts';
import { axisState, evidenceReport } from '../src/services/skillEvidence.ts';
import { recomputeProfile, isMaterialChange, buildProfile } from '../src/services/profileHistory.ts';
import { evaluateUser, runProfileEvolutionTick, dueReason, profilingTrends } from '../src/services/profileEvolution.ts';
import profileRoutes from '../src/routes/profile_history.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const FIXTURE = JSON.parse(read('cloudflare-worker/test/fixtures/profiling-v2-personas.json'));
const SECRET = 'unit-blend-secret-01234567890123456789';
const NOW = new Date('2026-10-06T12:00:00Z');
const EARLIER = [
  'cloudflare-worker/sql/migrations/048_advisor_state.sql',
  'cloudflare-worker/sql/migrations/238_advisor_engagements.sql',
  'cloudflare-worker/sql/migrations/339_dd_section_signoff.sql',
  'cloudflare-worker/sql/migrations/360_partner_booking_action_items.sql',
  'cloudflare-worker/sql/migrations/361_partner_booking_ratings.sql',
  'cloudflare-worker/sql/migrations/362_skill_evidence.sql',
  'cloudflare-worker/sql/migrations/363_profile_snapshots.sql',
].map(read);
const TABLES = [
  'users', 'super_admins', 'advisor_answers', 'activity_logs', 'notifications_inbox',
  'projects', 'skills', 'user_skills', 'pitch_decks', 'brand_sites', 'discovery_interviews',
  'roadmap_okrs', 'financial_models', 'esign_envelopes', 'esign_recipients', 'cap_table_securities',
  'spinout_lab_milestones', 'dd_sections', 'deal_stage_events', 'commitments', 'partners',
  'partner_bookings', 'perks', 'perk_claims', 'advisors', 'engagements', 'engagement_milestones',
  'experts', 'expert_bookings', 'expert_ratings', 'cohort_guidance',
];
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, table)));
  for (const migration of EARLIER) db.exec(migration);
  db.exec(read('cloudflare-worker/sql/migrations/364_profile_evolution.sql'));
  // D592 adds no schema: use migration 241's exact setting table definition.
  db.exec(tableFromBaseline(read('cloudflare-worker/sql/migrations/241_advisor_money_model.sql'), 'platform_settings'));
  db.exec("INSERT INTO users(id,email,name,role) VALUES (1,'one@example.test','One','founder'),(2,'two@example.test','Two','investor'),(9,'owner@example.test','Owner','admin'),(10,'admin@example.test','Admin','admin')");
  db.exec('INSERT INTO super_admins(user_id) VALUES(9)');
  const queries: string[] = [];
  const real = d1Over(db);
  const DB = { ...real, prepare(query: string) { queries.push(query); return real.prepare(query); } };
  return { db, queries, env: { DB, JWT_SECRET: SECRET } as any };
}
const app = new Hono().route('/api/profile', profileRoutes);
app.onError((error, c) => c.json({ detail: error.message }, (AUTH_ERROR_STATUSES[error.message] ?? 500) as any));
async function call(f: ReturnType<typeof fixture>, method: string, body?: unknown, who: number | null = 9, extraEnv = {}) {
  const token = who === null ? '' : await new SignJWT({ user_id: who, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request('/api/profile/evidence-blend', {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { ...f.env, ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}
function answers(f: ReturnType<typeof fixture>, who: number, key: string) {
  const p = FIXTURE.personas.find((row: any) => row.key === key);
  const insert = f.db.prepare("INSERT INTO advisor_answers(conversation_id,user_id,question_id,raw_value,saved_status,answered_at) VALUES(?,?,?,?,'saved',?)");
  for (const row of p.answers) insert.run(70 + who, who, row.question_id, String(row.value), row.answered_at);
}
const rows = (f: ReturnType<typeof fixture>, sql: string) => f.db.prepare(sql).all().map(row => ({ ...row }));

test('D592: off preserves pre-change bytes for 48 profiles and 49 axis outputs', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(offBaseline())).digest('hex'), '452207cecd15a640c1f24dae3ac4aad05053c4360511dd9d4d1ebff98f3cb931');
  assert.deepEqual([profileEngineVersion(false), PROFILE_EVIDENCE_BLEND_WEIGHT], [ENGINE_VERSION, 0.25]);
  const p=FIXTURE.personas.find((row: any)=>row.key==='partner_radar_grows');
  assert.deepEqual(buildProfile(p.role,scoringItemsFor(p.role),p.answers,'2026-10-06',{finance_ops:3}),buildProfile(p.role,scoringItemsFor(p.role),p.answers,'2026-10-06',{finance_ops:3},false));
});

test('D592: formula saturates, is bounded in both directions, keeps all states and never creates self', () => {
  assert.deepEqual([0,0.6,1.8,3,30,-1,NaN,Infinity].map(evidenceLevel), [0,1,3,5,5,0,0,0]);
  assert.deepEqual([blendedSkillLevel(3,3),blendedSkillLevel(5,0.1),axisState(3,3)], [3,5,{state:'corroborated',level:3}]);
  assert.deepEqual([[5,0.1],[0,3],[3,1.8],[4,3],[null,3],[4,0],[4,NaN]].map(([self,weight]) => blendedSkillLevel(self,weight!,true)), [4.75,0.25,3,4.25,null,4,4]);
  for (const self of [null,0,1,2,3,4,5]) for (const weight of [0,0.1,1,2.99,3,5,10]) {
    const off = axisState(self,weight,false); const on = axisState(self,weight,true);
    assert.equal(on.state, off.state);
    if (self === null) assert.equal(on.level, null);
    else assert.ok(on.level! >= 0 && on.level! <= 5 && Math.abs(on.level! - self) <= 0.25);
  }
});

test('D592: only an elevated HQ admin flips a bound, audited setting; missing and explicit off are identical', async () => {
  const f=fixture();
  const initial=await call(f,'GET');
  assert.deepEqual(initial, { status:200,body:{enabled:false,weight:0.25,engine_version:ENGINE_VERSION} });
  const refused=[];
  for(const who of [null,1,2,10]) refused.push((await call(f,'PUT',{enabled:true},who)).status);
  refused.push((await call(f,'PUT',{enabled:true},9,{BRANCH_CODE:'test-branch'})).status);
  for(const body of [{},{enabled:1},{enabled:'true'},{enabled:null},{enabled:"1'; DELETE FROM users;--"}]) refused.push((await call(f,'PUT',body)).status);
  assert.deepEqual(refused,[401,403,403,403,403,400,400,400,400,400]);
  const reads=[];for(const who of [null,1,2,10])reads.push((await call(f,'GET',undefined,who)).status);
  assert.deepEqual(reads,[401,403,403,403]);
  assert.deepEqual(rows(f,'SELECT * FROM platform_settings'), []);
  assert.deepEqual(rows(f,'SELECT action FROM activity_logs'), []);
  const on=await call(f,'PUT',{enabled:true});
  const off=await call(f,'PUT',{enabled:false});
  assert.deepEqual([on.status,on.body.enabled,on.body.engine_version,off], [200,true,profileEngineVersion(true),initial]);
  assert.deepEqual(rows(f,'SELECT key,value,updated_by FROM platform_settings'), [{key:PROFILE_EVIDENCE_BLEND_KEY,value:'0',updated_by:'9'}]);
  assert.deepEqual(rows(f,'SELECT action,user_id FROM activity_logs'), Array.from({length:2},()=>({action:'profile_evidence_blend_changed',user_id:9})));
  assert.deepEqual(rows(f,'SELECT filters_json FROM admin_audit_log').map(row=>JSON.parse(row.filters_json as string)), [
    {setting_key:PROFILE_EVIDENCE_BLEND_KEY,before:false,enabled:true,engine_version:profileEngineVersion(true)},
    {setting_key:PROFILE_EVIDENCE_BLEND_KEY,before:true,enabled:false,engine_version:ENGINE_VERSION},
  ]);
  assert.equal(f.queries.some(query=>query.includes('DELETE FROM users')),false);
});

test('D592: unreadable or malformed settings never write off snapshots; pre-241 remains off', async () => {
  const f=fixture(); answers(f,1,'missionary');
  f.db.prepare('INSERT INTO platform_settings(key,value) VALUES(?,?)').run(PROFILE_EVIDENCE_BLEND_KEY,'unknown');
  assert.equal((await call(f,'GET')).status,503);
  await assert.rejects(()=>recomputeProfile(f.env,1,{trigger:'scheduled',asOf:NOW.toISOString()}), /Invalid profile evidence blend setting/);
  assert.deepEqual(rows(f,'SELECT id FROM profile_snapshots'), []);
  f.db.exec('DROP TABLE platform_settings');
  assert.equal(await evidenceBlendEnabled(f.env),false);
  const broken={DB:{prepare(){throw Error('synthetic read failure');}}} as any;
  await assert.rejects(()=>evidenceBlendEnabled(broken), /synthetic read failure/);
});

test('D592: actual evidence report follows the switch with owner-only events and null evidence-only levels', async () => {
  const f=fixture();
  f.db.exec("INSERT INTO skills(id,slug,label,category_slug) VALUES(101,'marketing','Marketing','marketing_brand'); INSERT INTO user_skills(user_id,skill_id,self_level) VALUES(1,101,4)");
  f.db.exec("INSERT INTO pitch_decks(id,project_id,title,slides,created_by,created_at) VALUES(101,1,'Synthetic','[]',1,'2026-10-01'),(102,1,'Other','[]',2,'2026-10-01')");
  const off=await evidenceReport(f.env,1,NOW);
  await call(f,'PUT',{enabled:false});
  assert.equal(JSON.stringify(await evidenceReport(f.env,1,NOW)),JSON.stringify(off));
  await call(f,'PUT',{enabled:true});
  const on=await evidenceReport(f.env,1,NOW);
  const marketing=on.axes.find(axis=>axis.axis==='marketing_brand')!;
  const capital=on.axes.find(axis=>axis.axis==='capital_network')!;
  assert.deepEqual([on.engine_version,marketing.state,marketing.self_level,marketing.level,marketing.evidence_weight,capital.state,capital.level], [3,'some_evidence',4,3.75,1,'evidence_only',null]);
  assert.deepEqual(on.axes.map(axis=>axis.state),off.axes.map(axis=>axis.state));
});

test('D592: real recomputes append switch-stamped snapshots, and material blended drift is retained only on', async () => {
  const f=fixture(); answers(f,1,'partner_radar_grows');
  const opts={trigger:'evidence' as const,asOf:NOW.toISOString(),evidence:()=>({finance_ops:0.1,marketing_brand:3})};
  const first=await recomputeProfile(f.env,1,opts);
  await call(f,'PUT',{enabled:false});
  const off=await recomputeProfile(f.env,1,opts);
  assert.deepEqual([off[0].written,JSON.stringify(off[0].profile)], [false,JSON.stringify(first[0].profile)]);
  await call(f,'PUT',{enabled:true});
  const on=await recomputeProfile(f.env,1,opts);
  const changed=await recomputeProfile(f.env,1,{...opts,evidence:()=>({finance_ops:2.9,marketing_brand:3})});
  assert.deepEqual([on[0].written,on[0].profile.engine_version,on[0].profile.skills.finance_ops.blended,on[0].profile.skills.marketing_brand.blended,changed[0].written,changed[0].profile.skills.finance_ops.blended], [true,profileEngineVersion(true),3.75,null,true,4.208333333333333]);
  const previous={...first[0].profile,skills:{...first[0].profile.skills,finance_ops:{...first[0].profile.skills.finance_ops,blended:0}}};
  assert.equal(isMaterialChange(previous as any,first[0].profile),false);
  await call(f,'PUT',{enabled:false});
  const reset=await recomputeProfile(f.env,1,opts);
  assert.deepEqual([reset[0].written,JSON.stringify(reset[0].profile),rows(f,'SELECT engine_version FROM profile_snapshots').map(row=>row.engine_version)], [true,JSON.stringify(first[0].profile),[ENGINE_VERSION,profileEngineVersion(true),profileEngineVersion(true),ENGINE_VERSION]]);
});

test('D592: nightly engine_bump backfills both flips across bounded resumable batches', async () => {
  const f=fixture(); answers(f,1,'missionary');answers(f,2,'thesis_backer');
  await evaluateUser(f.env,1,'answer',NOW);await evaluateUser(f.env,2,'answer',NOW);
  await call(f,'PUT',{enabled:true});
  const results=[];
  for(const minute of [1,3,5,7]) results.push(await runProfileEvolutionTick(f.env,new Date(`2026-10-07T03:0${minute}:00Z`),{profileBatch:1}));
  assert.deepEqual(results.map(row=>[row.stage,row.processed,row.evaluated,row.pass_complete]), [['profiles',1,1,false],['profiles',1,1,false],['profiles',0,0,true],['evidence',4,0,true]]);
  assert.deepEqual(await runProfileEvolutionTick(f.env,new Date('2026-10-07T03:09:00Z')), {stage:'idle',processed:0,evaluated:0,failed:0,events:0,pass_complete:false});
  assert.deepEqual(rows(f,'SELECT engine_version,last_trigger FROM profile_evolution_state ORDER BY user_id'), Array.from({length:2},()=>({engine_version:profileEngineVersion(true),last_trigger:'engine_bump'})));
  await call(f,'PUT',{enabled:false});
  await runProfileEvolutionTick(f.env,new Date('2026-10-08T03:01:00Z'),{profileBatch:20});
  assert.deepEqual(rows(f,'SELECT user_id,engine_version,trigger_kind FROM profile_snapshots ORDER BY id').map(row=>[row.user_id,row.engine_version,row.trigger_kind]), [[1,ENGINE_VERSION,'answer'],[2,ENGINE_VERSION,'answer'],[1,profileEngineVersion(true),'engine_bump'],[2,profileEngineVersion(true),'engine_bump'],[1,ENGINE_VERSION,'engine_bump'],[2,ENGINE_VERSION,'engine_bump']]);
  assert.deepEqual([dueReason({state:{last_evaluated_at:NOW.toISOString(),engine_version:ENGINE_VERSION},evidenceComputedAt:null,pendingHysteresis:false,nowMs:NOW.getTime(),engineVersion:profileEngineVersion(true)}),dueReason({state:{last_evaluated_at:NOW.toISOString(),engine_version:profileEngineVersion(true)},evidenceComputedAt:null,pendingHysteresis:false,nowMs:NOW.getTime(),engineVersion:ENGINE_VERSION})],['engine_bump','engine_bump']);
});

test('D592: personas keep displayed archetypes and trends states while levels obey the bound', async () => {
  const report=comparison();
  assert.deepEqual([report.rows.length,report.rows.filter(row=>row.before!==row.after).length,report.rows.filter(row=>row.changes.length).length], [48,0,11]);
  assert.deepEqual(report.trends,{basis:'23 synthetic fixture personas, primary role only, as of 2026-10-06; no production aggregates',before:{not_recorded:41,self_rated_only:139,some_evidence:1,corroborated:2,evidence_only:1},after:{not_recorded:41,self_rated_only:139,some_evidence:1,corroborated:2,evidence_only:1}});
  const before=personaProfiles(false),after=personaProfiles(true);
  for(let i=0;i<before.length;i++)for(const axis of Object.keys(before[i].profile.skills)){
    const a=before[i].profile.skills[axis];const b=after[i].profile.skills[axis];
    assert.equal(a.state,b.state);
    if(a.self===null)assert.equal(b.blended,null);
    else assert.ok(Math.abs(b.blended! - a.self)<=0.25);
  }
  const f=fixture();answers(f,1,'missionary');await evaluateUser(f.env,1,'answer',NOW);
  const off=await profilingTrends(f.env,{now:NOW});
  await call(f,'PUT',{enabled:false});
  assert.equal(JSON.stringify(await profilingTrends(f.env,{now:NOW})),JSON.stringify(off));
  await call(f,'PUT',{enabled:true});
  assert.equal((await profilingTrends(f.env,{now:NOW})).engine_version,profileEngineVersion(true));
});

test('D592: a flip during snapshot persistence never stamps the new setting on an old computation', async () => {
  const f=fixture();answers(f,1,'missionary');await call(f,'PUT',{enabled:true});
  const real=f.env.DB;
  const env={...f.env,DB:{...real,prepare(query: string){
    const statement=real.prepare(query);
    if(!query.includes('INSERT INTO profile_snapshots'))return statement;
    return {...statement,bind(...values: any[]){const bound=statement.bind(...values);return {...bound,async run(){
      const result=await bound.run();
      f.db.prepare('UPDATE platform_settings SET value=? WHERE key=?').run('0',PROFILE_EVIDENCE_BLEND_KEY);
      return result;
    }};}};
  }}};
  const result=await evaluateUser(env,1,'answer',NOW);
  assert.deepEqual([result.results[0].profile.engine_version,rows(f,'SELECT engine_version FROM profile_evolution_state'),await evidenceBlendEnabled(f.env)], [profileEngineVersion(true),[{engine_version:profileEngineVersion(true)}],false]);
  assert.equal(dueReason({state:{last_evaluated_at:NOW.toISOString(),engine_version:profileEngineVersion(true)},evidenceComputedAt:null,pendingHysteresis:false,nowMs:NOW.getTime(),engineVersion:ENGINE_VERSION}), 'engine_bump');
});
