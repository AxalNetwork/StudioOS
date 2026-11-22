// D6214: attributed, immutable rule revisions and optimistic GP writes over real SQLite.
import { before, after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/portfolio_reporting_settings.ts';
import positions from '../src/routes/positions.ts';
import { readReportingRules, validateReportingRules, dutyReportingRuleKeys } from '../src/services/portfolioReportingRules.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const NOW=Date.parse('2026-11-20T12:00:00Z'),secret='t'.repeat(64);
before(()=>mock.timers.enable({apis:['Date'],now:NOW}));after(()=>mock.timers.reset());
function world(){
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
 for(const table of ['users','super_admins','mi_pro_subscriptions','vc_funds','company_profiles','user_company_links','portfolio_positions','projects','portfolio_kpi_definitions','activity_logs','portfolio_updates'])db.exec(tableFromBaseline(baseline,table));
 db.exec(readFileSync(new URL('../sql/migrations/168_portfolio_marks_distributions.sql',import.meta.url),'utf8'));
 db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/579_reporting_duties.sql',import.meta.url),'utf8'),'reporting_duties'));
 const migration=readdirSync(new URL('../sql/migrations/',import.meta.url)).find(n=>n.endsWith('_6214_portfolio_reporting_rule_history.sql'))!;
 const sql=readFileSync(new URL(`../sql/migrations/${migration}`,import.meta.url),'utf8');db.exec(sql);db.exec(sql);
 for(const [id,role] of [[1,'admin'],[2,'investor'],[3,'investor']])db.prepare("INSERT INTO users(id,name,email,role,is_active,investor_tier,investor_subscription_status) VALUES(?,?,?,?,1,'institutional','active')").run(id,`Synthetic ${id}`,`synthetic${id}@example.invalid`,role);
 db.exec("INSERT INTO vc_funds(id,name,gp_user_id) VALUES(10,'Own fund',2),(20,'Other fund',3); INSERT INTO projects(id,uid,name,stage) VALUES(5,'p5','Venture','Seed'); INSERT INTO portfolio_positions(uid,project_id,fund_id,round_name,invested_amount) VALUES('position',5,10,'Seed',100);");
 const env:any={DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'};const app=new Hono<any>();app.route('/settings',router);app.route('/api/positions',positions);app.onError((e,c)=>c.json({error:'Refused'},AUTH_ERROR_STATUSES[e.message]||500));return{db,env,app};
}
async function call(w:ReturnType<typeof world>,who:number,method='GET',path='/10?cadence=monthly',body?:any){const token=await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));const r=await w.app.request(`/settings${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},w.env);return{status:r.status,body:await r.json() as any};}
test('inherited rules become an attributed fund revision; past periods keep the original set',async()=>{
 const w=world();try{
 const old=await readReportingRules(w.env,10,'monthly','2026-10');assert.equal(old.inherited,true);
 const read=await call(w,2);assert.equal(read.status,200);
 const rules=read.body.all_rules.map((r:any)=>({...r,required:0}));
 const saved=await call(w,2,'PUT','/10',{rules,revision:read.body.revision,due_days:12});assert.equal(saved.status,200);assert.equal(saved.body.updated_by,2);assert.equal(saved.body.updated_by_name,'Synthetic 2');assert.equal(saved.body.effective_month,'2026-11');assert.equal(saved.body.effective_quarter,'2026-Q4');
 const past=await readReportingRules(w.env,10,'monthly','2026-10');assert.equal(past.revision,old.revision);assert.deepEqual(past.rules,old.rules);
 const historic=await call(w,2,'GET','/10?cadence=monthly&period=2026-10');assert.equal(historic.status,200);assert.equal(historic.body.revision,old.revision);assert.equal(historic.body.period,'2026-10');
 assert.equal((await call(w,2,'GET','/10?cadence=monthly&period=invalid')).status,400);
 const now=await readReportingRules(w.env,10,'monthly','2026-11');assert.equal(now.inherited,false);assert.equal(now.due_days,12);assert.ok(now.rules.every(r=>r.required===0));
 assert.equal((await readReportingRules(w.env,10,'quarterly','2026-Q3')).inherited,true);
 assert.equal((await readReportingRules(w.env,10,'quarterly','2026-Q4')).inherited,false);
 assert.equal((await call(w,2,'PUT','/10',{rules,revision:read.body.revision,due_days:12})).status,409);
 assert.equal(w.db.prepare('SELECT COUNT(*) n FROM portfolio_reporting_rule_sets WHERE fund_id=10').get()?.n,1);
 }finally{w.db.close();}
});
test('ownership and duplicate-key checks precede writes; HQ is read-only',async()=>{
 const w=world();try{
 assert.equal((await call(w,3)).status,404);assert.equal((await call(w,2,'PUT','/hq',{})).status,400);
 const read=await call(w,2);assert.equal((await call(w,3,'PUT','/10',{rules:read.body.all_rules,revision:read.body.revision,due_days:30})).status,404);const duplicate=[read.body.all_rules[0],read.body.all_rules[0]];
 assert.equal((await call(w,2,'PUT','/10',{rules:duplicate,revision:read.body.revision,due_days:30})).status,400);
 assert.equal(w.db.prepare('SELECT COUNT(*) n FROM portfolio_reporting_rule_sets WHERE fund_id=10').get()?.n,0);
 assert.equal((await call(w,3,'GET','/hq?cadence=monthly')).status,200);
 }finally{w.db.close();}
});
test('signed figure lists win and table-derived rule keys respect required state and stage',async()=>{
 const w=world();try{
 const original=await dutyReportingRuleKeys(w.env,{kind:'monthly_financials',required_figures:'[]',project_id:5,holder_user_id:2},'2026-10-31');assert.ok(original.includes('revenue'));
 const read=await call(w,2);const rules=read.body.all_rules.map((r:any)=>({...r,required:1,applies_to:'Growth'}));await call(w,2,'PUT','/10',{rules,revision:read.body.revision,due_days:30});
 assert.deepEqual(await dutyReportingRuleKeys(w.env,{kind:'monthly_financials',required_figures:'[]',project_id:5,holder_user_id:2},'2026-11-30'),[]);
 assert.deepEqual(await dutyReportingRuleKeys(w.env,{kind:'monthly_financials',required_figures:'["revenue"]',project_id:5,holder_user_id:2},'2026-11-30'),[]);
 assert.throws(()=>validateReportingRules([{kpi_key:'bad;sql'}]));
 }finally{w.db.close();}
});
test('a failed rule-history read is unreadable and cannot be saved as an empty set',async()=>{const w=world();w.db.exec('DROP TABLE portfolio_reporting_rule_sets');try{assert.equal((await call(w,2)).status,503);}finally{w.db.close();}});

function synchronizeRuleReads(w: ReturnType<typeof world>) {
 const original=w.env.DB;let joined=0;let release:()=>void=()=>{};
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 w.env.DB={...original,prepare(sql:string){
  const statement=original.prepare(sql);
  if(!sql.startsWith('SELECT h.*,u.name AS updated_by_name'))return statement;
  const wrapped={...statement,bind(...values:any[]){statement.bind(...values);return wrapped;},async all(){
   const result=await statement.all();joined+=1;
   if(joined<=2){if(joined===2)release();await barrier;}
   return result;
  }};
  return wrapped;
 }};
}
test('concurrent saves compare and insert atomically; only one revision wins',async()=>{
 const w=world();try{const read=await call(w,2);const body={rules:read.body.all_rules,revision:read.body.revision,due_days:12};
 synchronizeRuleReads(w);
 const outcomes=await Promise.all([call(w,2,'PUT','/10',body),call(w,2,'PUT','/10',{...body,due_days:14})]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
 assert.equal(w.db.prepare('SELECT COUNT(*) n FROM portfolio_reporting_rule_sets WHERE fund_id=10').get()?.n,1);
 }finally{w.db.close();}
});

test('kpi-compliance uses the company fund’s revision for the measured period',async()=>{
 const w=world();try{
  const base=await call(w,2);const rules=base.body.all_rules.map((r:any)=>({...r,required:0}));
  assert.equal((await call(w,2,'PUT','/10',{rules,revision:base.body.revision,due_days:12})).status,200);
  const token=await new SignJWT({user_id:1}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const read=async(period:string)=>{const r=await w.app.request(`/api/positions/kpi-compliance?cadence=monthly&period=${period}&as_of=2026-11-20`,{headers:{Authorization:`Bearer ${token}`}},w.env);assert.equal(r.status,200);return await r.json() as any;};
  const past=await read('2026-10'),current=await read('2026-11');
  assert.ok(past.companies[0].kpi_set.some((r:any)=>r.required===1));
  assert.ok(current.companies[0].kpi_set.every((r:any)=>r.required===0));
  assert.deepEqual(current.companies[0].fund_ids,[10]);assert.equal(current.companies[0].stage,'Seed');
  assert.equal(current.companies[0].due_days,12);assert.equal(current.companies[0].due_basis,'fund_rules');
 }finally{w.db.close();}
});

// Isolated source imports keep semantic mutants out of the working tree and concurrent checks.
test('semantic mutants cannot bypass ownership, atomic revision checks, history or stage requirements',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');const {createRequire}=await import('node:module');
 const {existsSync}=await import('node:fs');const {pathToFileURL}=await import('node:url');let serial=0;
 const moduleOf=async(path:string,text:string)=>{
  const url=new URL(path,import.meta.url),require=createRequire(url);
  const code=stripTypeScriptTypes(text,{mode:'strip'}).replace(/from\s+['"]([^'"]+)['"]/g,(_m,spec)=>{
   let target;
   if(spec.startsWith('.')){const u=new URL(spec,url);target=existsSync(u)?u.href:new URL(u.href+'.ts').href;}
   else target=pathToFileURL(require.resolve(spec)).href;
   return `from ${JSON.stringify(target)}`;
  });
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#6214-'+serial++);
 };
 const routePath='../src/routes/portfolio_reporting_settings.ts',route=readFileSync(new URL(routePath,import.meta.url),'utf8');
 const verifyRoute=async(module:any)=>{
  const w=world();w.app=new Hono<any>();w.app.route('/settings',module.default);
  w.app.onError((e:any,c:any)=>c.json({error:'Refused'},AUTH_ERROR_STATUSES[e.message]||500));
  try{
   const base=await call(w,2);assert.equal(base.status,200);const body={rules:base.body.all_rules,revision:base.body.revision,due_days:12};
   assert.equal((await call(w,3,'PUT','/10',body)).status,404);
   synchronizeRuleReads(w);
   const results=await Promise.all([call(w,2,'PUT','/10',body),call(w,2,'PUT','/10',{...body,due_days:14})]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   assert.equal((await call(w,2)).body.updated_by,2);
  }finally{w.db.close();}
 };
 await verifyRoute(await moduleOf(routePath,route));
 for(const [a,b]of [
  ['gp=await requireFundGp(c,id)','gp={user:await requireAuth(c),viaAdmin:false}'],
  ['WHERE ?=(SELECT h.id','WHERE ?<=(SELECT h.id'],
  ['month,quarter,user.id,b.revision','month,quarter,null,b.revision'],
 ]){assert.ok(route.includes(a));await assert.rejects(()=>moduleOf(routePath,route.replace(a,b)).then(verifyRoute),{name:'AssertionError'},'route mutant: '+a);}
 const servicePath='../src/services/portfolioReportingRules.ts',service=readFileSync(new URL(servicePath,import.meta.url),'utf8');
 const verifyService=async(module:any)=>{
  const w=world();try{
   const base=await call(w,2);const rules=base.body.all_rules.map((r:any)=>({...r,required:1,applies_to:'Growth'}));
   assert.equal((await call(w,2,'PUT','/10',{rules,revision:base.body.revision,due_days:12})).status,200);
   const past=await module.readReportingRules(w.env,10,'monthly','2026-10');assert.equal(past.inherited,true);
   const keys=await module.dutyReportingRuleKeys(w.env,{kind:'monthly_financials',required_figures:'[]',project_id:5,holder_user_id:2},'2026-11-30');assert.deepEqual(keys,[]);
  }finally{w.db.close();}
 };
 await verifyService(await moduleOf(servicePath,service));
 for(const [a,b]of [
  ["(CASE WHEN ?='monthly' THEN h.effective_month ELSE h.effective_quarter END)<=?",'(? IS NOT NULL AND ? IS NOT NULL)'],
  ["(rule.applies_to==='all'||rule.applies_to===fund.stage)",'true'],
 ]){assert.ok(service.includes(a));await assert.rejects(()=>moduleOf(servicePath,service.replace(a,b)).then(verifyService),{name:'AssertionError'});}
 await verifyRoute(await moduleOf(routePath,route));await verifyService(await moduleOf(servicePath,service));
});
