import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { loadAiBudget, reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { run, __resetForTest } from '../src/services/aiRouter.ts';
import budgetRoute from '../src/routes/ai_budget.ts';

import { guardSafe } from './_guard_stub.mjs';
// Midday today: the /me read below uses the real clock, so a fixed date stops
// matching its day window the day after it was written.
const now=new Date();now.setUTCHours(12,0,0,0);
const fixture=()=>{const f=aiBudgetFixture();return {...f,env:{DB:f.DB,JWT_SECRET:'budget-fixture-only-key',ENVIRONMENT:'development'} as any};};
const count=(db:any,table:string)=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function request(f:any,path:string,userId:number,method='GET',body?:unknown) {
  const token=await new SignJWT({user_id:userId}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(f.env.JWT_SECRET));
  return budgetRoute.request(path,{method,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
}
function hold(f:any,userId:number,quote:number) {
  return reserveAiBudget(f.env,userId,quote,now).then(async result=>{
    if (!result.ok) throw Error('reservation failed');
    await assert.rejects(()=>settleAiReservation(f.env,result.reservation,quote+100000),/exceeds/);
    return result.reservation.uid;
  });
}

test('D640: a real router overage reaches the hold and the next run never calls the provider',async()=>{
  __resetForTest();const f=fixture();try {
    let calls=0;
    // D763: the guard answers free, so `calls` and the overage are the model's alone.
    f.env.AI={run:guardSafe(async()=>{calls++;return {response:'answer',usage:{prompt_tokens:1000000,completion_tokens:1000000}};})};
    const first=await run(f.env,{task:'advisor_turn',userId:2,text:'hello'});
    assert.equal(first.refusal,'misconfigured');
    const holdRow=f.db.prepare('SELECT * FROM ai_budget_reservations WHERE user_id=2').get();
    assert.equal(holdRow.status,'review');
    assert.ok(holdRow.recorded_cost_microusd>holdRow.included_microusd+holdRow.topup_microusd);
    assert.equal((await request(f,'/me',2)).status,200);
    const next=await run(f.env,{task:'advisor_turn',userId:2,text:'another run'});
    assert.equal(next.refusal,'budget_review');
    assert.match(next.error||'',/held for review/);
    assert.equal(calls,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_usage_logs WHERE task<>'safety'").get().n,2);
  }finally{f.db.close();}
});

test('D640: held overage remains visible to its member, blocks new runs, and charges at most the hold once',async()=>{
  const f=fixture();try {
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',500000,1000000,1)").run();
    await loadAiBudget(f.env,2,now);
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd=1000000 WHERE user_id=2').run();
    const uid=await hold(f,2,800000);
    const row=f.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').get(uid);
    assert.equal(row.status,'review');
    assert.equal(row.recorded_cost_microusd,900000);
    assert.deepEqual([row.included_microusd,row.topup_microusd],[500000,300000]);
    const self=await request(f,'/me',2);assert.equal(self.status,200);
    const report=await self.json() as any;
    assert.equal(report.day_reserved_microusd,500000);
    assert.equal(report.topup_reserved_microusd,300000);
    assert.equal(report.balance_microusd,700000);
    assert.deepEqual(report.held_for_review.map((r:any)=>({uid:r.uid,held:r.held_microusd,cost:r.recorded_cost_microusd})),
      [{uid,held:800000,cost:900000}]);
    assert.ok(report.held_for_review[0].at);
    assert.deepEqual(await reserveAiBudget(f.env,2,100,now),{ok:false,refusal:'budget_review'});
    const forbidden=await request(f,'/reviews',2);assert.equal(forbidden.status,403);
    assert.match((await forbidden.json() as any).message,/cannot access/);
    assert.equal((await request(f,`/reviews/${uid}/charge`,2,'POST',{reason:'member requested charge'})).status,403);
    assert.equal((await request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'short'})).status,400);
    assert.equal((await request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'          '})).status,400);
    assert.equal(count(f.db,'activity_logs'),0);
    const otherUid=await hold(f,3,100000);
    const list=await request(f,'/reviews',1);assert.equal(list.status,200);
    const items=(await list.json() as any).items;
    assert.equal(items.length,2);
    assert.deepEqual(items.map((r:any)=>({uid:r.uid,member:r.member_name,held:r.held_microusd,cost:r.recorded_cost_microusd}))
      .sort((a:any,b:any)=>a.member.localeCompare(b.member)),
      [{uid:otherUid,member:'Investor',held:100000,cost:200000},{uid,member:'Member',held:800000,cost:900000}]);
    const expected=JSON.stringify(report.held_for_review);
    f.db.prepare('UPDATE ai_budget_reservations SET recorded_cost_microusd=900001 WHERE uid=?').run(uid);
    assert.notEqual(JSON.stringify((await (await request(f,'/me',2)).json() as any).held_for_review),expected,
      'cost mutation changes the member read');
    f.db.prepare('UPDATE ai_budget_reservations SET recorded_cost_microusd=900000 WHERE uid=?').run(uid);
    assert.equal(JSON.stringify((await (await request(f,'/me',2)).json() as any).held_for_review),expected,
      'restored cost restores the member read');
    const [a,b]=await Promise.all([
      request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'The platform absorbs overage'}),
      request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'The platform absorbs overage'}),
    ]);
    assert.deepEqual([a.status,b.status],[200,200]);
    assert.deepEqual([(await a.json() as any).already_settled,(await b.json() as any).already_settled].sort(),[false,true]);
    assert.equal((await request(f,`/reviews/${uid}/refund`,1,'POST',{reason:'Refund after charge rejected'})).status,409);
    assert.equal(count(f.db,'activity_logs'),1);
    // D755: the spend is the 486 trigger's ai_credit_ledger row; no draw is written any more.
    assert.equal(count(f.db,'ai_topup_ledger'),0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE kind='spend'").get().n,1);
    const audit=f.db.prepare('SELECT action,details,actor,user_id FROM activity_logs').get();
    assert.deepEqual([audit.action,audit.actor,audit.user_id],['ai_budget_review_charge','1',2]);
    assert.deepEqual(JSON.parse(audit.details),{reservation_uid:uid,member_id:2,held_microusd:800000,
      recorded_cost_microusd:900000,charged_microusd:800000,absorbed_microusd:100000,
      included_microusd:500000,topup_microusd:300000,reason:'The platform absorbs overage'});
    assert.equal(f.db.prepare("SELECT delta_microusd FROM ai_credit_ledger WHERE kind='spend'").get().delta_microusd,-300000);
    assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,500000);
    assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,700000);
    assert.deepEqual((await loadAiBudget(f.env,2,now)).held_for_review,[]);
  }finally{f.db.close();}
});

test('D640: refund releases both kinds of hold once, and invalid states never write',async()=>{
  const f=fixture();try {
    f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('investor:free',50000,50000,1)").run();
    await loadAiBudget(f.env,3,now);
    f.db.prepare('UPDATE ai_topup_accounts SET balance_microusd=200000 WHERE user_id=3').run();
    const pending=await reserveAiBudget(f.env,2,100,now);if(!pending.ok)throw Error('pending reserve failed');
    assert.equal((await request(f,`/reviews/${pending.reservation.uid}/charge`,1,'POST',{reason:'Cannot settle a pending hold'})).status,409);
    assert.equal((await request(f,'/reviews/missing/refund',1,'POST',{reason:'Cannot find this hold'})).status,404);
    const uid=await hold(f,3,100000);
    assert.deepEqual({...f.db.prepare('SELECT included_microusd,topup_microusd FROM ai_budget_reservations WHERE uid=?').get(uid)},
      {included_microusd:50000,topup_microusd:50000});
    assert.equal((await loadAiBudget(f.env,3,now)).balance_microusd,150000);
    const first=await request(f,`/reviews/${uid}/refund`,1,'POST',{reason:'Refund full held amount'});
    assert.equal(first.status,200);assert.equal((await first.json() as any).charged_microusd,0);
    const again=await request(f,`/reviews/${uid}/refund`,1,'POST',{reason:'Refund full held amount'});
    assert.equal(again.status,200);assert.equal((await again.json() as any).already_settled,true);
    assert.equal((await request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'Charge after refund rejected'})).status,409);
    assert.equal((await loadAiBudget(f.env,3,now)).balance_microusd,200000);
    assert.equal((await loadAiBudget(f.env,3,now)).day_spend_microusd,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE kind='spend'").get().n,0);
    assert.equal(count(f.db,'activity_logs'),1);
    const audit=f.db.prepare('SELECT action,actor,details FROM activity_logs').get();
    assert.equal(audit.action,'ai_budget_review_refund');assert.equal(audit.actor,'1');
    assert.equal(JSON.parse(audit.details).absorbed_microusd,200000);
    assert.equal(f.db.prepare('SELECT MIN(balance_microusd) AS n FROM ai_topup_accounts').get().n,0);
  }finally{f.db.close();}
});

test('D640: audit write failure rolls back the charge and allows retry',async()=>{
  const f=fixture();try {
    const uid=await hold(f,2,100000);
    f.db.exec("DROP TABLE activity_logs; CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,action TEXT CHECK(action!='ai_budget_review_charge'),details TEXT,actor TEXT,user_id INTEGER)");
    assert.equal((await request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'First charge must roll back'})).status,503);
    assert.equal(f.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(uid).status,'review');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE kind IN ('release','spend')").get().n,0);
    assert.equal((await loadAiBudget(f.env,2,now)).day_reserved_microusd,100000);
    f.db.exec('DROP TABLE activity_logs; CREATE TABLE activity_logs(id INTEGER PRIMARY KEY,action TEXT,details TEXT,actor TEXT,user_id INTEGER)');
    assert.equal((await request(f,`/reviews/${uid}/charge`,1,'POST',{reason:'Retry after audit repair'})).status,200);
    assert.equal(count(f.db,'activity_logs'),1);
  }finally{f.db.close();}
});

test('D640: Super Admin lists all ten plans in licence order with recorded attribution or environment source',async()=>{
  const f=fixture();try {
    f.env.WORKERS_AI_BUDGET_USD_DAY='7';f.env.WORKERS_AI_BUDGET_USD_MONTH='70';
    assert.equal((await request(f,'/caps',2)).status,403);
    f.db.prepare("UPDATE users SET role='admin' WHERE id=4").run();
    assert.equal((await request(f,'/caps',4)).status,403);
    const before=await request(f,'/caps',1);assert.equal(before.status,200);
    const plans=(await before.json() as any).plans;
    assert.deepEqual(plans.map((r:any)=>r.licence_key),
      ['founder:free','founder:growth','founder:studio','investor:free','investor:professional','investor:institutional','advisor','partner','admin','other']);
    assert.ok(plans.every((r:any)=>r.source==='environment' && r.daily_microusd===7000000 && r.monthly_microusd===70000000));
    assert.equal((await request(f,'/caps/founder:free',1,'PUT',{daily_usd:0,monthly_usd:12})).status,200);
    const after=await request(f,'/caps',1);assert.equal(after.status,200);
    const current=(await after.json() as any).plans;
    assert.deepEqual({source:current[0].source,day:current[0].daily_microusd,month:current[0].monthly_microusd,
      actor:current[0].recorded_by,name:current[0].recorded_by_name},
      {source:'recorded',day:0,month:12000000,actor:1,name:'Owner'});
    assert.ok(current[0].recorded_at);assert.equal(current[1].source,'environment');
    f.db.prepare("UPDATE ai_licence_caps SET daily_microusd=1 WHERE licence_key='founder:free'").run();
    const mutated=(await (await request(f,'/caps',1)).json() as any).plans;
    assert.notEqual(mutated[0].daily_microusd,current[0].daily_microusd);
    f.db.prepare("UPDATE ai_licence_caps SET daily_microusd=0 WHERE licence_key='founder:free'").run();
    const restored=(await (await request(f,'/caps',1)).json() as any).plans;
    assert.equal(restored[0].daily_microusd,current[0].daily_microusd);
    f.db.exec('DROP TABLE ai_licence_caps');
    assert.equal((await request(f,'/caps',1)).status,503);
    f.db.exec('DROP TABLE ai_budget_reservations');
    assert.equal((await request(f,'/reviews',1)).status,503);
  }finally{f.db.close();}
});
