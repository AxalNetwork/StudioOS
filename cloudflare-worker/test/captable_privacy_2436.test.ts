import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';
import { simulate } from '../src/services/captable.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const secret='synthetic-cap-table-test-'.repeat(3);
const inputs={founders:[{name:'Synthetic',shares:100}],option_pool_pct:0};
function fixture(){
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 for(const t of ['users','projects','project_members','cap_table_scenarios','cap_table_holders','cap_table_securities','activity_logs','user_company_links']) db.exec(tableFromBaseline(baseline,t));
 const roles=['admin','partner','investor','founder','founder','advisor','partner','exploring','advisor'];
 roles.forEach((role,i)=>db.prepare("INSERT INTO users(id,role,name,email,founder_id,subscription_tier) VALUES(?,?,?,?,?,'studio')").run(i+1,role,'Synthetic',`user${i+1}@example.invalid`,i===3?40:null));
 db.exec("INSERT INTO projects(id,name,founder_id) VALUES(10,'Synthetic',40); INSERT INTO project_members(project_id,user_id,role,status) VALUES(10,5,'cofounder','accepted'),(10,6,'advisor','accepted'),(10,7,'cofounder','accepted'),(10,3,'cofounder','accepted'); INSERT INTO cap_table_holders(user_id,project_id,name,email) VALUES(4,10,'Synthetic holder','holder@example.invalid')");
 db.prepare("INSERT INTO cap_table_scenarios(uid,owner_user_id,project_id,name,inputs_json,result_json) VALUES('main',4,10,'Synthetic',?,?)").run(JSON.stringify(inputs),JSON.stringify(simulate(inputs)));
 return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
async function call(f:any,id:number,path:string,method='GET',body?:any,headers:Record<string,string>={}){
 const token=await new SignJWT({user_id:id}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 const res=await captable.request(path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})},f.env);
 return {status:res.status,body:await res.json().catch(()=>null)};
}
const paths=['/10','/scenarios/by-project/10','/scenarios/by-project/10/compare','/scenarios/main','/scenarios/main/export.csv','/409a/10'];
test('unrelated roles cannot read any cap-table surface or save',async()=>{
 const f=fixture();try{
  for(const id of [2,3,8,9]){
   for(const path of paths) assert.equal((await call(f,id,path)).status,403,`${id} ${path}`);
   assert.equal((await call(f,id,'/scenarios','POST',{project_id:10,name:'Synthetic',inputs})).status,403,`${id} save`);
  }
 }finally{f.db.close();}
});
test('owner, cofounder and admin read; advisors have no holder email or writes',async()=>{
 const f=fixture();try{
  for(const id of [1,4,5,7]) for(const path of paths) assert.equal((await call(f,id,path)).status,200,`${id} ${path}`);
  const advisor=await call(f,6,'/10');assert.equal(advisor.status,200);assert.equal('email' in advisor.body.holders[0],false);
  assert.equal((await call(f,5,'/10')).body.holders[0].email,'holder@example.invalid');
  assert.equal((await call(f,6,'/scenarios','POST',{project_id:10,name:'Synthetic',inputs})).status,403);
  const saved=await call(f,5,'/scenarios','POST',{project_id:10,name:'Synthetic',inputs});assert.equal(saved.status,200);
  assert.ok(f.db.prepare("SELECT id FROM activity_logs WHERE user_id=5 AND action='captable_member_write_authorized'").get());
 }finally{f.db.close();}
});
test('admin list is own-only; removed members and investor owners cannot bypass through scenarios',async()=>{
 const f=fixture();try{
  assert.deepEqual((await call(f,1,'/scenarios')).body.items,[]);
  f.db.prepare("INSERT INTO cap_table_scenarios(uid,owner_user_id,name,inputs_json) VALUES('admin-own',1,'Synthetic',?)").run(JSON.stringify(inputs));
  assert.deepEqual((await call(f,1,'/scenarios')).body.items.map((r:any)=>r.uid),['admin-own']);
  f.db.exec("UPDATE cap_table_scenarios SET owner_user_id=3 WHERE uid='main'");
  assert.deepEqual((await call(f,3,'/scenarios')).body.items,[]);
  assert.equal((await call(f,3,'/scenarios/main')).status,403);
  f.db.exec("UPDATE project_members SET status='removed' WHERE user_id=5");
  assert.equal((await call(f,5,'/scenarios/main')).status,403);
 }finally{f.db.close();}
});

test('non-writers cannot mutate scenarios, variants, sharing or 409A records',async()=>{
 const f=fixture();try{
  for(const id of [2,3,6,8,9]) for(const [method,path] of [
    ['PUT','/scenarios/main'],['DELETE','/scenarios/main'],['POST','/scenarios/by-project/10/variants'],
    ['POST','/scenarios/main/share'],['POST','/409a/10'],['POST','/409a/10/events'],['DELETE','/409a/10/events/1'],
  ]) assert.equal((await call(f,id,path,method,{name:'Synthetic',inputs})).status,403,`${id} ${method} ${path}`);
  f.db.exec("UPDATE project_members SET role='advisor' WHERE user_id=7");
  assert.equal((await call(f,7,'/scenarios','POST',{project_id:10,name:'Synthetic',inputs})).status,403);
  assert.equal((await call(f,7,'/10')).status,200);
 }finally{f.db.close();}
});
test('unattributed member write is refused before modifying the scenario',async()=>{
 const f=fixture();try{
  f.db.exec('DROP TABLE activity_logs');
  const r=await call(f,5,'/scenarios','POST',{project_id:10,name:'changed',inputs});
  assert.equal(r.status,500);
  assert.equal((f.db.prepare("SELECT name FROM cap_table_scenarios WHERE uid='main'").get() as any).name,'Synthetic');
 }finally{f.db.close();}
});

test('accepted members cross their own company selection; unrelated founders keep hidden-project responses',async()=>{
 const f=fixture();try{
  f.db.exec("UPDATE projects SET company_id=200 WHERE id=10; INSERT INTO user_company_links(uid,company_id,user_id) VALUES('synthetic-link',100,5)");
  const headers={'X-Company-Id':'100'};
  assert.equal((await call(f,5,'/10','GET',undefined,headers)).status,200);
  f.db.exec("UPDATE project_members SET status='removed' WHERE user_id=5");
  assert.equal((await call(f,5,'/10','GET',undefined,headers)).status,404);
  assert.equal((await call(f,5,'/scenarios/main','GET',undefined,headers)).status,404);
 }finally{f.db.close();}
});

test('a write that gates the same project twice reuses its membership answer and attribution',async()=>{
 const f=fixture();try{
  let reads=0;const prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=(sql:string)=>{if(sql.includes('SELECT role FROM project_members'))reads++;return prepare(sql);};
  const r=await call(f,5,'/scenarios/main','PUT',{project_id:10,name:'Synthetic',inputs});
  assert.equal(r.status,200);assert.equal(reads,3);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='captable_member_write_authorized'").get() as any).n,1);
 }finally{f.db.close();}
});

test('orphaned bound scenarios fail closed for owners and remain recoverable by admin',async()=>{
 const f=fixture();try{
  f.db.exec('DELETE FROM projects WHERE id=10');
  assert.deepEqual((await call(f,4,'/scenarios')).body.items,[]);
  assert.equal((await call(f,4,'/scenarios/main')).status,403);
  assert.equal((await call(f,4,'/scenarios/main','DELETE')).status,403);
  assert.equal((await call(f,1,'/scenarios/main')).status,200);
  assert.equal((await call(f,1,'/scenarios/main','DELETE')).status,200);
 }finally{f.db.close();}
});
