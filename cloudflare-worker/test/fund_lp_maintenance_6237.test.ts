/** D6237: mounted GP/act gates and accounting invariants on the complete migrated SQLite schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import router from '../src/routes/fund_lp_maintenance.ts';
import { LPs } from '../src/models/funds.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { schemaPath, SCHEMA_OPTIONS } from './_schema_once.mjs';
const schema = schemaPath();
const JWT_SECRET = 'synthetic-lp-maintenance-6237-secret';
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'lp-maintenance-6237-')), file=join(dir,'fixture.sqlite'); copyFileSync(schema,file);
  const db=new DatabaseSync(file,SCHEMA_OPTIONS);
  db.exec(`INSERT INTO users(id,email,name,role,is_active,investor_tier) VALUES
    (40,'gp@example.test','Synthetic GP','investor',1,'institutional'),
    (41,'other@example.test','Other GP','investor',1,'institutional'),
    (10,'account@example.test','Account identity','investor',1,'free');
    INSERT INTO vc_funds(id,name,gp_user_id,lp_count) VALUES (1,'Synthetic fund',40,2),(2,'Other fund',41,1);
    INSERT INTO limited_partners(id,fund_id,user_id,name,email,commitment_amount) VALUES
    (100,1,10,'Register identity','register@example.test',1000), (101,1,NULL,'Unlinked LP','unlinked@example.test',500),
    (200,2,NULL,'Other LP','foreign@example.test',700);`);
  const env:any={DB:d1Over(db),JWT_SECRET,ENVIRONMENT:'development'};
  const app=new Hono<any>().route('/api/funds',router);
  app.onError((error,c)=>c.json({error:error.message},500));
  return {db,env, close(){db.close();rmSync(dir,{recursive:true,force:true});},
    async call(method:string, lp=100, body?:unknown, who=40, fund=1, support=false) {
      const jwt=await new SignJWT({user_id:who,role:'investor',...(support?{impersonated_by:900}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
      const res=await app.request(`/api/funds/${fund}/lps/${lp}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt}`},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
      return {status:res.status,body:await res.json() as any};
    }, row(){return db.prepare('SELECT * FROM limited_partners WHERE id=100').get() as any;},
    audits(){return db.prepare("SELECT user_id,action,entity_type,entity_id,metadata,created_at FROM activity_logs WHERE action LIKE 'lp_%' ORDER BY id").all() as any[];},
    line(cents:number|null=25000){db.prepare("INSERT INTO capital_calls(id,limited_partner_id,amount,amount_cents,status) VALUES(900,100,250,?,'pending')").run(cents);},
  };
}
test('D6237 a GP corrects only the register, and the linked account stays untouched',async()=>{
  const f=fixture();try{
    const result=await f.call('PATCH',100,{name:'Corrected LP',email:'corrected@example.test',commitment_amount:0,status:'active'});
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(f.row().commitment_amount,0);assert.equal(f.row().status,'active');assert.equal(f.row().user_id,10);
    const list=await LPs.listByFund(f.env,1);assert.equal((list.results.find((r:any)=>r.id===100) as any).name,'Corrected LP');
    assert.deepEqual({...f.db.prepare('SELECT name,email FROM users WHERE id=10').get()},{name:'Account identity',email:'account@example.test'});
    const [audit]=f.audits();assert.equal(f.audits().length,1);assert.equal(audit.user_id,40);assert.equal(audit.action,'lp_corrected');
    assert.equal(audit.entity_id,'100');assert.ok(audit.created_at);assert.equal(JSON.parse(audit.metadata).fund_id,1);
  }finally{f.close();}
});
for(const body of [{fund_id:2},{user_id:41},{invested_amount:0},{lpa_signed:1},{status:'invented'},{commitment_amount:-1},{commitment_amount:'0'},{email:'not an address'},{}]) test(`D6237 refuses a closed-field or invalid patch ${JSON.stringify(body)}`,async()=>{
  const f=fixture();try{const result=await f.call('PATCH',100,body);assert.equal(result.status,400,JSON.stringify(result.body));assert.equal(f.row().commitment_amount,1000);assert.equal(f.row().name,'Register identity');assert.deepEqual(f.audits(),[]);}finally{f.close();}
});
for(const method of ['PATCH','DELETE']) test(`D6237 ${method} hides a foreign LP exactly like a missing LP and refuses another GP`,async()=>{
  const f=fixture();try{
    const missing=await f.call(method,999,{name:'Change'}),foreign=await f.call(method,200,{name:'Change'});
    assert.equal(missing.status,404);assert.deepEqual(foreign,missing);
    assert.equal((await f.call(method,100,{name:'Change'},41)).status,404);
    assert.deepEqual(f.audits(),[]);assert.equal(f.row().name,'Register identity');
  }finally{f.close();}
});
for(const cents of [null,25000]) test(`D6237 commitment floor uses ${cents===null?'legacy dollars':'integer cents'} and accepts the exact boundary`,async()=>{
  const f=fixture();try{
    f.line(cents);const refused=await f.call('PATCH',100,{commitment_amount:249.99});
    assert.equal(refused.status,409);assert.equal(refused.body.error,'lp_commitment_below_called');assert.match(JSON.stringify(refused.body),/already called/);
    assert.equal(f.row().commitment_amount,1000);assert.deepEqual(f.audits(),[]);
    assert.equal((await f.call('PATCH',100,{commitment_amount:250})).status,200);assert.equal(f.row().commitment_amount,250);assert.equal(f.audits().length,1);
  }finally{f.close();}
});
test('D6237 the commitment floor is rechecked in the mutation after a new call arrives',async()=>{
  const f=fixture();try{
    const original=f.env.DB.batch.bind(f.env.DB);let injected=false;
    f.env.DB.batch=async(statements:any[])=>{if(!injected){injected=true;f.line();}return original(statements);};
    assert.equal((await f.call('PATCH',100,{commitment_amount:0})).status,409);
    assert.equal(f.row().commitment_amount,1000);assert.deepEqual(f.audits(),[]);
  }finally{f.close();}
});
test('D6237 removal recounts LPs and leaves who and when in the audit',async()=>{
  const f=fixture();try{
    assert.equal((await f.call('DELETE')).status,200);assert.equal(f.row(),undefined);
    assert.equal(f.db.prepare('SELECT lp_count FROM vc_funds WHERE id=1').get()?.lp_count,1);
    const [audit]=f.audits();assert.equal(audit.user_id,40);assert.equal(audit.action,'lp_removed');assert.equal(audit.entity_id,'100');assert.ok(audit.created_at);
    assert.equal((await f.call('DELETE')).status,404);assert.equal(f.audits().length,1);
  }finally{f.close();}
});
for(const receipt of [false,true]) test(`D6237 removal refuses ${receipt?'a receipt without this LP’s call line':'any call line'}`,async()=>{
  const f=fixture();try{
    if(receipt){f.db.exec(`INSERT INTO capital_calls(id,limited_partner_id,amount,status) VALUES(901,101,100,'pending');
      INSERT INTO capital_call_receipts(uid,capital_call_id,limited_partner_id,fund_id,amount_cents,received_on,recorded_by) VALUES('synthetic',901,100,1,100,'2026-11-22',40);`);}else f.line();
    assert.equal((await f.call('DELETE')).status,409);assert.ok(f.row());assert.deepEqual(f.audits(),[]);
  }finally{f.close();}
});
for(const method of ['PATCH','DELETE']) test(`D6237 ${method} and audit roll back together if audit storage fails`,async()=>{
  const f=fixture();try{
    f.db.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON activity_logs BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    assert.equal((await f.call(method,100,{name:'Changed'})).status,500);
    assert.equal(f.row().name,'Register identity');assert.equal(f.db.prepare('SELECT lp_count FROM vc_funds WHERE id=1').get()?.lp_count,2);assert.deepEqual(f.audits(),[]);
  }finally{f.close();}
});

for(const method of ['PATCH','DELETE']) test(`D6237 ${method} is refused in a support session before any write`,async()=>{
  const f=fixture();try{
    const result=await f.call(method,100,{name:'Changed'},40,1,true);
    assert.equal(result.status,403);assert.equal(result.body.code,'support_session_refused');
    assert.equal(f.row().name,'Register identity');assert.deepEqual(f.audits(),[]);
  }finally{f.close();}
});
test('D6237 removal rechecks newly arrived history inside the mutation',async()=>{
  const f=fixture();try{
    const original=f.env.DB.batch.bind(f.env.DB);let injected=false;
    f.env.DB.batch=async(statements:any[])=>{if(!injected){injected=true;f.line();}return original(statements);};
    assert.equal((await f.call('DELETE')).status,409);assert.ok(f.row());assert.deepEqual(f.audits(),[]);
  }finally{f.close();}
});
