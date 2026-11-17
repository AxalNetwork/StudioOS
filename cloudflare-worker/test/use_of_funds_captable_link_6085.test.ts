/**
 * D6085 (#6085) — a Use of funds scenario names the cap-table scenario it
 * assumes: pick, change and clear it with the scenario's revision; a link to
 * a deleted scenario reads `deleted`, never an error; a link never crosses
 * ventures; the raise is compared and never changed; Founders after the
 * round is Modelled; the cap table's scenario read names the plans using it.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/use_of_funds_captable_link_6085.test.ts
 */
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {SignJWT} from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import captable from '../src/routes/captable.ts';
import {simulate} from '../src/services/captable.ts';
import {foundersAfter} from '../src/services/useOfFunds/capTableLink.ts';
import {d1Over} from './_d1_sqlite.mjs';
import {tableFromBaseline} from './_baseline.mjs';
import {SECTION_KEYS} from '../src/services/useOfFunds/plan.ts';

const secret='synthetic-d6085-test-jwt-not-a-credential';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const mig=(n:string)=>readFileSync(new URL(`../sql/migrations/${n}`,import.meta.url),'utf8');
const migrations=['442_raise_cycle_stores.sql','463_raise_record_stores.sql','436_round_calls.sql','520_mercury_raise_feeds.sql','249_project_metrics.sql',
  '606_use_of_funds_scenarios.sql','202611082130_uof_scenario_revision.sql','202611101555_5375_uof_hire_revision.sql','607_raise_money_cents.sql',
  '202611152337_6085_uof_captable_link.sql'];
const roles=['founder','founder','admin'];
let dbs:DatabaseSync[]=[];
afterEach(()=>{for(const db of dbs)db.close();dbs=[];});
const app=new Hono();app.route('/api/cycles/raise',cycleRaise as any);

const SEED={founders:[{name:'Founder A',shares:4_000_000},{name:'Founder B',shares:4_000_000}],option_pool_pct:10,rounds:[{name:'Seed',pre_money:8_000_000,investment:1_500_000}]};
const BIG={...SEED,rounds:[{name:'Seed',pre_money:10_000_000,investment:2_000_000}]};
function fixture(){
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});dbs.push(db);
  for(const name of ['founders','users','projects','activity_logs','user_company_links','company_profiles','super_admins','mi_pro_subscriptions',
    'roadmap_okrs','integrations','cap_table_scenarios','financial_models','raise_rounds','raise_prospects','raise_pro_rata','raise_closes',
    'spinout_deck_overrides','pitch_decks','pitch_deck_share_tokens','data_room_files'])db.exec(tableFromBaseline(baseline,name));
  for(const m of migrations)db.exec(mig(m));
  db.exec(mig('597_company_archive_and_events.sql'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test'); INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',11,10),(2,'Other venture',22,20);");
  roles.forEach((role,i)=>db.prepare('INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(?,?,?,?,?,1)').run(i+1,role,`Synthetic ${i+1}`,`member-${i+1}@example.test`,i===1?22:11));
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('link-one',1,10)");
  const cap=(uid:string,project:number,name:string,inputs:any,variant=1,updated='2026-11-12 10:00:00')=>db.prepare(
    'INSERT INTO cap_table_scenarios(uid,owner_user_id,project_id,name,inputs_json,result_json,updated_at,is_variant) VALUES(?,?,?,?,?,?,?,?)')
    .run(uid,1,project,name,JSON.stringify(inputs),JSON.stringify(simulate(inputs)),updated,variant);
  cap('sc-model',1,'Cap table model',SEED,0,'2026-11-14 10:00:00');
  cap('sc-a',1,'Seed · Scenario A',BIG,1,'2026-11-10 10:00:00');
  cap('sc-b',1,'Seed · Scenario B',SEED,1,'2026-11-12 10:00:00');
  cap('sc-other',2,'Other venture scenario',SEED,0);
  return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
async function call(f:any,method:string,path:string,b?:unknown,who=1){
  const token=await new SignJWT({user_id:who,role:roles[who-1]}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res=await app.request(`/api/cycles/raise/use-of-funds${path}${path.includes('?')?'&':'?'}project=1`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)},f.env);
  return {status:res.status,body:await res.json() as any};
}
const lines=SECTION_KEYS.map((key,i)=>({key,share_pct:i===0?100:0}));
async function plan(f:any){
  const r=await call(f,'POST','/scenarios',{name:'Base plan',amount_to_raise_cents:150_000_000,target_runway_months:18,start_month:'2027-01',raise_month:'2027-01',cash_cents:0,lines});
  assert.equal(r.status,201,JSON.stringify(r.body));
  return r.body;
}
const link=(f:any,s:any,uid:string|null)=>call(f,'PUT',`/scenarios/${s.id}/cap-table`,{cap_table_scenario_uid:uid,expected_revision:s.revision});
const audits=(f:any)=>(f.db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'uof_captable%' ORDER BY id").all() as any[]).map(r=>r.action);

test('D6085 a scenario reads Not linked until a link is stored, and the plan shows the latest model unlinked',async()=>{
  const f=fixture();const s=await plan(f);
  assert.equal(s.cap_table_link.state,'not_linked');
  const p=await call(f,'GET','/plan');
  assert.equal(p.body.ties.cap_table.value.uid,'sc-model');
  assert.equal(p.body.ties.cap_table.value.link_state,'not_recorded');
});

test('D6085 the picker lists this venture’s scenarios only, compares each raise and names the matching one',async()=>{
  const f=fixture();const s=await plan(f);
  const r=await call(f,'GET',`/cap-table-scenarios?scenario_id=${s.id}`);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i:any)=>i.uid),['sc-model','sc-b','sc-a']);
  assert.ok(!r.body.items.some((i:any)=>i.uid==='sc-other'),'another venture’s scenario is never offered');
  const a=r.body.items.find((i:any)=>i.uid==='sc-a');
  assert.deepEqual(a.raise,{plan_cents:150_000_000,scenario_cents:200_000_000,differs:true});
  assert.equal(r.body.items.find((i:any)=>i.uid==='sc-b').raise.differs,false);
  assert.equal(r.body.matching_uid,'sc-model');
  assert.equal(r.body.source,'Modelled');
});

test('D6085 pick, change and clear: each is one audited write; linking changes neither figure',async()=>{
  const f=fixture();const s=await plan(f);
  const before=JSON.stringify(f.db.prepare("SELECT inputs_json,result_json FROM cap_table_scenarios ORDER BY id").all());
  const picked=await link(f,s,'sc-b');
  assert.equal(picked.status,200,JSON.stringify(picked.body));
  assert.equal(picked.body.cap_table_link.state,'linked');
  assert.equal(picked.body.cap_table_link.scenario.name,'Seed · Scenario B');
  assert.equal(picked.body.cap_table_link.raise.differs,false);
  assert.equal(picked.body.revision,s.revision+1);
  const changed=await link(f,picked.body,'sc-a');
  assert.equal(changed.status,200);
  assert.deepEqual(changed.body.cap_table_link.raise,{plan_cents:150_000_000,scenario_cents:200_000_000,differs:true});
  assert.equal(changed.body.amount_to_raise_cents,150_000_000,'a raise that differs is shown, not fixed');
  const cleared=await link(f,changed.body,null);
  assert.equal(cleared.status,200);
  assert.equal(cleared.body.cap_table_link.state,'not_linked');
  assert.deepEqual(audits(f),['uof_captable_linked','uof_captable_changed','uof_captable_unlinked']);
  assert.equal(JSON.stringify(f.db.prepare("SELECT inputs_json,result_json FROM cap_table_scenarios ORDER BY id").all()),before);
});

test('D6085 Founders after the round is Modelled from the linked scenario: before, after and the change in points',async()=>{
  const f=fixture();const s=await plan(f);
  const r=await link(f,s,'sc-b');
  const fo=r.body.cap_table_link.founders;
  assert.equal(fo.state,'ok');assert.equal(fo.source,'Modelled');assert.equal(fo.round,'Seed');
  assert.deepEqual(fo.rows.map((x:any)=>x.founder),['Founder A','Founder B']);
  for(const x of fo.rows){assert.ok(x.after_pct<x.before_pct);assert.equal(x.change_pts,Math.round((x.after_pct-x.before_pct)*10)/10);}
  assert.ok(fo.together.change_pts<0);
  const none=foundersAfter({founder_dilution:[]});
  assert.equal(none.state,'not_recorded');assert.match(none.reason,/Not 0%/);
});

test('D6085 the plan reads the linked scenario, not the latest model',async()=>{
  const f=fixture();await plan(f);
  const p0=await call(f,'GET','/plan');const baseId=p0.body.base.value.id;
  const base=p0.body.base.value;
  assert.equal((await call(f,'PUT',`/scenarios/${baseId}/cap-table`,{cap_table_scenario_uid:'sc-a',expected_revision:base.revision})).status,200);
  const p=await call(f,'GET','/plan');
  assert.equal(p.body.ties.cap_table.value.uid,'sc-a');
  assert.equal(p.body.ties.cap_table.value.link_state,'linked');
  assert.equal(p.body.base.value.cap_table_link.state,'linked');
});

test('D6085 a deleted cap-table scenario reads Link broken, never an error',async()=>{
  const f=fixture();const s=await plan(f);
  await link(f,s,'sc-b');
  f.db.exec("DELETE FROM cap_table_scenarios WHERE uid='sc-b'");
  const r=await call(f,'GET',`/scenarios/${s.id}`);
  assert.equal(r.status,200);
  assert.equal(r.body.cap_table_link.state,'deleted');
  assert.equal(r.body.cap_table_link.uid,'sc-b');
  assert.equal(r.body.cap_table_link.founders,undefined,'Founders after the round is hidden');
  const cmp=await call(f,'GET',`/compare?ids=${s.id}`);
  assert.equal(cmp.status,200);assert.equal(cmp.body.scenarios[0].cap_table_link.state,'deleted');
});

test('D6085 a link never crosses ventures, and a scenario moved away reads deleted',async()=>{
  const f=fixture();const s=await plan(f);
  const r=await link(f,s,'sc-other');
  assert.equal(r.status,404);assert.equal(r.body.code,'cap_table_scenario_not_found');
  const row=f.db.prepare('SELECT cap_table_scenario_uid,revision FROM uof_scenarios WHERE id=?').get(s.id) as any;
  assert.equal(row.cap_table_scenario_uid,null);assert.equal(row.revision,s.revision);
  assert.deepEqual(audits(f),[]);
  await link(f,s,'sc-b');
  f.db.exec("UPDATE cap_table_scenarios SET project_id=2 WHERE uid='sc-b'");
  assert.equal((await call(f,'GET',`/scenarios/${s.id}`)).body.cap_table_link.state,'deleted');
});

test('D6085 a stale revision and a malformed body change nothing',async()=>{
  const f=fixture();const s=await plan(f);
  const stale=await call(f,'PUT',`/scenarios/${s.id}/cap-table`,{cap_table_scenario_uid:'sc-b',expected_revision:s.revision+5});
  assert.equal(stale.status,409);assert.equal(stale.body.code,'changed_since_open');
  for(const b of [{expected_revision:s.revision},{cap_table_scenario_uid:'sc-b'},{cap_table_scenario_uid:'sc-b',expected_revision:s.revision,name:'x'},{cap_table_scenario_uid:7,expected_revision:s.revision},{cap_table_scenario_uid:"x' OR 1=1",expected_revision:s.revision}]){
    const r=await call(f,'PUT',`/scenarios/${s.id}/cap-table`,b);
    assert.equal(r.status,400,JSON.stringify(b));
  }
  assert.equal((f.db.prepare('SELECT cap_table_scenario_uid FROM uof_scenarios WHERE id=?').get(s.id) as any).cap_table_scenario_uid,null);
  assert.deepEqual(audits(f),[]);
});

test('D6085 the cap table’s scenario read names the plan scenarios that use it',async()=>{
  const f=fixture();const s=await plan(f);
  await link(f,s,'sc-b');
  // The cap-table router's own fixture: the owner founder reads their venture's scenario.
  const db=new DatabaseSync(':memory:');dbs.push(db);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT NOT NULL, founder_id INTEGER, subscription_tier TEXT DEFAULT 'studio', is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE cap_table_scenarios (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL, project_id INTEGER, name TEXT NOT NULL,
      inputs_json TEXT NOT NULL, result_json TEXT, computed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), is_variant INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE uof_scenarios (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL, is_base INTEGER NOT NULL DEFAULT 0, cap_table_scenario_uid TEXT);`);
  db.exec("INSERT INTO users(id,email,name,role,founder_id) VALUES(1,'owner@example.invalid','Owner','founder',7); INSERT INTO projects(id,founder_id) VALUES(1,7),(2,8);");
  db.prepare("INSERT INTO cap_table_scenarios(uid,owner_user_id,project_id,name,inputs_json,result_json,is_variant) VALUES('sc-b',1,1,'Seed · Scenario B',?,?,1),('sc-c',1,1,'Seed · Scenario C',?,?,1)")
    .run(JSON.stringify(SEED),JSON.stringify(simulate(SEED)),JSON.stringify(SEED),JSON.stringify(simulate(SEED)));
  db.exec("INSERT INTO uof_scenarios(id,project_id,name,is_base,cap_table_scenario_uid) VALUES(5,1,'Base plan',1,'sc-b'),(6,1,'Lean',0,NULL),(7,2,'Another venture plan',1,'sc-b')");
  const tok=await new SignJWT({user_id:1,role:'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const read=async(uid:string)=>{const res=await captable.request(`/scenarios/${uid}`,{headers:{Authorization:`Bearer ${tok}`}},{JWT_SECRET:secret,ENVIRONMENT:'development',DB:d1Over(db)} as any);return {status:res.status,body:await res.json() as any};};
  const b=await read('sc-b');
  assert.equal(b.status,200,JSON.stringify(b.body));
  assert.deepEqual(b.body.used_by_plans,[{id:5,name:'Base plan',is_base:true}],'only this venture’s plans');
  assert.deepEqual((await read('sc-c')).body.used_by_plans,[]);
  db.exec('DROP TABLE uof_scenarios');
  const broken=await read('sc-b');
  assert.equal(broken.status,200,'the scenario still reads');assert.equal(broken.body.used_by_plans,null);
});
