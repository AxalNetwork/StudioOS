import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { aiLicenceKey, environmentAiCaps, resolveAiCaps, loadAiBudget, reserveAiBudget, settleAiReservation, usdToMicro } from '../src/services/aiBudget.ts';
import { aiTopupPriceId, recordAiTopupPurchase, creditAiTopupFromPayment } from '../src/services/aiTopups.ts';
import { run, __resetForTest, ROUTE, estimateCostUsd } from '../src/services/aiRouter.ts';
import budgetRoute from '../src/routes/ai_budget.ts';
import billingRoute from '../src/routes/billing.ts';
import ordersRoute from '../src/routes/orders.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { readAiTopupProduct, resetAiTopupMirrorWindow } from '../src/services/aiTopups.ts';
import { spawnSync } from 'node:child_process';
import { ensureCatalogSchema } from '../src/services/catalog.ts';

const now=new Date('2026-10-07T12:00:00Z');
const fixture=()=>{const f=aiBudgetFixture();return {...f,env:{DB:f.DB,JWT_SECRET:'d629-fixture-only-signing-secret',STRIPE_WEBHOOK_SECRET:'d629-fixture-only-webhook-secret',ENVIRONMENT:'development'} as any};};
const caps=(db:any,day=1000000,month=3000000)=>db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',?,?,1)").run(day,month);
const count=(db:any,table:string)=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
// D755: a webhook credit is one ai_credit_ledger purchase row; ai_topup_ledger is no longer written.
const purchases=(db:any)=>db.prepare("SELECT COUNT(*) n FROM ai_credit_ledger WHERE kind='purchase'").get().n;
async function buy(f:any,amount=10000000,id='pi_topup',user=2) {
 await recordAiTopupPurchase(f.env,{paymentIntentId:id,orderRef:'order1',userId:user,totalCents:amount/10000,currency:'usd',quote:{priceId:'price_owner',creditMicrousd:amount}});
 return {id,status:'succeeded',currency:'usd',amount_received:amount/10000,metadata:{kind:'cart_order',order_ref:'order1',user_id:String(user)}};
}
test('D629 caps use canonical effective tiers and an explicit zero override; environment is fallback',async()=>{
 const f=fixture();try {
  assert.deepEqual(environmentAiCaps({WORKERS_AI_BUDGET_USD_DAY:'12',WORKERS_AI_BUDGET_USD_MONTH:'250'} as any),{day:12,month:250,orgMonth:5000});
  assert.deepEqual(environmentAiCaps({WORKERS_AI_BUDGET_USD_DAY:'NaN',WORKERS_AI_BUDGET_USD_MONTH:'-1'} as any),{day:5,month:50,orgMonth:5000});
  assert.equal(aiLicenceKey({role:'founder',subscription_tier:'studio',subscription_status:'active'}),'founder:studio');
  assert.equal(aiLicenceKey({role:'founder',subscription_tier:'growth',subscription_status:'active'}),'founder:growth');
  assert.equal(aiLicenceKey({role:'founder',subscription_tier:'studio',subscription_status:'past_due'}),'founder:free');
  assert.equal(aiLicenceKey({role:'founder',subscription_tier:'studio',subscription_status:'partner_grant',subscription_renews_at:'2000-01-01'}),'founder:free');
  assert.equal(aiLicenceKey({role:'investor',investor_tier:'institutional',investor_subscription_status:'active'}),'investor:institutional');
  assert.equal(aiLicenceKey({role:'investor',investor_tier:'professional',investor_subscription_status:'unpaid'}),'investor:free');
  assert.equal(aiLicenceKey({role:'advisor'}),'advisor'); assert.equal(aiLicenceKey({role:'unknown'}),'other');
  assert.deepEqual(await resolveAiCaps(f.env,2),{licence:'founder:free',source:'environment',daily_microusd:5000000,monthly_microusd:50000000});
  caps(f.db,0,2000000);
  assert.deepEqual(await resolveAiCaps(f.env,2),{licence:'founder:free',source:'recorded',daily_microusd:0,monthly_microusd:2000000});
  assert.equal((await resolveAiCaps(f.env,3)).source,'environment');
  await assert.rejects(()=>resolveAiCaps(f.env,999),/unreadable/);
  assert.equal(usdToMicro(.0000001),1); assert.equal(usdToMicro(1.234567),1234567);
  for(const value of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER]) assert.throws(()=>usdToMicro(value),/unreadable/);
 }finally{f.db.close();}
});
test('included daily/monthly allowance draws first, paid balance follows, settlement refunds unused quote and cannot replay',async()=>{
 const f=fixture();try {
  caps(f.db);const pi=await buy(f);await creditAiTopupFromPayment(f.env,pi);
  const one=await reserveAiBudget(f.env,2,800000,now);if(!one.ok)throw Error('reserve');
  await settleAiReservation(f.env,one.reservation,500000);
  const two=await reserveAiBudget(f.env,2,1000000,now);if(!two.ok)throw Error('reserve');
  assert.deepEqual({...f.db.prepare('SELECT included_microusd,topup_microusd FROM ai_budget_reservations WHERE uid=?').get(two.reservation.uid)},{included_microusd:500000,topup_microusd:500000});
  const held=await loadAiBudget(f.env,2,now); assert.equal(held.day_spend_microusd,500000);assert.equal(held.month_spend_microusd,500000);assert.equal(held.day_reserved_microusd,500000);assert.equal(held.balance_microusd,9500000);
  await Promise.all([settleAiReservation(f.env,two.reservation,750000),settleAiReservation(f.env,two.reservation,750000)]);
  await settleAiReservation(f.env,two.reservation,750000);
  const report=await loadAiBudget(f.env,2,now);
  assert.equal(report.day_spend_microusd,1000000);assert.equal(report.month_spend_microusd,1000000);assert.equal(report.balance_microusd,9750000);assert.equal(report.topup_reserved_microusd,0);
  // D755: the spend is the 486 trigger's ai_credit_ledger row; no draw is written any more.
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM ai_topup_ledger WHERE kind='draw'").get().n,0);
  assert.deepEqual(f.db.prepare("SELECT kind,delta_microusd,actor FROM ai_credit_ledger WHERE kind='spend'").all().map((r:any)=>({...r})),[{kind:'spend',delta_microusd:-250000,actor:'2'}]);
  assert.equal((await loadAiBudget(f.env,3,now)).balance_microusd,0);
 }finally{f.db.close();}
});
test('daily and monthly exhausted refusals; simultaneous calls cannot overspend a paid balance',async()=>{
 const f=fixture();try{
  caps(f.db,0,0);const pi=await buy(f,1000000);await creditAiTopupFromPayment(f.env,pi);
  const reservations=await Promise.all([reserveAiBudget(f.env,2,700000,now),reserveAiBudget(f.env,2,700000,now)]);
  assert.equal(reservations.filter(x=>x.ok).length,1);
  assert.equal(reservations.filter(x=>!x.ok)[0]?.refusal,'budget_user_day');
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,300000);
  for(const r of reservations) if(r.ok)await settleAiReservation(f.env,r.reservation,700000);
  f.db.prepare("UPDATE ai_licence_caps SET daily_microusd=1000000,monthly_microusd=0").run();
  assert.deepEqual(await reserveAiBudget(f.env,2,400000,now),{ok:false,refusal:'budget_user_month'});
  assert.equal(count(f.db,'ai_budget_reservations'),1);
 }finally{f.db.close();}
});
test('failed model and expired holds return allowance and paid balance, including across UTC periods',async()=>{
 const f=fixture();try{
  caps(f.db,0,0);await creditAiTopupFromPayment(f.env,await buy(f,1000000));
  const r=await reserveAiBudget(f.env,2,400000,now);if(!r.ok)throw Error('reserve');
  await settleAiReservation(f.env,r.reservation,0,true);
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,1000000);
  const pending=await reserveAiBudget(f.env,2,500000,now);if(!pending.ok)throw Error('reserve');
  const next=await loadAiBudget(f.env,2,new Date('2026-11-01T12:00:00Z'));
  assert.equal(next.balance_microusd,1000000);assert.equal(next.day_spend_microusd,0);assert.equal(next.month_spend_microusd,0);
  assert.equal(f.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(pending.reservation.uid).status,'refunded');
  assert.equal(purchases(f.db),1);
 }finally{f.db.close();}
});
test('existing spend seeds allowance once, then paid usage cannot consume the included allowance again',async()=>{
 const f=fixture();try{
  f.db.prepare("INSERT INTO ai_usage_logs(user_id,task,model,est_cost_usd,created_at) VALUES(2,'explain','model',.8,'2026-10-07 10:00:00')").run();
  assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,800000);
  f.db.exec('DELETE FROM ai_included_spend');
  f.env.AI_SPEND={get:async()=>'.9'};caps(f.db);
  assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,900000);
  f.env.AI_SPEND.get=async()=>'8';
  assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,900000);
  f.env.AI_SPEND.get=async()=>{throw Error('legacy KV unavailable');};
  assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,900000);
 }finally{f.db.close();}
});
test('a concurrent first read cannot replace an included counter another request already used',async()=>{
 const f=fixture();try{
  let inserted=false;
  f.env.DB={...f.DB,prepare(sql:string){
    const statement=f.DB.prepare(sql);
    return {...statement,bind(...values:any[]){
      const bound=statement.bind(...values);
      if(sql.startsWith('SELECT spend_microusd FROM ai_included_spend') && values[1]==='day' && !inserted){
        return {...bound,async first(){
          const before=await bound.first();
          if(!before && !inserted){inserted=true;f.db.prepare("INSERT INTO ai_included_spend(user_id,period_kind,period_key,spend_microusd) VALUES(2,'day','2026-10-07',500000),(2,'month','2026-10',500000)").run();}
          return before;
        }};
      }
      return bound;
    }};
  }};
  assert.equal((await loadAiBudget(f.env,2,now)).day_spend_microusd,500000);
 }finally{f.db.close();}
});
test('a failed read or D1 success:false is unreadable; no guessed balance or provider call',async()=>{
 const f=fixture();try{
  f.db.exec('DROP TABLE ai_topup_accounts');await assert.rejects(()=>loadAiBudget(f.env,2,now));
  let calls=0;f.env.AI={run:async()=>{calls++;return{response:'text'};}};
  const r=await run(f.env,{task:'advisor_turn',userId:2,text:'hello'});
  assert.equal(r.ok,false);assert.match(r.error||'',/Unreadable/);assert.equal(calls,0);
 }finally{f.db.close();}
 const g=fixture();try{
  await loadAiBudget(g.env,2,now);
  g.env.DB={...g.DB,batch:async(statements:any[])=>statements.map(()=>({success:false,meta:{changes:0}}))};await assert.rejects(()=>reserveAiBudget(g.env,2,100,now),/unreadable/);
 }finally{g.db.close();}
});
test('webhook credits exactly once, validates all payment fields, and ignores ordinary orders',async()=>{
 const f=fixture();try{
  const pi=await buy(f,12340000);
  await recordAiTopupPurchase(f.env,{paymentIntentId:'pi_ordinary',orderRef:'ordinary',userId:2,totalCents:100,currency:'usd',quote:null});
  assert.equal(count(f.db,'ai_topup_purchases'),1);
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,0);
  for(const altered of [{status:'processing'},{currency:'eur'},{amount_received:1},{metadata:{...pi.metadata,user_id:'3'}},{metadata:{...pi.metadata,order_ref:'wrong'}}])
    await assert.rejects(()=>creditAiTopupFromPayment(f.env,{...pi,...altered}),/match/);
  assert.equal(await creditAiTopupFromPayment(f.env,pi),true);
  assert.equal(await creditAiTopupFromPayment(f.env,pi),false);
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,12340000);
  assert.equal(purchases(f.db),1);assert.equal(count(f.db,'activity_logs'),1);
  assert.equal(f.db.prepare("SELECT actor FROM ai_credit_ledger WHERE kind='purchase'").get().actor,'payment_webhook');
  assert.equal(await creditAiTopupFromPayment(f.env,{...pi,id:'pi_ordinary'}),false);
  assert.equal((await loadAiBudget(f.env,3,now)).balance_microusd,0);
  assert.ok(f.db.prepare('SELECT credited_at FROM ai_topup_purchases').get().credited_at);
 }finally{f.db.close();}
});
test('credit audit failure rolls back balance, ledger and credited state; retry recovers',async()=>{
 const f=fixture();try{
  const pi=await buy(f);f.db.exec("DROP TABLE activity_logs; CREATE TABLE activity_logs(action TEXT CHECK(action!='ai_topup_credited'),details TEXT,actor TEXT,user_id INTEGER)");
  await assert.rejects(()=>creditAiTopupFromPayment(f.env,pi));
  assert.equal(purchases(f.db),0);assert.equal(f.db.prepare('SELECT credited_at FROM ai_topup_purchases').get().credited_at,null);
  assert.equal(count(f.db,'ai_topup_accounts'),0);
  f.db.exec('DROP TABLE activity_logs; CREATE TABLE activity_logs(action TEXT,details TEXT,actor TEXT,user_id INTEGER)');
  assert.equal(await creditAiTopupFromPayment(f.env,pi),true);assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,10000000);
 }finally{f.db.close();}
});
test('a confirmed signed webhook credits a persisted checkout quote once; unsigned requests credit nothing',async()=>{
 const f=fixture();try{
  const pi=await buy(f);
  await ensureOrdersSchema(f.env);
  f.db.prepare("INSERT INTO orders(id,order_ref,user_id,status,payment_intent_id,items_json) VALUES('order-id','order1',2,'paid','pi_topup','[]')").run();
  const body=JSON.stringify({id:'evt_topup',type:'payment_intent.succeeded',data:{object:pi}});
  assert.equal((await billingRoute.request('/stripe/webhook',{method:'POST',body},f.env)).status,400);
  assert.equal(purchases(f.db),0);
  const timestamp=Math.floor(Date.now()/1000);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(f.env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const headers={'stripe-signature':`t=${timestamp},v1=${signature}`,'content-type':'application/json'};
  const response=await billingRoute.request('/stripe/webhook',{method:'POST',headers,body},f.env);
  assert.equal(response.status,200,await response.text());
  assert.equal((await billingRoute.request('/stripe/webhook',{method:'POST',headers,body},f.env)).status,200);
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,10000000);
  assert.equal(purchases(f.db),1);
 }finally{f.db.close();}
});
test('cap writes are Super Admin only, audited atomically, and self reads ignore another requested account',async()=>{
 const f=fixture();try{
  async function request(path:string,user:number,method='GET',body?:any) {
    const jwt=await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
    return budgetRoute.request(path,{method,headers:{Authorization:`Bearer ${jwt}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
  }
  assert.equal((await request('/caps/founder:free',2,'PUT',{daily_usd:1,monthly_usd:2})).status,403);
  f.db.prepare("UPDATE users SET role='admin' WHERE id=4").run();
  assert.equal((await request('/caps/founder:free',4,'PUT',{daily_usd:1,monthly_usd:2})).status,403);
  assert.equal((await request('/caps/unrecognised',1,'PUT',{daily_usd:1,monthly_usd:2})).status,400);
  assert.equal((await request('/caps/founder:free',1,'PUT',{daily_usd:-1,monthly_usd:2})).status,400);
  assert.equal((await request('/caps/founder:free',1,'PUT',{daily_usd:0,monthly_usd:2})).status,200);
  assert.equal((await resolveAiCaps(f.env,2)).daily_microusd,0);
  const audit=f.db.prepare('SELECT actor,details FROM activity_logs').get();
  assert.equal(audit.actor,'1');assert.deepEqual(JSON.parse(audit.details),{licence_key:'founder:free',daily_microusd:0,monthly_microusd:2000000});
  await creditAiTopupFromPayment(f.env,await buy(f));
  const self=await (await request('/me?user_id=3',2)).json() as any;assert.equal(self.balance_microusd,10000000);
  assert.equal((await (await request('/me?user_id=2',3)).json() as any).balance_microusd,0);
  f.db.exec("DROP TABLE activity_logs; CREATE TABLE activity_logs(action TEXT CHECK(action!='ai_licence_caps_recorded'),details TEXT,actor TEXT,user_id INTEGER)");
  assert.equal((await request('/caps/founder:free',1,'PUT',{daily_usd:3,monthly_usd:4})).status,503);
  assert.equal((await resolveAiCaps(f.env,2)).monthly_microusd,2000000);
 }finally{f.db.close();}
});
test('checkout confirmation never credits AI balance even when a paid top-up purchase exists',async()=>{
 const f=fixture();const fetchBefore=globalThis.fetch;try{
  const pi=await buy(f);await ensureOrdersSchema(f.env);
  f.db.prepare("INSERT INTO orders(id,order_ref,user_id,status,payment_intent_id,items_json) VALUES('order-id','order1',2,'paid','pi_topup','[]')").run();
  f.env.STRIPE_SECRET_KEY='sk_test_fixture_only';
  globalThis.fetch=async()=>new Response(JSON.stringify(pi),{headers:{'content-type':'application/json'}});
  const token=await new SignJWT({user_id:2}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const response=await ordersRoute.request('/confirm',{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({payment_intent_id:pi.id})},f.env);
  assert.equal(response.status,200,await response.text());assert.equal(purchases(f.db),0);
  assert.equal((await loadAiBudget(f.env,2,now)).balance_microusd,0);
  delete f.env.STRIPE_WEBHOOK_SECRET;await assert.rejects(()=>creditAiTopupFromPayment(f.env,pi),/not configured/);
  assert.equal(purchases(f.db),0);
 }finally{globalThis.fetch=fetchBefore;f.db.close();}
});
test('configured price must be an active one-time USD product; absent makes no provider request',async()=>{
 const f=fixture();const fetchBefore=globalThis.fetch;let calls=0;try{
  resetAiTopupMirrorWindow();
  globalThis.fetch=async()=>{calls++;throw Error('provider down');};
  assert.deepEqual(await readAiTopupProduct(f.env),{configured:false});assert.equal(calls,0);
  f.env.STRIPE_PRICE_AI_TOPUP='price_owner';
  await ensureCatalogSchema(f.env);
  const price={id:'price_owner',currency:'usd',unit_amount:2000,type:'one_time',active:true,interval:null};
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_owner','Owner AI top-up','alacarte',1,'{}',?)").run(JSON.stringify([price]));
  assert.deepEqual(await readAiTopupProduct(f.env),{configured:true,state:'ready',product:{price_id:'price_owner',product_id:'prod_owner',name:'Owner AI top-up',currency:'usd',unit_amount:2000,cycle:'onetime',credit_microusd:20000000}});
  for(const [changed,reason] of [[{currency:'eur'},'not_usd'],[{type:'recurring'},'not_one_time'],[{active:false},'inactive'],[{unit_amount:0},'bad_amount'],[{unit_amount:1.5},'bad_amount']] as const) {
    f.db.prepare("UPDATE stripe_products SET prices_json=? WHERE id='prod_owner'").run(JSON.stringify([{...price,...changed}]));
    assert.deepEqual(await readAiTopupProduct(f.env),{configured:true,state:'not_ready',reason});
  }
  f.db.prepare("UPDATE stripe_products SET active=0,prices_json=? WHERE id='prod_owner'").run(JSON.stringify([price]));
  assert.deepEqual(await readAiTopupProduct(f.env),{configured:true,state:'not_ready',reason:'inactive'});
  assert.equal(calls,0);
 }finally{globalThis.fetch=fetchBefore;f.db.close();}
});
test('database constraints reject fractional/negative balance, invented users and malformed payment/draw state',()=>{
 const f=fixture();try{
  for(const value of [-1,1.5,null,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(value));
  assert.throws(()=>f.db.prepare('INSERT INTO ai_topup_accounts(user_id) VALUES(999)').run());
  assert.throws(()=>f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('founder:free',1.5,1,1)").run());
  assert.throws(()=>f.db.prepare("INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,status,expires_at) VALUES('bad',2,'2026-10-07','2026-10',1,1,'settled','2026-10-07')").run());
  assert.throws(()=>f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency) VALUES('pi_bad','order',2,'price_owner',1,1,'eur')").run());
  assert.throws(()=>f.db.prepare("INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,actor) VALUES('bad',2,'credit',1,'payment_webhook')").run());
 }finally{f.db.close();}
});
test('the exact micro-USD unit is money and the guard rejects noninteger declarations',async()=>{
 const {isMoney,declaredColumns,nonIntegerCents}=await import('../../scripts/check-money-cents.mjs');
 assert.equal(isMoney('daily_microusd'),true);
 const columns=declaredColumns();assert.equal(columns.get('ai_topup_accounts.balance_microusd')?.[0].type,'INTEGER');
 const result=spawnSync(process.execPath,['scripts/check-money-cents.mjs'],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.equal(nonIntegerCents(new Map([['ai_topup_accounts.balance_microusd',[{type:'TEXT',rel:'fixture',line:1}]]])).length,1);
 assert.equal(nonIntegerCents(new Map([['ai_topup_accounts.balance_microusd',[{type:'INTEGER',rel:'fixture',line:1}]]])).length,0);
});
// D755: the mixed-cart promo split (aiTopupCreditQuote) is gone. A pack is bought alone at face value,
// with no promo; ai_credits_d755.test.ts holds those rules.
test('the owner price variable is read strictly',()=>{
 assert.equal(aiTopupPriceId({} as any),null);assert.throws(()=>aiTopupPriceId({STRIPE_PRICE_AI_TOPUP:'../bad'} as any),/unreadable/);
 assert.equal(aiTopupPriceId({STRIPE_PRICE_AI_TOPUP:'price_owner'} as any),'price_owner');
});
test('router charges its real estimated cost, releases failed models, preserves cache and org kill',async()=>{
 __resetForTest();const f=fixture();try{
  caps(f.db,0,0);await creditAiTopupFromPayment(f.env,await buy(f,1000000));
  let calls=0;f.env.AI={run:async()=>{calls++;return{response:'answer',usage:{prompt_tokens:100,completion_tokens:20}};}};
  const good=await run(f.env,{task:'advisor_turn',userId:2,text:'hello'});
  assert.equal(good.ok,true);
  assert.equal((await loadAiBudget(f.env,2)).balance_microusd,1000000-usdToMicro(estimateCostUsd(ROUTE.advisor_turn.model,100,20)));
  f.env.AI.run=async()=>{throw Error('failed');};const before=(await loadAiBudget(f.env,2)).balance_microusd;
  assert.equal((await run(f.env,{task:'advisor_turn',userId:2,text:'retry'})).refusal,'all_models_failed');
  assert.equal((await loadAiBudget(f.env,2)).balance_microusd,before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ai_budget_reservations WHERE status='refunded'").get().n,1);
  f.env.AI_SPEND={get:async(key:string)=>key.startsWith('ai_killswitch:')?'1':null,put:async()=>{}};
  assert.equal((await run(f.env,{task:'advisor_turn',userId:2,text:'org'})).refusal,'kill_switch');
  assert.equal(calls,1);
 }finally{f.db.close();}
});
test('provider overage preserves a review hold and reports it without silently undercharging',async()=>{
 const f=fixture();try{
  const r=await reserveAiBudget(f.env,2,100,now);if(!r.ok)throw Error('reserve');
  await assert.rejects(()=>settleAiReservation(f.env,r.reservation,101),/exceeds/);
  const report=await loadAiBudget(f.env,2,new Date('2026-10-08'));
  assert.deepEqual(report.held_for_review.map((hold:any)=>({uid:hold.uid,held_microusd:hold.held_microusd,recorded_cost_microusd:hold.recorded_cost_microusd})),
   [{uid:r.reservation.uid,held_microusd:100,recorded_cost_microusd:101}]);
  assert.equal(f.db.prepare('SELECT status FROM ai_budget_reservations').get().status,'review');
 }finally{f.db.close();}
});
test('mounted self-read refuses anonymous requests; unconfigured top-up has no product',async()=>{
 const f=fixture();try{
  assert.equal((await budgetRoute.request('/me',{},f.env)).status,401);
  const token=await new SignJWT({user_id:2}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const headers={Authorization:`Bearer ${token}`};
  assert.equal((await budgetRoute.request('/me',{headers},f.env)).status,200);
  const p=await budgetRoute.request('/top-up',{headers},f.env);assert.equal(p.status,200);assert.deepEqual(await p.json(),{configured:false});
 }finally{f.db.close();}
});
