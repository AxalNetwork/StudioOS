/** D1009 / #2827: real SQLite, real auth/session gates; Stripe and KV are synthetic. */
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import catalog, { adminCatalog } from '../src/routes/catalog.ts';
import stripe from '../src/routes/admin_stripe.ts';
import { recoveryCoolOff } from '../src/middleware/recoveryCoolOff.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { validateProductMetadata, paymentChangeReason } from '../src/services/catalog.ts';
import { planOf } from '../src/services/aiCredits.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const secret = 'synthetic-d1009-session-secret-only'.repeat(2);
const reason = 'Retire the previous payment offering';
const key = 'sk_test_synthetic_d1009_not_a_credential';
const pk = 'pk_test_synthetic_d1009_checkout';
const tables = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'stripe_products'];
const packDDL = tableFromBaseline(readFileSync(new URL('../sql/migrations/486_ai_credits_token_packs.sql', import.meta.url), 'utf8'), 'ai_token_packs');
const allDDL = tables.map(t => tableFromBaseline(baseline, t)).join(';\n') + ';\n' + packDDL + ';\n' + tableFromBaseline(readFileSync(new URL('../sql/migrations/277_user_recovery_state.sql', import.meta.url), 'utf8'), 'user_recovery_state');

function world() {
  const f = makeD1(allDDL);
  // As in D223, unrelated baseline foreign-key targets are outside this narrow fixture.
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.exec("INSERT INTO users(id,email,name,role) VALUES(1,'holder@example.test','Holder','admin'),(2,'plain@example.test','Admin','admin'),(3,'founder@example.test','Founder','founder'); INSERT INTO super_admins(user_id) VALUES(1)");
  f.db.exec("INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'fresh','totp',datetime('now')),(1,'stale','totp',datetime('now','-2 days')),(1,'weak','sms',datetime('now')),(2,'plain','totp',datetime('now')),(3,'founder','totp',datetime('now'))");
  const kv = new Map<string, string>();
  const puts: string[] = [];
  const env: any = { DB: f.DB, JWT_SECRET: secret, ENVIRONMENT: 'development', STRIPE_SECRET_KEY: key,
    RATE_LIMITS: { async get(k: string) { return kv.get(k) ?? null; }, async put(k: string,v: string) { kv.set(k,v); puts.push(k); }, async delete(k: string) { kv.delete(k); } } };
  const a = new Hono<any>();
  a.onError((e: any,c) => c.json({ detail: AUTH_ERROR_STATUSES[e.message] ? e.message : 'The request could not be completed.' }, AUTH_ERROR_STATUSES[e.message] ?? 500));
  // Use index.ts's actual declarative prefix list so removing Stripe's entry
  // changes this mounted middleware test, rather than leaving a duplicate gate.
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const list = index.slice(index.indexOf('const COOL_OFF_PREFIXES = ['), index.indexOf('for (const p of COOL_OFF_PREFIXES)'));
  for (const p of ['/api/admin/catalog', '/api/admin/stripe']) if (list.includes(`'${p}'`)) {
    a.use(p, recoveryCoolOff); a.use(`${p}/*`, recoveryCoolOff);
  }
  a.route('/api/admin/catalog',adminCatalog); a.route('/api/admin/stripe',stripe); a.route('/api/catalog',catalog);
  return { ...f, env, a, kv, puts };
}

type Route = { method: string; path: string; body?: any; action?: string };
const prefix = '/api/admin/catalog';
const reads: Route[] = [
  {method:'GET',path:prefix+'/products'}, {method:'GET',path:prefix+'/mode'}, {method:'POST',path:prefix+'/sync'},
  {method:'GET',path:'/api/admin/stripe/config'}, {method:'GET',path:'/api/admin/stripe/webhook'},
  {method:'POST',path:'/api/admin/stripe/webhook',body:{action:'update',endpoint_id:'we_fixed'}},
];
const writes: Route[] = [
  {method:'POST',path:prefix+'/products',body:{name:'Advisor Pro',kind:'subscription',metadata:{plan_group:'advisor'}},action:'catalog_product_create'},
  {method:'PATCH',path:prefix+'/products/prod_fixed',body:{name:'Partner Pro',metadata:{plan_group:'partner'}},action:'catalog_product_update'},
  {method:'POST',path:prefix+'/products/prod_fixed/archive',action:'catalog_product_archive'},
  {method:'POST',path:prefix+'/products/prod_fixed/prices',body:{currency:'usd',unit_amount:2900,type:'recurring',interval:'month'},action:'catalog_price_create'},
  {method:'PATCH',path:prefix+'/prices/price_fixed',body:{nickname:'New label'},action:'catalog_price_update'},
  {method:'POST',path:prefix+'/prices/price_fixed/archive',action:'catalog_price_archive'},
  {method:'PUT',path:'/api/admin/stripe/config',body:{publishable_key:pk},action:'stripe_pk_update'},
];
async function call(f: ReturnType<typeof world>,r: Route,user: number | null = 1,jti = 'fresh') {
  const jwt = user === null ? null : await new SignJWT({user_id:user,jti}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  return f.a.request(r.path,{method:r.method,headers:{'content-type':'application/json',...(jwt?{authorization:`Bearer ${jwt}`}:{})},...(r.body===undefined?{}:{body:JSON.stringify(r.body)})},f.env);
}
const withReason = (r: Route): Route => r.method === 'GET' ? r : ({...r,body:{...r.body,reason}});
const audits = (f: ReturnType<typeof world>) => f.db.prepare('SELECT action,filters_json FROM admin_audit_log').all() as any[];

let calls: {path:string;method:string;form:URLSearchParams}[] = [];
let failStripe = false;
const oldFetch = globalThis.fetch;
beforeEach(() => {
  calls=[]; failStripe=false;
  const products: any[] = [{id:'prod_fixed',name:'Advisor Pro',active:true,metadata:{kind:'subscription',plan_group:'advisor'}}];
  const prices: any[] = [{id:'price_fixed',product:'prod_fixed',active:true,type:'recurring',currency:'usd',unit_amount:2900,recurring:{interval:'month',interval_count:1}}];
  globalThis.fetch = (async (input: any,init: any={}) => {
    const u = new URL(String(input)); const method = init.method??'GET'; const form = new URLSearchParams(String(init.body??''));
    calls.push({path:u.pathname,method,form});
    if(u.hostname!=='api.stripe.com') return Response.json({error:'unexpected provider'}, {status:599});
    if(failStripe) return Response.json({error:{message:'Synthetic provider failure'}},{status:503});
    if(method==='GET'&&u.pathname==='/v1/products') return Response.json({data:products,has_more:false});
    if(method==='GET'&&u.pathname==='/v1/prices') return Response.json({data:prices,has_more:false});
    if(method==='GET'&&u.pathname==='/v1/webhook_endpoints') return Response.json({data:[{id:'we_fixed',url:'https://axal.vc/api/billing/stripe/webhook',status:'enabled',enabled_events:['*'],secret:'whsec_synthetic_hidden'}]});
    if(method==='POST'&&u.pathname==='/v1/products') {const p={id:'prod_new',name:form.get('name'),active:true,metadata:{kind:form.get('metadata[kind]'),plan_group:form.get('metadata[plan_group]')}};products.push(p);return Response.json(p);}
    if(method==='POST'&&u.pathname==='/v1/prices') {const p={...prices[0],id:'price_new',unit_amount:Number(form.get('unit_amount'))};prices.push(p);return Response.json(p);}
    if(method==='POST'&&u.pathname.startsWith('/v1/products/')) return Response.json(products[0]);
    if(method==='POST'&&u.pathname.startsWith('/v1/prices/')) return Response.json(prices[0]);
    if(method==='POST'&&u.pathname==='/v1/webhook_endpoints/we_fixed') return Response.json({id:'we_fixed',url:'https://axal.vc/api/billing/stripe/webhook',secret:'whsec_synthetic_hidden'});
    return Response.json({error:'unexpected Stripe call'}, {status:599});
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch=oldFetch; });

test('HQ reads and fixed-event repair reject anonymous, founder, plain admin and branch holder before Stripe/KV writes',async()=>{
  for(const r of reads) for(const [user,jti,branch,status] of [[null,'fresh',false,401],[3,'founder',false,403],[2,'plain',false,403],[1,'fresh',true,403]] as const){
    const f=world();try{if(branch)f.env.BRANCH_CODE='test-branch';const response=await call(f,r,user,jti);assert.equal(response.status,status,r.path);assert.equal(calls.length,0);assert.equal(f.puts.length,0);assert.equal(audits(f).length,0);}finally{f.db.close();}
  }
});
test('the authenticated member catalogue remains readable; the HQ key read stays masked', async () => {
  const f = world();
  try {
    assert.equal((await call(f, { method: 'GET', path: '/api/catalog/products' }, 3, 'founder')).status, 200);
    assert.equal((await call(f, { method: 'GET', path: '/api/catalog/products' }, null)).status, 401);
    f.kv.set('config:stripe:pk', pk);
    const response = await call(f, reads[3]);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(JSON.parse(body).configured, true);
    assert.ok(!body.includes(pk));
    assert.ok(!body.includes(key));
  } finally { f.db.close(); }
});
test('Super Admin reads and fixed-event repair do not demand a fresh step-up; key and webhook secret never leave',async()=>{
  for(const r of reads){const f=world();try{const response=await call(f,r,1,'stale');assert.equal(response.status,200,r.path);const body=await response.text();assert.ok(!body.includes(key));assert.ok(!body.includes('whsec_synthetic_hidden'));if(r.path.endsWith('/config'))assert.equal(JSON.parse(body).configured,false);}finally{f.db.close();}}
});
test('all seven payment writes reject anonymous, plain admin, stale session, weak factor and branch holder without effects',async()=>{
  for(const r of writes) for(const [user,jti,branch,status] of [[null,'fresh',false,401],[3,'founder',false,403],[2,'plain',false,403],[1,'stale',false,403],[1,'weak',false,403],[1,'fresh',true,403]] as const){
    const f=world();try{calls=[];if(branch)f.env.BRANCH_CODE='test-branch';const response=await call(f,withReason(r),user,jti);assert.equal(response.status,status,r.path);assert.equal(calls.length,0,r.path);assert.equal(f.puts.length,0);assert.equal(audits(f).length,0);}finally{f.db.close();}
  }
});
test('a fresh holder needs a bounded, nonblank string reason on every payment write',async()=>{
  for(const r of writes) for(const invalid of [undefined,'  ',42,'x'.repeat(501)]){const f=world();try{calls=[];const response=await call(f,{...r,body:{...r.body,reason:invalid}});assert.equal(response.status,400,r.path);assert.equal((await response.json() as any).error,'reason_required');assert.equal(calls.length,0);assert.equal(f.puts.length,0);assert.equal(audits(f).length,0);}finally{f.db.close();}}
});
test('fresh-holder writes reach Stripe/KV, preserve amounts and keep the trimmed reason and actor in the existing audit',async()=>{
  for(const r of writes){const f=world();try{calls=[];const response=await call(f,{...r,body:{...r.body,reason:`  ${reason}  `}});assert.equal(response.status,200,`${r.path}: ${await response.clone().text()}`);const rows=audits(f);assert.equal(rows.length,1,r.path);assert.equal(rows[0].action,r.action);assert.equal(JSON.parse(rows[0].filters_json).reason,reason);assert.equal(f.db.prepare('SELECT admin_user_id FROM admin_audit_log').get()!.admin_user_id,1);
    const text=await response.text();assert.ok(!text.includes(key));assert.ok(!text.includes(pk));
    if(r.method==='PUT')assert.equal(f.kv.get('config:stripe:pk'),pk);else assert.ok(calls.some(c=>c.method==='POST'));
    if(r.action==='catalog_price_create')assert.equal(calls.find(c=>c.path==='/v1/prices'&&c.method==='POST')!.form.get('unit_amount'),'2900');
  }finally{f.db.close();}}
});
test('Stripe joins the catalogue recovery cool-off at the actual declared prefixes, including reads',async()=>{
  for(const r of [...reads,...writes]){const f=world();try{calls=[];f.db.exec("INSERT INTO user_recovery_state(user_id,cooling_off_until) VALUES(1,datetime('now','+1 day'))");const response=await call(f,withReason(r));assert.equal(response.status,423,r.path);assert.equal((await response.json() as any).error,'recovery_cool_off_active');assert.equal(calls.length,0);assert.equal(f.puts.length,0);assert.equal(audits(f).length,0);}finally{f.db.close();}}
});
test('provider and mirror failures remain refusals, never successful empty lists', async () => {
  for (const r of [reads[0], reads[2], reads[4], reads[5], ...writes.filter(r => r.method !== 'PUT')]) {
    const f = world();
    try {
      failStripe = true;
      if (r === reads[0]) {
        const db = f.env.DB;
        f.env.DB = { ...db, prepare(sql: string) {
          if (sql.includes('FROM stripe_products')) throw new Error('Synthetic D1 read failure');
          return db.prepare(sql);
        } };
      }
      const response = await call(f, withReason(r));
      assert.ok(response.status >= 500, `${r.path}: ${response.status}`);
      assert.ok((await response.json() as any).message);
      const rows = audits(f);
      if (r === reads[2]) {
        // D1011 records the failed sync, while its response remains a refusal.
        assert.equal(rows.length, 1);
        assert.equal(rows[0].action, 'catalog_sync_failed');
        assert.equal(JSON.parse(rows[0].filters_json).failure, 'stripe');
      } else {
        assert.equal(rows.length, 0);
      }
    } finally { f.db.close(); }
  }
});
test('checkout-key persistence failure is a 503 sentence and writes no success audit',async()=>{
  const f=world();try{f.env.RATE_LIMITS.put=async()=>{throw new Error('Synthetic KV failure');};const response=await call(f,withReason(writes[6]));assert.equal(response.status,503);assert.equal((await response.json() as any).error,'stripe_config_write_failed');assert.equal(audits(f).length,0);}finally{f.db.close();}
});
test('advisor and partner metadata agree with planOf; unsupported groups and Investor Plus remain refused',()=>{
  for(const group of ['advisor','partner']){const m={plan_group:group};assert.deepEqual(validateProductMetadata('subscription',m),[]);assert.equal(planOf(m)?.family,group);}
  for(const m of [{plan_group:'investor'},{plan_group:'Advisor'},{plan_group:'founder'},{plan_group:''},{investor_tier:'plus'},{}])assert.equal(validateProductMetadata('subscription',m).length,1);
  assert.equal(paymentChangeReason({reason:' x '}),'x');assert.equal(paymentChangeReason({reason:'x'.repeat(500)})?.length,500);
});
