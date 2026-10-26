/** D1237 (#3250): real plan gate, routers and SQLite. No providers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals from '../src/routes/deals.ts';
import { requireInvestorTierExcept } from '../src/middleware/requireInvestorTier.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
const SECRET = 'synthetic-deal-flow-test-'.repeat(3);
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users','projects','partners','deals','deal_invitations','commitments','investor_dealroom_members','user_company_links','company_profiles','activity_logs','mi_pro_subscriptions','super_admins']) db.exec(tableFromBaseline(baseline,t));
  for (const [id,tier] of [[1,'free'],[2,'professional']] as const) {
    db.prepare("INSERT INTO users(id,role,email,name,investor_tier,investor_subscription_status,investor_dealroom_max) VALUES(?,'investor',?,'Synthetic',?,'active',5)").run(id,`synthetic${id}@example.invalid`,tier);
    db.prepare("INSERT INTO user_company_links(uid,user_id,company_id) VALUES(?,?,10),(?,?,20)").run(`a${id}`,id,`b${id}`,id);
  }
  db.exec("INSERT INTO projects(id,name) VALUES(10,'Synthetic venture'); INSERT INTO deals(id,project_id,status) VALUES(101,10,'active'),(102,10,'active'),(103,10,'active');");
  const env:any = { DB:d1Over(db), JWT_SECRET:SECRET, ENVIRONMENT:'development' };
  const app = new Hono<any>(); const gate = requireInvestorTierExcept('professional');
  app.use('/api/deals',gate); app.use('/api/deals/*',gate); app.route('/api/deals',deals);
  app.onError((e,c) => e instanceof Response ? e : c.json({error:e.message==='Unauthorized'?'Unauthorized':'fixture_error'}, e.message==='Unauthorized'?401:500));
  return {db,env,app};
}
async function call(f:ReturnType<typeof fixture>,who:number|null,method:string,path:string,firm?:number) {
  const headers:Record<string,string> = {};
  if(who) headers.Authorization='Bearer '+await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if(firm!==undefined) headers['X-Company-Id']=String(firm);
  const r=await f.app.request('/api/deals'+path,{method,headers},f.env);
  return {status:r.status,body:await r.json().catch(()=>({})) as any};
}
const rows=(f:ReturnType<typeof fixture>,who:number)=>f.db.prepare('SELECT deal_id,company_id FROM investor_dealroom_members WHERE investor_user_id=? ORDER BY deal_id').all(who);

test('a join records the verified firm; listing and quota membership do not follow it to another firm',async()=>{
  const f=fixture();try {
    assert.equal((await call(f,2,'POST','/101/dealroom/join',10)).status,200);
    assert.deepEqual(rows(f,2).map(r=>[r.deal_id,r.company_id]),[[101,10]]);
    for(const firm of [10,20]) {
      const list=await call(f,2,'GET','',firm);assert.equal(list.status,200);
      assert.equal(list.body.find((d:any)=>d.id===101).is_member,firm===10?1:0);
      const quota=await call(f,2,'GET','/dealroom/quota',firm);
      assert.deepEqual(quota.body.member_deal_ids,firm===10?[101]:[]);assert.equal(quota.body.used,1);
    }
    const again=await call(f,2,'POST','/101/dealroom/join',10);assert.equal(again.body.already_requested,true);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action='deal_invitation_requested'").get()!.n,1);
  }finally{f.db.close();}
});

test('a foreign-firm request is not claimed or removed; its own firm can leave it',async()=>{
  const f=fixture();try {
    await call(f,2,'POST','/101/dealroom/join',10);
    const other=await call(f,2,'POST','/101/dealroom/join',20);
    assert.equal(other.status,409);assert.equal(other.body.error,'room_requested_for_other_firm');
    await call(f,2,'DELETE','/101/dealroom/leave',20);assert.deepEqual(rows(f,2).map(r=>r.company_id),[10]);
    await call(f,2,'DELETE','/101/dealroom/leave',10);assert.deepEqual(rows(f,2),[]);
  }finally{f.db.close();}
});

test('leave audits the removed row’s firm, retaining NULL history and logging no replay',async()=>{
  const f=fixture();try {
    f.db.exec('INSERT INTO investor_dealroom_members(investor_user_id,deal_id,company_id) VALUES(2,101,10)');
    assert.equal((await call(f,2,'DELETE','/101/dealroom/leave')).status,200);
    f.db.exec('INSERT INTO investor_dealroom_members(investor_user_id,deal_id,company_id) VALUES(2,101,NULL)');
    assert.equal((await call(f,2,'DELETE','/101/dealroom/leave',20)).status,200);
    await call(f,2,'DELETE','/101/dealroom/leave',20);
    const audit=f.db.prepare("SELECT details FROM activity_logs WHERE action='dealroom_left' ORDER BY id").all();
    assert.deepEqual(audit.map(r=>JSON.parse(String(r.details)).company_id),[10,null]);
    assert.deepEqual(rows(f,2),[]);
  }finally{f.db.close();}
});

test('Free reads its quota, requests one room across firms, replays it, leaves and reuses its slot; the list stays Professional',async()=>{
  const f=fixture();try {
    assert.equal((await call(f,1,'GET','/dealroom/quota',10)).body.cap,1,'a stale paid allowance of five must not enlarge Free');
    assert.equal((await call(f,1,'POST','/101/dealroom/join',10)).status,200);
    assert.equal((await call(f,1,'POST','/101/dealroom/join',10)).body.already_requested,true);
    const second=await call(f,1,'POST','/102/dealroom/join',20);
    assert.equal(second.status,402);assert.equal(second.body.code,'quota_dealrooms_exhausted');assert.equal(second.body.used,1);
    assert.deepEqual(rows(f,1).map(r=>r.deal_id),[101]);
    await call(f,1,'DELETE','/101/dealroom/leave',10);
    assert.equal((await call(f,1,'POST','/102/dealroom/join',20)).status,200);
    for(const [method,path] of [['GET',''],['GET','/101/documents'],['POST','/101/commitments'],['GET','/101/dealroom/join'],['POST','/101/dealroom/leave'],['POST','/101/dealroom/join/extra'],['POST','/abc/dealroom/join']]) {
      const r=await call(f,1,method,path,10);assert.equal(r.status,402,method+' '+path);assert.equal(r.body.required,'professional');
    }
    assert.equal((await call(f,null,'POST','/103/dealroom/join')).status,401);
  }finally{f.db.close();}
});

test('the INSERT protects the last Free slot even when the earlier count is stale',async()=>{
  const f=fixture();try {
    await call(f,1,'POST','/101/dealroom/join',10);
    const prepare=f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare=(sql:string)=>{const q=prepare(sql);if(sql.includes('SELECT COUNT(*) AS n FROM investor_dealroom_members'))q.first=async()=>({n:0});return q;};
    const r=await call(f,1,'POST','/102/dealroom/join',20);
    assert.equal(r.status,402);assert.equal(r.body.code,'quota_dealrooms_exhausted');assert.deepEqual(rows(f,1).map(r=>r.deal_id),[101]);
  }finally{f.db.close();}
});

test('requests accept the panel’s live stages and refuse rejected, deleted and unknown deals without a write',async()=>{
  for(const who of [1,2]) {
    const f=fixture();try {
      for(const status of ['applied','scored','active','funded']) {
        f.db.prepare('UPDATE deals SET status=? WHERE id=101').run(status);
        assert.equal((await call(f,who,'POST','/101/dealroom/join',10)).status,200,status);
        await call(f,who,'DELETE','/101/dealroom/leave',10);
      }
      f.db.exec('DELETE FROM activity_logs');
      f.db.exec("UPDATE deals SET status='rejected' WHERE id=101");
      const rejected=await call(f,who,'POST','/101/dealroom/join',10);
      f.db.exec("UPDATE deals SET status='active' WHERE id=101; UPDATE projects SET deleted_at=datetime('now') WHERE id=10");
      const deleted=await call(f,who,'POST','/101/dealroom/join',10);
      const unknown=await call(f,who,'POST','/999/dealroom/join',10);
      for(const result of [rejected,deleted,unknown]) {
        assert.equal(result.status,404);assert.deepEqual(result.body,{error:'deal_not_found'});
      }
      assert.deepEqual(rows(f,who),[]);
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_logs').get()!.n,0);
    }finally{f.db.close();}
  }
});

test('a UNIQUE race rechecks the stored firm instead of claiming another firm’s request',async()=>{
  const f=fixture();try {
    const prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;
    f.env.DB.prepare=(sql:string)=>{const q=prepare(sql);if(sql.includes('INSERT INTO investor_dealroom_members')){const run=q.run.bind(q);q.run=async()=>{if(!raced){raced=true;f.db.exec('INSERT INTO investor_dealroom_members(investor_user_id,deal_id,company_id) VALUES(2,101,10)');}return run();};}return q;};
    const r=await call(f,2,'POST','/101/dealroom/join',20);assert.equal(r.status,409);assert.equal(r.body.error,'room_requested_for_other_firm');
    assert.deepEqual(rows(f,2).map(r=>r.company_id),[10]);
  }finally{f.db.close();}
});

test('the list marks only invited or committed rows as readable; a room request grants no access',async()=>{
  const f=fixture();try {
    await call(f,2,'POST','/101/dealroom/join',10);
    f.db.exec("INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES(102,2,20); INSERT INTO commitments(uid,deal_id,investor_user_id,company_id,amount,status) VALUES('synthetic',103,2,10,100,'pending');");
    const list=await call(f,2,'GET','',10);assert.equal(list.status,200);
    assert.deepEqual(list.body.map((d:any)=>[d.id,d.can_read]).sort((a:any,b:any)=>a[0]-b[0]),[[101,false],[102,true],[103,true]]);
    assert.equal((await call(f,2,'GET','/101',10)).status,403);
    for(const id of [102,103])assert.equal((await call(f,2,'GET',`/${id}`,10)).status,200);
    const mine=await call(f,2,'GET','?scope=mine',10);assert.deepEqual(mine.body.map((d:any)=>d.id),[103]);
  }finally{f.db.close();}
});

test('an unverified firm header is never persisted, and legacy NULL requests retain their visibility',async()=>{
  const f=fixture();try {
    assert.equal((await call(f,2,'POST','/101/dealroom/join',999)).status,200);
    assert.deepEqual(rows(f,2).map(r=>r.company_id),[null]);
    assert.equal((await call(f,2,'POST','/101/dealroom/join',20)).body.already_requested,true);
    assert.deepEqual((await call(f,2,'GET','/dealroom/quota',20)).body.member_deal_ids,[101]);
  }finally{f.db.close();}
});
