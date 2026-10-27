/** D1177 (#3104): the plan's history read. Mounted handlers, canonical SQLite DDL and synthetic users only. */
import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {SignJWT} from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import financials from '../src/routes/financials.ts';
import {d1Over} from './_d1_sqlite.mjs';
import {tableFromBaseline} from './_baseline.mjs';
const secret='synthetic-d1177-test-jwt-not-a-credential';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const migrations=['442_raise_cycle_stores.sql','463_raise_record_stores.sql','436_round_calls.sql','520_mercury_raise_feeds.sql','249_project_metrics.sql','606_use_of_funds_scenarios.sql','607_raise_money_cents.sql'].map(n=>readFileSync(new URL(`../sql/migrations/${n}`,import.meta.url),'utf8'));
const roles=['founder','founder','admin','partner','investor','advisor','exploring'];
let savedFetch:typeof fetch;let dbs:DatabaseSync[]=[];let fetches=0;
beforeEach(()=>{ savedFetch=globalThis.fetch;fetches=0;globalThis.fetch=async()=>{fetches++;throw new Error('Provider stub: no network');}; });
afterEach(()=>{globalThis.fetch=savedFetch;for(const db of dbs)db.close();dbs=[];assert.equal(fetches,0);});
const app=new Hono();app.route('/api/cycles/raise',cycleRaise as any);app.route('/api/financials',financials as any);
function fixture(){
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});dbs.push(db);
  for(const name of ['founders','users','projects','activity_logs','user_company_links','company_profiles','super_admins','mi_pro_subscriptions',
    'roadmap_okrs','integrations','cap_table_scenarios','financial_models','raise_rounds','raise_prospects','raise_pro_rata','raise_closes',
    'spinout_deck_overrides','pitch_decks','pitch_deck_share_tokens','data_room_files'])db.exec(tableFromBaseline(baseline,name));
  for(const m of migrations)db.exec(m);
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql',import.meta.url),'utf8')); // D1137: resolveActiveCompany reads archived_at
  db.exec("INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test'); INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',11,10),(2,'Other venture',22,20); INSERT INTO roadmap_okrs(id,project_id,objective) VALUES(1,1,'Product milestone'),(2,2,'Other milestone');");
  roles.forEach((role,i)=>db.prepare('INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(?,?,?,?,?,1)').run(i+1,role,`Synthetic ${i+1}`,`member-${i+1}@example.test`,i===1?22:11));
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('link-one',1,10),('link-two',1,20)");
  return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
async function call(f:any,method:string,path:string,b?:unknown,who=1,extra:Record<string,unknown>={},headers:Record<string,string>={}){
  const token=await new SignJWT({user_id:who,role:roles[who-1],...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res=await app.request(path.startsWith('/api/')?path:`/api/cycles/raise/use-of-funds${path}${path.includes('?')?'&':'?'}project=1`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:b===undefined?undefined:JSON.stringify(b)},f.env);
  return {status:res.status,body:await res.json() as any};
}

const log=(f:any,id:number,user:number,action:string,details:string,at:string,project=1,type='raise.use-of-funds')=>
  f.db.prepare('INSERT INTO activity_logs(id,project_id,user_id,entity_type,entity_id,action,details,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,project,user,type,'x',action,details,`user:${user}`,at);
function seeded(){
  const f=fixture();
  log(f,1,1,'uof_scenario_created','uof scenario created.','2026-10-01 09:00:00');
  log(f,2,3,'uof_hire_updated','Studio admin: uof hire updated.','2026-10-09 09:00:00');
  log(f,3,1,'mercury_mapping_accepted','Mercury category mapped to a section','2026-10-14 09:00:00');
  log(f,4,1,'split_saved','Split saved','2026-10-22 09:00:00');
  log(f,5,1,'uof_scenario_created','Other venture','2026-10-23 09:00:00',2);
  log(f,6,1,'record_updated','Another module','2026-10-24 09:00:00',1,'raise.cap-table');
  return f;
}
test('D1177 history lists this plan\'s changes newest first, with who and an admin tag, and nothing from another venture or module',async()=>{
  const f=seeded();const r=await call(f,'GET','/history');
  assert.equal(r.status,200);
  assert.deepEqual(r.body.items.map((x:any)=>x.id),[4,3,2,1]);
  assert.equal(r.body.total,4);assert.equal(r.body.page,1);assert.equal(r.body.page_size,20);
  const admin=r.body.items.find((x:any)=>x.id===2);
  assert.equal(admin.admin,true);assert.equal(admin.who,'Synthetic 3');
  assert.equal(r.body.items.find((x:any)=>x.id===4).admin,false);
  assert.ok(!JSON.stringify(r.body).includes('@example.test'),'no email in the history');
});
test('D1177 an admin reads the history without the founder\'s Mercury rows',async()=>{
  const f=seeded();const r=await call(f,'GET','/history',undefined,3);
  assert.equal(r.status,200);
  assert.deepEqual(r.body.items.map((x:any)=>x.id),[4,2,1]);
  assert.equal(r.body.total,3);
});
test('D1177 history pages by twenty and refuses the roles the plan refuses',async()=>{
  const f=fixture();
  for(let i=1;i<=25;i++)log(f,i,1,'uof_milestone_updated','uof milestone updated.',`2026-10-${String(i).padStart(2,'0')} 09:00:00`);
  const p1=await call(f,'GET','/history');const p2=await call(f,'GET','/history?page=2');
  assert.equal(p1.body.items.length,20);assert.equal(p2.body.items.length,5);assert.equal(p2.body.items[4].id,1);
  assert.equal(p1.body.total,25);
  assert.equal((await call(f,'GET','/history?page=x')).body.page,1,'a bad page reads page 1');
  for(const who of [2,4,5,6,7])assert.equal((await call(f,'GET','/history',undefined,who)).status,403,String(who));
});
