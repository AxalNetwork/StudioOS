/** D1176: mounted HTTP handlers, canonical SQLite DDL and synthetic users only. */
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
import {SECTION_KEYS} from '../src/services/useOfFunds/plan.ts';
import {addSectionHire} from '../src/services/raiseWriters.ts';
const secret='synthetic-d1176-test-jwt-not-a-credential';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const migrations=['442_raise_cycle_stores.sql','463_raise_record_stores.sql','436_round_calls.sql','520_mercury_raise_feeds.sql','249_project_metrics.sql','606_use_of_funds_scenarios.sql','607_raise_money_cents.sql'].map(n=>readFileSync(new URL(`../sql/migrations/${n}`,import.meta.url),'utf8'));
const roles=['founder','founder','admin','partner','investor','advisor','exploring'];
let savedFetch:typeof fetch;let dbs:DatabaseSync[]=[];let fetches=0;
beforeEach(()=>{ savedFetch=globalThis.fetch;fetches=0;globalThis.fetch=async()=>{fetches++;throw new Error('Provider stub: no network');}; });
afterEach(()=>{globalThis.fetch=savedFetch;for(const db of dbs)db.close();dbs=[];assert.equal(fetches,0);});
const app=new Hono();app.route('/api/cycles/raise',cycleRaise as any);app.route('/api/financials',financials as any);
function fixture(){
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});dbs.push(db);
  for(const name of ['founders','users','projects','activity_logs','user_company_links','super_admins','mi_pro_subscriptions',
    'roadmap_okrs','integrations','cap_table_scenarios','financial_models','raise_rounds','raise_prospects','raise_pro_rata','raise_closes',
    'spinout_deck_overrides','pitch_decks','pitch_deck_share_tokens','data_room_files'])db.exec(tableFromBaseline(baseline,name));
  for(const m of migrations)db.exec(m);
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
const lines=SECTION_KEYS.map((key,i)=>({key,share_pct:i===0?100:0}));
const input=(name='Lean')=>({name,amount_to_raise_cents:120000,target_runway_months:12,start_month:'2027-01',raise_month:'2027-01',cash_cents:0,lines});
const rows=(f:any,sql:string)=>JSON.parse(JSON.stringify(f.db.prepare(sql).all()));
async function created(f:any,b:any=input(),who=1){const r=await call(f,'POST','/scenarios',b,who);assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
function mercury(f:any){
  f.db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(1,'m-one',1,'mercury','oauth_mcp','active'),(2,'m-other',2,'mercury','oauth_mcp','active'); INSERT INTO mercury_raise_facts(integration_id,project_id,kind,fact_key,amount_cents,burn_cents,as_of) VALUES(1,1,'runway','runway',90000,10000,'2026-10-01'),(2,1,'runway','runway',99999999,1,'2026-10-25');");
}
test('D1176 empty plan reads nulls, original legacy source, no forecast defaults and an explicit Needs you list',async()=>{
  const f=fixture();const r=await call(f,'GET','/plan');assert.equal(r.status,200);
  assert.equal(r.body.base.value.amount_to_raise_cents,null);assert.equal(r.body.base.value.source,'Recorded');
  assert.equal(r.body.base.value.model.runway.value,null);assert.equal(r.body.round.chosen,null);
  assert.equal(r.body.runway_today.chosen,null);assert.equal(r.body.forecast.value,null);
  assert.ok(r.body.needs_you.some((x:any)=>x.code==='model_inputs_missing'));
  assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,1);
  assert.equal((await call(f,'GET','/plan')).body.base.value.id,r.body.base.value.id);
});
test('D1176 every method refuses partners, investors, advisors, explorers and a foreign founder, even with a residual founder id',async()=>{
  const f=fixture();
  for(const who of [2,4,5,6,7])for(const [method,path,b]of [
    ['GET','/plan'],['GET','/scenarios'],['POST','/scenarios',input()],['GET','/scenarios/1'],['PATCH','/scenarios/1',{name:'Denied'}],['DELETE','/scenarios/1'],['POST','/scenarios/1/make-base',{}],['GET','/compare?ids=1'],['GET','/milestones'],['POST','/milestones',{label:'Denied'}],['GET','/milestones/1'],['PATCH','/milestones/1',{label:'Denied'}],['DELETE','/milestones/1'],['GET','/hires'],['PATCH','/hires/1',{role:'Denied'}],['DELETE','/hires/1'],['PUT','',{sections:[]}],
  ] as any[])assert.equal((await call(f,method,path,b,who)).status,403,`${who} ${method} ${path}`);
  assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,0);assert.equal(rows(f,'SELECT id FROM activity_logs').length,0);
});
test('D1176 project query, active company and deleted-project boundaries cannot be bypassed',async()=>{
  const f=fixture();
  const missing=await app.request('/api/cycles/raise/use-of-funds/plan',{},f.env);assert.equal(missing.status,401);
  assert.equal((await call(f,'GET','/plan',undefined,1,{}, {'X-Company-Id':'20'})).status,404);
  assert.equal((await call(f,'GET','/plan',undefined,1,{}, {'X-Company-Id':'10'})).status,200);
  assert.equal((await call(f,'POST','/scenarios',input(),1,{impersonated_by:3})).status,403);
  f.db.exec("UPDATE projects SET deleted_at=datetime('now') WHERE id=1");
  assert.equal((await call(f,'GET','/plan')).status,404);
});
test('D1176 copies and edits alternatives without changing Base; promotion projects cents, split, target, milestones and zeroes into legacy readers',async()=>{
  const f=fixture();const a=await created(f);
  assert.equal(a.source,'Typed');assert.equal(a.model.runway.source,'Modelled');assert.equal(a.model.cashPath.value[0].raisedCents,120000);
  assert.equal(rows(f,'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed,null);
  const m=await call(f,'POST','/milestones',{scenario_id:a.id,label:'Free launch',category_key:'product',cost_cents:0,due_on:'2027-02',okr_id:1});assert.equal(m.status,201);
  const copy=await created(f,{from_id:a.id,name:'Copied'});assert.equal(copy.milestones[0].cost_cents,0);assert.notEqual(copy.milestones[0].id,m.body.id);
  assert.equal((await call(f,'PATCH',`/scenarios/${a.id}`,{amount_to_raise_cents:0,target_runway_months:18})).status,200);
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({custom:'keep',deck_synced_at:'earlier'}));
  assert.equal((await call(f,'POST',`/scenarios/${a.id}/make-base`,{})).status,200);
  const p=rows(f,'SELECT funding_needed,use_of_funds,use_of_funds_meta FROM projects WHERE id=1')[0];
  assert.equal(p.funding_needed,0);assert.deepEqual(JSON.parse(p.use_of_funds).map((l:any)=>l.pct),[100,0,0,0,0]);
  const meta=JSON.parse(p.use_of_funds_meta);assert.equal(meta.runway_months,18);assert.equal(meta.deck_synced_at,null);assert.equal(meta.custom,'keep');assert.equal(meta.milestone_costs['1'].cost,0);
  assert.equal(rows(f,'SELECT id FROM uof_scenarios WHERE is_base=1').length,1);
  assert.equal((await call(f,'DELETE',`/scenarios/${a.id}`)).status,409);
  assert.equal((await call(f,'PATCH',`/scenarios/${a.id}`,{amount_to_raise_cents:12345})).status,200);
  assert.equal(rows(f,'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed,123.45);
});
test('D1176 Base PUT keeps the old client shape, all five lines and section milestones; no financial value enters the audit',async()=>{
  const f=fixture();
  const r=await call(f,'PUT','',{amount_to_raise_cents:12345,runway_months:18,sections:[{key:'product',pct:100,milestone_label:'Launch',milestone_by:'2027-03'}]},3);
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.use_of_funds.length,5);assert.equal(r.body.runway_months,18);
  const base=(await call(f,'GET','/scenarios')).body.items[0];assert.equal(base.amount_to_raise_cents,12345);assert.equal(base.milestones[0].label,'Launch');
  assert.deepEqual(base.lines.map((x:any)=>x.share_pct),[100,0,0,0,0]);
  const log=rows(f,"SELECT action,user_id,details,entity_type FROM activity_logs WHERE action='split_saved'");assert.equal(log.length,1);
  assert.ok(log.every((l:any)=>l.user_id===3&&l.details.startsWith('Studio admin:')&&l.entity_type==='raise.use-of-funds'));
  assert.ok(!JSON.stringify(log).includes('12345'));
});
test('D1176 scenario ids and copy sources stay in their venture; compare validates and retains requested order',async()=>{
  const f=fixture();const a=await created(f);const b=await created(f,{...input('Stretch'),amount_to_raise_cents:240000});
  const other=await call(f,'POST','/api/cycles/raise/use-of-funds/scenarios?project=2',input('Other'),2);assert.equal(other.status,201);
  const id=other.body.id;
  for(const [method,path,body]of [['GET',`/scenarios/${id}`],['PATCH',`/scenarios/${id}`,{name:'Leak'}],['DELETE',`/scenarios/${id}`],['POST',`/scenarios/${id}/make-base`,{}],['POST','/scenarios',{from_id:id,name:'Leak'}],['GET',`/compare?ids=${a.id},${id}`]] as any[])assert.equal((await call(f,method,path,body)).status,404);
  for(const ids of ['',`${a.id},${a.id}`,'1,2,3,4,5','-1','1%20OR%201=1'])assert.equal((await call(f,'GET',`/compare?ids=${ids}`)).status,400);
  const cmp=await call(f,'GET',`/compare?ids=${b.id},${a.id}`);assert.equal(cmp.status,200);assert.deepEqual(cmp.body.scenarios.map((s:any)=>s.id),[b.id,a.id]);
  assert.equal(cmp.body.today.chosen,null);assert.equal(cmp.body.scenarios[0].model.runway.source,'Modelled');
});
test('D1176 deleting an alternative deletes only its children and logs the actor',async()=>{
  const f=fixture();const a=await created(f);const b=await created(f,input('Keep'));
  await call(f,'POST','/milestones',{scenario_id:a.id,label:'Delete with parent'});
  assert.equal((await call(f,'DELETE',`/scenarios/${a.id}`,undefined,3)).status,200);
  assert.equal((await call(f,'GET',`/scenarios/${a.id}`)).status,404);assert.equal((await call(f,'GET',`/scenarios/${b.id}`)).status,200);
  assert.equal(rows(f,`SELECT id FROM uof_milestones WHERE scenario_id=${a.id}`).length,0);
  assert.equal(rows(f,"SELECT user_id FROM activity_logs WHERE action='uof_scenario_deleted'")[0].user_id,3);
});
test('D1176 a scenario promoted during a delete keeps its Base flag, children and deletion-free audit',async()=>{
  const f=fixture();const a=await created(f);const original=f.env.DB.batch;
  f.env.DB.batch=async(stmts:any[])=>{
    f.db.prepare('UPDATE uof_scenarios SET is_base=0 WHERE project_id=1 AND is_base=1').run();
    f.db.prepare('UPDATE uof_scenarios SET is_base=1 WHERE id=?').run(a.id);
    return original(stmts);
  };
  assert.equal((await call(f,'DELETE',`/scenarios/${a.id}`)).status,409);
  assert.equal(rows(f,`SELECT is_base FROM uof_scenarios WHERE id=${a.id}`)[0].is_base,1);
  assert.equal(rows(f,`SELECT id FROM uof_scenario_lines WHERE scenario_id=${a.id}`).length,5);
  assert.equal(rows(f,"SELECT id FROM activity_logs WHERE action='uof_scenario_deleted'").length,0);
});
test('D1176 promotion of a concurrently deleted scenario leaves the existing Base and legacy values intact',async()=>{
  const f=fixture();const a=await created(f);const old=rows(f,'SELECT id FROM uof_scenarios WHERE is_base=1')[0].id;const original=f.env.DB.batch;
  f.env.DB.batch=async(stmts:any[])=>{
    f.db.prepare('DELETE FROM uof_scenario_lines WHERE scenario_id=?').run(a.id);
    f.db.prepare('DELETE FROM uof_scenarios WHERE id=?').run(a.id);
    return original(stmts);
  };
  assert.equal((await call(f,'POST',`/scenarios/${a.id}/make-base`,{})).status,409);
  assert.deepEqual(rows(f,'SELECT id FROM uof_scenarios WHERE is_base=1'),[{id:old}]);
  assert.equal(rows(f,'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed,null);
  assert.equal(rows(f,"SELECT id FROM activity_logs WHERE action='uof_scenario_made_base'").length,0);
});
test('D1176 stale edits and copies refuse atomically when a competing Base promotion or deletion wins',async()=>{
  for(const mode of ['scenario','milestone','split','copy']){
    const f=fixture();const a=await created(f);const old=rows(f,'SELECT id FROM uof_scenarios WHERE is_base=1')[0].id;
    const m=await call(f,'POST','/milestones',{scenario_id:a.id,label:'Keep',cost_cents:100});assert.equal(m.status,201);
    const original=f.env.DB.batch;const before=rows(f,'SELECT id FROM activity_logs').length;
    f.env.DB.batch=async(stmts:any[])=>{
      if(mode==='copy'){
        f.db.prepare('DELETE FROM uof_milestones WHERE scenario_id=?').run(a.id);f.db.prepare('DELETE FROM uof_scenario_lines WHERE scenario_id=?').run(a.id);f.db.prepare('DELETE FROM uof_scenarios WHERE id=?').run(a.id);
      }else{f.db.prepare('UPDATE uof_scenarios SET is_base=0 WHERE id=?').run(old);f.db.prepare('UPDATE uof_scenarios SET is_base=1 WHERE id=?').run(a.id);}
      return original(stmts);
    };
    const result=mode==='scenario'?await call(f,'PATCH',`/scenarios/${a.id}`,{currency:'eur',lines:lines.map(l=>({...l,share_pct:l.key==='reserve'?100:0}))}):mode==='milestone'?await call(f,'PATCH',`/milestones/${m.body.id}`,{label:'Must not change'}):mode==='split'?await call(f,'PUT','',{amount_to_raise_cents:99,sections:[{key:'reserve',pct:100}]}):await call(f,'POST','/scenarios',{from_id:a.id,name:'Must not copy'});
    assert.equal(result.status,409,mode);assert.equal(rows(f,'SELECT id FROM activity_logs').length,before);
    assert.equal(rows(f,'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed,null);
    if(mode!=='copy'){
      assert.equal(rows(f,`SELECT currency FROM uof_scenarios WHERE id=${a.id}`)[0].currency,'usd');
      assert.equal(rows(f,`SELECT label FROM uof_milestones WHERE id=${m.body.id}`)[0].label,'Keep');
      assert.equal(rows(f,`SELECT share_pct FROM uof_scenario_lines WHERE scenario_id=${a.id} AND category_key='product'`)[0].share_pct,100);
    }else assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,1);
  }
});
test('D1176 milestones keep null distinct from free, validate dates and reject foreign OKRs or transfers',async()=>{
  const f=fixture();const a=await created(f);const b=await created(f,input('Other scenario'));
  const m=await call(f,'POST','/milestones',{scenario_id:a.id,label:'Not costed'});assert.equal(m.status,201);assert.equal(m.body.cost_cents,null);assert.equal(m.body.cost_state,'not_costed');
  const free=await call(f,'PATCH',`/milestones/${m.body.id}`,{cost_cents:0,category_key:'product',due_on:'2027-02',okr_id:1});assert.equal(free.status,200);assert.equal(free.body.cost_state,'recorded');assert.equal(free.body.cost_cents,0);
  assert.equal((await call(f,'PATCH',`/milestones/${m.body.id}`,{scenario_id:b.id})).status,400);
  assert.equal((await call(f,'PATCH',`/milestones/${m.body.id}`,{okr_id:2})).status,404);
  assert.equal((await call(f,'POST','/milestones',{scenario_id:a.id,label:'Duplicate',okr_id:1})).status,409);
  assert.equal((await call(f,'PATCH',`/milestones/${m.body.id}`,{due_on:'2027-02-30'})).status,400);
  assert.equal((await call(f,'PATCH',`/milestones/${m.body.id}`,{cost_cents:null})).body.cost_state,'not_costed');
  assert.equal((await call(f,'DELETE',`/milestones/${m.body.id}`)).status,200);assert.equal((await call(f,'GET',`/milestones/${m.body.id}`)).status,404);
});
test('D1176 milestone ids cannot reach another venture and Base milestone edits keep legacy metadata in step',async()=>{
  const f=fixture();const sc=(await call(f,'GET','/scenarios')).body.items[0];
  const m=await call(f,'POST','/milestones',{scenario_id:sc.id,label:'Base milestone',category_key:'product',cost_cents:123,okr_id:1});assert.equal(m.status,201);
  assert.equal(JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta).milestone_costs['1'].cost,1.23);
  for(const method of ['GET','PATCH','DELETE'])assert.equal((await call(f,method,`/api/cycles/raise/use-of-funds/milestones/${m.body.id}?project=2`,method==='PATCH'?{label:'No'}:undefined,2)).status,404);
  assert.equal((await call(f,'DELETE',`/milestones/${m.body.id}`,undefined,3)).status,200);
  assert.deepEqual(JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta).milestone_costs,{});
});
test('D1176 hire edits preserve zero and missing start, affect the model, refuse foreign ids and audit admin writes',async()=>{
  const f=fixture();const a=await created(f);
  f.db.exec("INSERT INTO use_of_funds_hires(id,project_id,category_key,role,start_month,annual_cents) VALUES(1,1,'product','Engineer','2027-03',12000),(2,2,'product','Other',NULL,NULL)");
  const before=(await call(f,'GET',`/scenarios/${a.id}`)).body;assert.equal(before.model.sections[0].payroll.value[0],0);assert.equal(before.model.sections[0].payroll.value[2],1000);
  const r=await call(f,'PATCH','/hires/1',{start_month:null,annual_cents:0},3);assert.equal(r.status,200);assert.equal(r.body.annual_cents,0);assert.equal(r.body.start_month,null);
  assert.equal((await call(f,'GET',`/scenarios/${a.id}`)).body.model.runway.value,null);
  for(const method of ['PATCH','DELETE'])assert.equal((await call(f,method,'/hires/2',method==='PATCH'?{role:'No'}:undefined)).status,404);
  assert.match(rows(f,"SELECT details FROM activity_logs WHERE action='uof_hire_updated'")[0].details,/Studio admin/);
  assert.equal((await call(f,'DELETE','/hires/1')).status,200);assert.equal((await call(f,'GET',`/scenarios/${a.id}`)).body.model.burn.value[0].spendCents,10000);
});
test('D1176 round precedence is approved current call, active record, plan; every cap-table or currency disagreement remains visible',async()=>{
  const f=fixture();const a=await created(f);await call(f,'POST',`/scenarios/${a.id}/make-base`,{});
  f.db.exec("INSERT INTO raise_rounds(id,uid,project_id,name,target_amount,currency) VALUES(1,'round-one',1,'Seed',1500,'USD'); INSERT INTO round_calls(uid,project_id,round_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,counsel_approved_hash,counsel_approved_at,created_by) VALUES('call-one',1,1,'Approved',180000,'safe','Synthetic',1,'2027-01-01','sent','same','same','2026-10-01',1),('call-stale',1,1,'Changed',999999,'safe','Synthetic',1,'2027-01-01','sent','new','old','2026-10-02',1); INSERT INTO cap_table_scenarios(owner_user_id,project_id,name,inputs_json) VALUES(1,1,'Cap base','{\"rounds\":[{\"name\":\"Seed\",\"investment\":2000}]}');");
  let r=(await call(f,'GET','/plan')).body.round;assert.equal(r.chosen.value,180000);assert.equal(r.chosen.source,'Document');assert.equal(r.disagreements.length,3);assert.equal(r.candidates.some((x:any)=>x.value===999999),false);
  assert.equal(r.sources.cap_table.value.link_state,'not_recorded');
  f.db.exec("UPDATE round_calls SET counsel_approved_hash=NULL");r=(await call(f,'GET','/plan')).body.round;assert.equal(r.chosen.value,150000);assert.equal(r.chosen.source,'Typed');
  f.db.exec("UPDATE raise_rounds SET status='closed'");r=(await call(f,'GET','/plan')).body.round;assert.equal(r.chosen.value,120000);
});
test('D1176 measured runway is founder Mercury, then connector metrics, then Typed; forecast never substitutes and Mercury is private',async()=>{
  const f=fixture();mercury(f);
  f.db.exec("INSERT INTO project_metrics(project_id,cash_balance,net_burn,snapshot_date,source) VALUES(1,1000,100,'2026-10-01','stripe'),(1,1500,100,'2026-10-25',NULL),(1,55555,1,'2026-10-26','mercury'); INSERT INTO financial_models(project_id,assumptions_json,computed_json) VALUES(1,'{}','{\"runway_months\":77}');");
  let r=(await call(f,'GET','/plan')).body;assert.equal(r.runway_today.chosen.value,9);assert.equal(r.runway_today.chosen.source,'Connector');assert.equal(r.runway_today.chosen.as_of,'2026-10-01');
  const admin=(await call(f,'GET','/plan',undefined,3)).body;assert.equal(admin.runway_today.chosen.value,10);assert.equal(admin.runway_today.sources.mercury.state,'founder_only');assert.equal(JSON.stringify(admin).includes('55555'),false);assert.equal(JSON.stringify(admin).includes('99999999'),false);
  const support=(await call(f,'GET','/plan',undefined,1,{impersonated_by:3})).body;assert.equal(support.runway_today.chosen.value,10);assert.equal(support.viewer.mercury,false);
  f.db.exec("UPDATE integrations SET status='disconnected'; DELETE FROM project_metrics WHERE source IS NOT NULL");r=(await call(f,'GET','/plan')).body;assert.equal(r.runway_today.chosen.value,15);assert.equal(r.runway_today.chosen.source,'Typed');
  f.db.exec('DELETE FROM project_metrics');r=(await call(f,'GET','/plan')).body;assert.equal(r.runway_today.chosen,null);assert.equal(r.forecast.value.computed.runway_months,77);assert.equal(r.forecast.value.source,'Modelled');
});
test('D1176 a failed Mercury block falls back to dated metrics; unrelated failures do not blank the plan',async()=>{
  const f=fixture();f.db.exec("INSERT INTO project_metrics(project_id,cash_balance,net_burn,snapshot_date) VALUES(1,200,20,'2026-10-01'); DROP TABLE mercury_raise_facts; DROP TABLE round_calls; DROP TABLE financial_models;");
  const r=await call(f,'GET','/plan');assert.equal(r.status,200);assert.equal(r.body.runway_today.chosen.value,10);assert.equal(r.body.runway_today.partial,true);assert.equal(r.body.runway_today.sources.mercury.state,'unreadable');assert.equal(r.body.forecast.state,'unreadable');assert.equal(r.body.round.sources.calls.state,'unreadable');assert.equal(r.body.base.state,'ok');
});
test('D1176 unreadable legacy metadata stays unreadable instead of overwriting it or hiding good source blocks',async()=>{
  const f=fixture();f.db.exec("UPDATE projects SET use_of_funds_meta='corrupt' WHERE id=1; INSERT INTO project_metrics(project_id,cash_balance,net_burn,snapshot_date) VALUES(1,100,10,'2026-10-01')");
  const r=(await call(f,'GET','/plan')).body;assert.equal(r.base.state,'unreadable');assert.equal(r.runway_today.chosen.value,10);
  assert.equal((await call(f,'POST','/scenarios',input())).status,409);assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,0);
});
test('D1176 stale legacy costs give a correction route and keep data until an explicit repair permits the split',async()=>{
  const f=fixture();const legacy={milestone_costs:{m1:{bucket:'eng',cost:400}},keep:'Recorded outside this tool'};
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify(legacy));
  const r=await call(f,'PUT','',{sections:[{key:'product',pct:100}]});
  assert.equal(r.status,409);assert.equal(r.body.code,'legacy_plan_repair_required');assert.match(r.body.detail,/PUT \/api\/projects\/:id/);
  assert.deepEqual(JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta),legacy);
  assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,0);assert.equal(rows(f,'SELECT id FROM activity_logs').length,0);
  // The existing authenticated projects PUT accepts this explicit metadata correction.
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({...legacy,milestone_costs:{}}));
  assert.equal((await call(f,'PUT','',{sections:[{key:'product',pct:100}]})).status,200);
  assert.equal(rows(f,'SELECT share_pct FROM uof_scenario_lines WHERE category_key=\'product\'')[0].share_pct,100);
  assert.equal(rows(f,"SELECT id FROM activity_logs WHERE action='split_saved'").length,1);
});
test('D1176 projection keeps later legacy-only entries and extra fields while retiring the old Base projection',async()=>{
  const f=fixture();
  f.db.exec("INSERT INTO roadmap_okrs(id,project_id,objective) VALUES(3,1,'Uncosted roadmap item')");
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({milestones:{product:{label:'Copied',by:''}},milestone_costs:{'1':{cost:'1.23',bucket:'product'},'3':{cost:' ',bucket:''}}}));
  await call(f,'GET','/scenarios');
  const external={milestones:{product:{label:'Copied',by:''},operations:{label:'Later legacy',by:'2027-04'}},milestone_costs:{'1':{cost:'1.23',bucket:'product',note:'Keep extra'},'3':{cost:' ',bucket:''},m1:{cost:77,bucket:'ops'}},keep:'Unrelated'};
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify(external));
  assert.equal((await call(f,'PUT','',{sections:[{key:'product',pct:100}]})).status,200);
  let meta=JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta);
  assert.deepEqual(meta.milestones.operations,external.milestones.operations);assert.deepEqual(meta.milestone_costs.m1,external.milestone_costs.m1);assert.equal(meta.milestone_costs['1'].note,'Keep extra');
  const other=await created(f,{name:'No copied milestones'});
  assert.equal((await call(f,'POST',`/scenarios/${other.id}/make-base`,{})).status,200);
  meta=JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta);
  assert.deepEqual(meta.milestones,{operations:external.milestones.operations});assert.deepEqual(meta.milestone_costs,{m1:external.milestone_costs.m1});assert.equal(meta.keep,'Unrelated');
});
test('D1176 a conflicting later legacy edit refuses before changing Base or its audit',async()=>{
  const f=fixture();
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({milestone_costs:{'1':{cost:1,bucket:'eng'}}}));
  const base=(await call(f,'GET','/scenarios')).body.items[0];
  const changed={milestone_costs:{'1':{cost:2,bucket:'eng'}}};
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify(changed));
  const r=await call(f,'PATCH',`/scenarios/${base.id}`,{name:'Must not replace the other edit'});
  assert.equal(r.status,409);assert.equal(r.body.code,'legacy_plan_changed');
  assert.equal(rows(f,'SELECT name FROM uof_scenarios WHERE is_base=1')[0].name,'Base');assert.equal(rows(f,'SELECT id FROM activity_logs').length,0);
  assert.deepEqual(JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta),changed);
});
test('D1176 a milestone can be removed after its roadmap OKR disappears, including its Base projection and audit',async()=>{
  const f=fixture();const base=(await call(f,'GET','/scenarios')).body.items[0];
  const m=await call(f,'POST','/milestones',{scenario_id:base.id,label:'Linked',cost_cents:123,okr_id:1});assert.equal(m.status,201);
  f.db.exec('DELETE FROM roadmap_okrs WHERE id=1');
  assert.equal((await call(f,'DELETE',`/milestones/${m.body.id}`)).status,200);
  assert.equal(rows(f,'SELECT id FROM uof_milestones').length,0);
  assert.deepEqual(JSON.parse(rows(f,'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta).milestone_costs,{});
  assert.equal(rows(f,"SELECT id FROM activity_logs WHERE action='uof_milestone_deleted'").length,1);
});
test('D1176 invalid financial and AI provenance payloads refuse without writes; explicit zero cash/raise survives',async()=>{
  const f=fixture();const a=await created(f);
  const blank=await created(f,{name:'Blank'});assert.equal(blank.amount_to_raise_cents,null);assert.equal(blank.cash_cents,null);assert.equal(blank.model.runway.value,null);
  const bad=[{amount_to_raise_cents:-1},{amount_to_raise_cents:''},{amount_to_raise_cents:1.1},{target_runway_months:0},{start_month:'2027-13'},{currency:'US'},{source:'eadwyn'},{lines:lines.slice(1)},{lines:lines.map(x=>({...x,share_pct:10}))}];
  const before=rows(f,'SELECT * FROM uof_scenarios');const audit=rows(f,'SELECT * FROM activity_logs');
  for(const b of bad)assert.equal((await call(f,'PATCH',`/scenarios/${a.id}`,b)).status,400);
  assert.deepEqual(rows(f,'SELECT * FROM uof_scenarios'),before);assert.deepEqual(rows(f,'SELECT * FROM activity_logs'),audit);
  const zero=await call(f,'PATCH',`/scenarios/${a.id}`,{amount_to_raise_cents:0,cash_cents:0});assert.equal(zero.status,200);assert.equal(zero.body.model.sections[0].allocation.value,0);
});
test('D1176 deck ties distinguish absence from sync and Needs you comes from the actual saved model',async()=>{
  const f=fixture();const a=await created(f);await call(f,'POST',`/scenarios/${a.id}/make-base`,{});
  assert.equal((await call(f,'GET','/plan')).body.ties.deck.value.state,'not_recorded');
  f.db.exec("INSERT INTO pitch_decks(project_id,version,slides) VALUES(1,2,'[]')");
  await call(f,'POST','/milestones',{scenario_id:a.id,label:'Unknown cost',category_key:'product'});
  await call(f,'POST','/milestones',{scenario_id:a.id,label:'Over budget',category_key:'product',cost_cents:240000});
  let r=(await call(f,'GET','/plan')).body;assert.equal(r.ties.deck.value.state,'out_of_sync');assert.equal(r.ties.deck.value.version,2);
  assert.ok(r.needs_you.some((x:any)=>x.code==='milestones_not_costed'));assert.ok(r.needs_you.some((x:any)=>x.code==='milestones_at_risk'));
  f.db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({deck_synced_at:'2026-10-26'}));
  r=(await call(f,'GET','/plan')).body;assert.equal(r.ties.deck.value.state,'synced');assert.equal(r.needs_you.some((x:any)=>x.code==='deck_out_of_sync'),false);
});
test('D1176 audit storage failure rolls back promotion, Base edits, milestone and hire changes and scenario deletion',async()=>{
  const f=fixture();const a=await created(f);const m=await call(f,'POST','/milestones',{scenario_id:a.id,label:'Milestone'});
  f.db.exec("INSERT INTO use_of_funds_hires(id,project_id,category_key,role) VALUES(1,1,'product','Engineer')");
  const snapshot=()=>['uof_scenarios','uof_scenario_lines','uof_milestones','use_of_funds_hires','projects'].map(t=>rows(f,`SELECT * FROM ${t}`));
  const before=snapshot();f.db.exec('DROP TABLE activity_logs');
  for(const [method,path,b]of [['POST',`/scenarios/${a.id}/make-base`,{}],['PATCH',`/scenarios/${a.id}`,{name:'Must roll back'}],['POST','/scenarios',input('Must roll back')],['POST','/milestones',{scenario_id:a.id,label:'Must roll back'}],['PATCH',`/milestones/${m.body.id}`,{cost_cents:33}],['PATCH','/hires/1',{annual_cents:33}],['DELETE',`/scenarios/${a.id}`]] as any[])assert.equal((await call(f,method,path,b)).status,503);
  assert.deepEqual(snapshot(),before);
});
test('D1176 the existing Add hire also commits its admin audit atomically without business text in the log',async()=>{
  const f=fixture();const r=await addSectionHire(f.env,{projectId:1,userId:3,sectionKey:'product',body:{role:'Synthetic role',annual_cents:1234,start_month:'2027-01'}});
  assert.equal(typeof r.id,'number');assert.equal(rows(f,"SELECT details FROM activity_logs WHERE action='hire_added'")[0].details,'Studio admin: Hire added.');
  f.db.exec('DROP TABLE activity_logs');
  await assert.rejects(addSectionHire(f.env,{projectId:1,userId:3,sectionKey:'product',body:{role:'Must roll back'}}));
  assert.equal(rows(f,'SELECT id FROM use_of_funds_hires').length,1);
});
const drivers={starting_cash:12345,price_per_unit:10,units_month_0:5,monthly_growth_pct:2,cac:4,monthly_churn_pct:3,salaries_monthly:10,opex_monthly:10,gross_margin_pct:70,horizon_months:24};
test('D1176 forecast save retains driver provenance, adds scoped admin audit and rolls back when audit is unavailable',async()=>{
  const f=fixture();const url='/api/financials/1';
  f.db.prepare('INSERT INTO financial_models(project_id,assumptions_json) VALUES(?,?)').run(1,JSON.stringify({...drivers,stripe_mrr:200,_sources:{units_month_0:'stripe',stripe_mrr:'stripe'}}));
  const r=await call(f,'PUT',url,{assumptions:drivers},3);assert.equal(r.status,200,JSON.stringify(r.body));
  const stored=JSON.parse(rows(f,'SELECT assumptions_json FROM financial_models')[0].assumptions_json);assert.equal(stored._sources.units_month_0,'stripe');assert.equal(stored.stripe_mrr,200);
  const log=rows(f,"SELECT project_id,user_id,entity_type,action,details FROM activity_logs WHERE action='forecast_saved'")[0];assert.deepEqual(log,{project_id:1,user_id:3,entity_type:'raise.use-of-funds',action:'forecast_saved',details:'Studio admin: forecast saved.'});
  const before=rows(f,'SELECT assumptions_json FROM financial_models')[0].assumptions_json;f.db.exec('DROP TABLE activity_logs');
  assert.equal((await call(f,'PUT',url,{assumptions:{...drivers,starting_cash:99999}},1)).status,503);
  assert.equal(rows(f,'SELECT assumptions_json FROM financial_models')[0].assumptions_json,before);
});
