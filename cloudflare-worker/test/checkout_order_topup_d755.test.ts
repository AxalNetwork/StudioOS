// D755 CR7 (#1985): the order receipt reads webhook state, never grants tokens.
// Run with the Worker _ts-loader and node --experimental-strip-types.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import * as realOrders from '../src/services/orders.ts';
import ordersRoute from '../src/routes/orders.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const ORDER = '../src/services/orders.ts', CREDITS = '../src/services/aiCredits.ts';
const originals = { [ORDER]: readFileSync(new URL(ORDER,import.meta.url),'utf8'), [CREDITS]:readFileSync(new URL(CREDITS,import.meta.url),'utf8') };
let serial=0;
const urlOf = (spec: string, file: URL) => {
  if (!spec.startsWith('.')) return import.meta.resolve(spec);
  const path = new URL(spec,file);
  // A file, never a folder: services/email is both email.ts and a folder.
  return [path.href,path.href+'.ts',path.href+'.js',path.href+'.mjs'].find(p=>statSync(new URL(p),{throwIfNoEntry:false})?.isFile())!;
};
const data = (source: string) => 'data:text/javascript;base64,'+Buffer.from(source+'\n// fixture '+serial++).toString('base64');
function moduleSource(path: string, source: string, creditsUrl?: string) {
  const file = new URL(path,import.meta.url);
  return stripTypeScriptTypes(source).replace(/(from\s*['"]|import\(\s*['"])([^'"]+)(['"])/g,
    (_m,prefix,spec,quote) => prefix+(creditsUrl && spec==='./aiCredits' ? creditsUrl : urlOf(spec,file))+quote);
}
async function services(sources=originals) {
  const creditsUrl=data(moduleSource(CREDITS,sources[CREDITS]));
  return import(data(moduleSource(ORDER,sources[ORDER],creditsUrl)));
}
async function world(service=realOrders) {
  const f=aiBudgetFixture();
  const env={DB:f.DB,JWT_SECRET:'d755-order-fixture-secret',ENVIRONMENT:'development'} as any;
  await service.ensureOrdersSchema(env);
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,sort,origin) VALUES('pack25','price_Pack25','prod_Pack25',2500,2500000,1,1,'created')").run();
  const line={price_id:'price_Pack25',product_id:'prod_Pack25',name:'$25 of tokens',kind:'token_pack',quantity:1,unit_amount:2500,line_total:2500};
  f.db.prepare("INSERT INTO orders(id,order_ref,user_id,status,currency,subtotal_cents,vat_cents,total_cents,items_json) VALUES('o1','MRD-PACK',2,'paid','usd',2500,125,2625,?)").run(JSON.stringify([line]));
  f.db.prepare("INSERT INTO orders(id,order_ref,user_id,status,items_json) VALUES('o2','MRD-OTHER',2,'paid',?)").run(JSON.stringify([{...line,price_id:'price_Other',kind:'alacarte'}]));
  f.db.prepare("INSERT INTO ai_topup_purchases(payment_intent_id,order_ref,user_id,price_id,credit_microusd,expected_total_cents,currency,pack_uid,bonus_microusd,created_at) VALUES('pi_Pack','MRD-PACK',2,'price_Pack25',25000000,2625,'usd','pack25',2500000,datetime('now','-10 minutes'))").run();
  f.db.prepare("INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,54000000),(3,99000000)").run();
  return {...f,env};
}
async function withWorld(service: any, check: (f: any)=>Promise<void>) {
  const f=await world(service);
  const beforeFetch=globalThis.fetch;
  globalThis.fetch=(async()=>{throw new Error('A receipt must not contact a provider');}) as any;
  try { await check(f); } finally { globalThis.fetch=beforeFetch; f.db.close(); }
}
async function readProjection(service: any) {
  await withWorld(service,async f=>{
    const changes=()=>Number(f.db.prepare('SELECT total_changes() AS n').get().n);
    const before=changes();
    let r=await service.getOrderForUser(f.env,'MRD-PACK',2);
    assert.equal(r.status,'paid');
    assert.deepEqual(r.ai_topup,{state:'waiting',amount_microusd:27500000,credit_microusd:25000000,bonus_microusd:2500000,balance_microusd:54000000,at:f.db.prepare("SELECT created_at FROM ai_topup_purchases WHERE payment_intent_id='pi_Pack'").get().created_at});
    assert.equal(changes(),before,'reading pending webhook state writes nothing');
    f.db.exec("UPDATE ai_topup_purchases SET credited_at=datetime('now') WHERE payment_intent_id='pi_Pack'");
    const credited=changes();
    r=await service.getOrderForUser(f.env,'MRD-PACK',2);
    assert.equal(r.ai_topup.state,'credited'); assert.equal(r.ai_topup.balance_microusd,54000000);
    assert.equal(changes(),credited,'reading credited state writes nothing');
    f.db.exec("UPDATE ai_topup_accounts SET balance_microusd=42000000 WHERE user_id=2");
    r=await service.getOrderForUser(f.env,'MRD-PACK',2);
    assert.equal(r.ai_topup.balance_microusd,42000000,'current account balance, not the order total or original pack');
    f.db.exec("UPDATE ai_topup_purchases SET reversed_microusd=1000");
    assert.equal((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup.state,'refunded');
    f.db.exec("UPDATE ai_topup_purchases SET dispute_state='open'");
    assert.equal((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup.state,'disputed');
    f.db.exec("UPDATE ai_topup_purchases SET credited_at=NULL,reversed_microusd=0,dispute_state=NULL; UPDATE orders SET paid_at=datetime('now','-2 hours') WHERE order_ref='MRD-PACK'");
    assert.equal((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup.state,'overdue');
    assert.equal((await service.getOrderForUser(f.env,'MRD-OTHER',2)).ai_topup,undefined);
    assert.equal(await service.getOrderForUser(f.env,'MRD-PACK',3).catch((e: Error)=>({error:e.message})),null);
    assert.equal(await service.getOrderForUser(f.env,'MRD-MISSING',2),null);
    // A historical fallback pack with no kind still reads its recorded purchase.
    const lines=JSON.parse(f.db.prepare("SELECT items_json FROM orders WHERE order_ref='MRD-PACK'").get().items_json);
    lines[0].kind='alacarte';
    f.db.prepare("UPDATE orders SET items_json=? WHERE order_ref='MRD-PACK'").run(JSON.stringify(lines));
    assert.equal((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup?.state,'overdue');
    // A missing purchase cannot reclassify a historical ordinary line.
    f.db.exec("DELETE FROM ai_topup_purchases");
    assert.equal((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup,undefined);
    lines[0].kind='token_pack';
    f.db.prepare("UPDATE orders SET items_json=? WHERE order_ref='MRD-PACK'").run(JSON.stringify(lines));
    assert.deepEqual((await service.getOrderForUser(f.env,'MRD-PACK',2)).ai_topup,{state:'unreadable'});
  });
}
async function historicalReceipts(service: any) {
  await withWorld(service,async f=>{
    f.db.exec("DELETE FROM ai_topup_purchases");
    const lines=[{price_id:'price_Pack25',kind:'alacarte',name:'Historical top-up',quantity:1,unit_amount:2500,line_total:2500},
      {price_id:'price_Other',kind:'alacarte',name:'Historical service',quantity:1,unit_amount:500,line_total:500}];
    f.db.prepare("UPDATE orders SET items_json=? WHERE order_ref='MRD-PACK'").run(JSON.stringify(lines));
    const changes=Number(f.db.prepare('SELECT total_changes() AS n').get().n);
    const prepare=f.DB.prepare, queries:string[]=[];
    f.DB.prepare=(sql:string)=>{queries.push(sql);return prepare.call(f.DB,sql);};
    try {
      const result=await service.getOrderForUser(f.env,'MRD-PACK',2).catch((error:Error)=>({error:error.message}));
      assert.equal(result.status,'paid','an adopted price must not destroy a historical receipt');
      assert.deepEqual(result.items,lines); assert.equal(result.ai_topup,undefined);
      assert.equal(queries.filter(sql=>sql.includes('FROM ai_topup_purchases')).length,1,'one purchase lookup, independent of cart size');
      assert.equal(queries.filter(sql=>sql.includes('ai_token_packs')).length,0,'today’s catalogue cannot classify a historical order');
      assert.equal(Number(f.db.prepare('SELECT total_changes() AS n').get().n),changes,'receipt reads write nothing');
    } finally { f.DB.prepare=prepare; }
    // An ordinary order still reads on a database built before top-up tables.
    f.db.exec('DROP TABLE ai_topup_purchases');
    const old=await service.getOrderForUser(f.env,'MRD-PACK',2).catch((error:Error)=>({error:error.message}));
    assert.equal(old.status,'paid'); assert.equal(old.ai_topup,undefined);
    // Actual read failures are not mistaken for an absent legacy table.
    f.DB.prepare=(sql:string)=>sql.includes('FROM ai_topup_purchases') ? {bind(){return this;},async all(){return {success:false,results:[]};}} : prepare.call(f.DB,sql);
    try { await assert.rejects(()=>service.getOrderForUser(f.env,'MRD-PACK',2),/unreadable/); }
    finally { f.DB.prepare=prepare; }
  });
}
test('historical mixed orders retain their receipt when a price is adopted as a pack; one read, no writes, pre-top-up schema supported',async()=>historicalReceipts(realOrders));
test('owner-only receipt: waiting, credited, refunded, disputed, overdue, current balance, VAT excluded; no writes or providers',async()=>readProjection(realOrders));
test('GET order authenticates, hides another member, and returns the projection only to the owner',async()=>{
  await withWorld(realOrders,async f=>{
    const app=new Hono();
    app.onError((e:any,c)=>c.json({error:e.message},AUTH_ERROR_STATUSES[e.message]??500));
    app.route('/api/orders',ordersRoute);
    const get=async(user?:number)=>{
      const headers:Record<string,string>={};
      if(user)headers.Authorization='Bearer '+await new SignJWT({user_id:user}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
      return app.request('/api/orders/MRD-PACK',{headers},f.env);
    };
    assert.equal((await get()).status,401);
    assert.equal((await get(3)).status,404);
    const r=await get(2); assert.equal(r.status,200);
    assert.equal((await r.json() as any).order.ai_topup.state,'waiting');
  });
});
test('a failed purchase or balance read is unreadable, not a credited or zero balance answer',async()=>{
  await withWorld(realOrders,async f=>{
    const prepare=f.DB.prepare;
    for(const fault of ['FROM ai_topup_purchases','SELECT balance_microusd FROM ai_topup_accounts']){
      f.DB.prepare=(sql:string)=>{if(sql.includes(fault))throw new Error('fixture read failure');return prepare.call(f.DB,sql);};
      try {await assert.rejects(()=>realOrders.getOrderForUser(f.env,'MRD-PACK',2),/fixture read failure/);}
      finally {f.DB.prepare=prepare;}
    }
  });
});
const mutations=[
  {name:'owner predicate removed',file:ORDER,before:'!row || row.user_id !== userId',after:'!row'},
  {name:'projection omitted',file:ORDER,before:'if (topup) order.ai_topup = topup;',after:'if (topup) void 0;'},
  {name:'fallback pack hidden',file:ORDER,before:"if (topup) order.ai_topup = topup;",after:"if (topup && order.items.some(line => line.kind === 'token_pack')) order.ai_topup = topup;"},
  {name:'paid is mistaken for credited',file:CREDITS,before:"return row.overdue === 1 ? 'overdue' : 'waiting';",after:"return 'credited';"},
  {name:'bonus lost',file:CREDITS,before:'amount_microusd: purchase.amount_microusd',after:'amount_microusd: purchase.credit_microusd'},
  {name:'account balance invented from pack',file:CREDITS,before:'balance_microusd: balance, at: purchase.at',after:'balance_microusd: purchase.amount_microusd, at: purchase.at'},
  {name:'refund lost',file:CREDITS,before:"if (row.reversed_microusd > 0) return 'refunded';",after:''},
  {name:'dispute lost',file:CREDITS,before:"if (row.dispute_state === 'open' || row.dispute_state === 'lost') return 'disputed';",after:''},
  {name:'missing new pack purchase called ordinary',file:ORDER,before:"else if (order.items.some(line => line.kind === 'token_pack'))",after:'else if (false)'},
  {name:'historical receipt lost without purchase',file:CREDITS,before:'if (!found.results?.length) return null;',after:"if (!found.results?.length) throw new Error('AI top-up purchase unreadable');",check:historicalReceipts},
  {name:'legacy missing table fails ordinary receipts',file:CREDITS,before:'return null;\n    throw error;',after:'throw error;\n    throw error;',check:historicalReceipts},
  {name:'one catalogue read per receipt is reintroduced',file:ORDER,before:"const { orderTopUp } = await import('./aiCredits');",after:"await env.DB.prepare('SELECT 1 FROM ai_token_packs LIMIT 1').all();\n  const { orderTopUp } = await import('./aiCredits');",check:historicalReceipts},
  {name:'failed lookup is called empty',file:CREDITS,before:"if (found.success !== true) throw new Error('AI top-up purchase unreadable');",after:'',check:historicalReceipts},
];
for(const m of mutations)test('order receipt mutation: '+m.name,async()=>{
  assert.ok(originals[m.file].includes(m.before),'mutation target exists');
  const changed={...originals,[m.file]:originals[m.file].replace(m.before,()=>m.after)};
  const check=m.check ?? readProjection;
  await check(await services());
  await assert.rejects(()=>services(changed).then(check),{name:'AssertionError'});
  await check(await services());
});
