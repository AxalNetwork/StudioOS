// D6209: real SQLite ownership and optimistic-concurrency checks for private Portfolio views.
//
// From cloudflare-worker/test/README.md (moved by #6472): Private Portfolio views: SQLite
// ownership, page isolation, optimistic writes, access refusals, validation and unreadable reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router, { portfolioViewSpec } from '../src/routes/portfolio_saved_views.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const secret = 't'.repeat(64);
function world() {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
 for(const table of ['users','super_admins','mi_pro_subscriptions']) db.exec(tableFromBaseline(baseline,table));
 const migration=readdirSync(new URL('../sql/migrations/',import.meta.url)).find(name=>name.endsWith('_6209_portfolio_saved_views.sql'))!;
 const sql=readFileSync(new URL(`../sql/migrations/${migration}`,import.meta.url),'utf8');db.exec(sql);db.exec(sql);
 for(const [id,role] of [[1,'investor'],[2,'investor'],[3,'founder']])db.prepare("INSERT INTO users(id,name,email,role,is_active,investor_tier,investor_subscription_status) VALUES(?,?,?,?,1,'institutional','active')").run(id,`Synthetic ${id}`,`synthetic${id}@example.invalid`,role);
 const app=new Hono<any>();app.route('/api/portfolio-saved-views',router);
 app.onError((e,c)=>c.json({error:'Refused'},AUTH_ERROR_STATUSES[e.message]||500));
 return {db,app,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
async function call(w:ReturnType<typeof world>,who:number|null,method='GET',path='?page=overview',body?:unknown,extra={}){
 const token=who===null?null:await new SignJWT({user_id:who,...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
 const r=await w.app.request(`/api/portfolio-saved-views${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})},w.env);
 return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json() as any};
}
test('private CRUD, page isolation and stale writes use real bound SQLite predicates',async()=>{
 const w=world();try{
 const created=await call(w,1,'POST','',{page:'overview',name:'Climate',spec:{query:'',sector:'Retired sector',sort:'updated'}});assert.equal(created.status,201);const id=created.body.uid;
 assert.equal((await call(w,1)).body.items.length,1);assert.equal((await call(w,2)).body.items.length,0);assert.equal((await call(w,1,'GET','?page=positions')).body.items.length,0);
 assert.equal((await call(w,2,'PATCH',`/${id}`,{version:1,name:'Stolen'})).status,409);
 assert.equal((await call(w,1,'PATCH',`/${id}`,{version:1,name:'Renamed'})).status,200);
 assert.equal((await call(w,1,'PATCH',`/${id}`,{version:1,name:'Stale'})).status,409);
 assert.equal((await call(w,2,'DELETE',`/${id}?version=2`)).status,409);
 assert.equal((await call(w,1,'DELETE',`/${id}?version=1`)).status,409);
 assert.equal((await call(w,1)).body.items[0].name,'Renamed');assert.equal((await call(w,1)).body.items[0].spec.sector,'Retired sector');
 assert.equal((await call(w,1,'DELETE',`/${id}?version=2`)).status,200);assert.equal((await call(w,1)).body.items.length,0);
 }finally{w.db.close();}
});
test('anonymous, non-investor and impersonation cannot manage personal settings',async()=>{
 const w=world();try{assert.equal((await call(w,null)).status,401);assert.equal((await call(w,3)).status,403);assert.equal((await call(w,1,'GET','?page=overview',undefined,{impersonated_by:2})).status,403);}finally{w.db.close();}
});
test('settings validation accepts retired predicates, refuses unbounded and unknown commands',()=>{
 for(const page of ['overview','positions'])assert.doesNotThrow(()=>portfolioViewSpec(page,{stage:'retired'}));
 for(const [page,spec] of [['other',{}],[['overview'],{}],['overview',{query:'x'.repeat(201)}],['overview',{sort:'sql'}],['positions',{filter:'sql'}],['positions',{as_of:'2026-02-30'}],['positions',{as_of:'9999-99-99'}],['overview',{owner_user_id:'2'}]])assert.throws(()=>portfolioViewSpec(page,spec));
});
test('database failure is unreadable rather than an empty list',async()=>{const w=world();w.db.exec('DROP TABLE portfolio_saved_views');try{assert.equal((await call(w,1)).status,503);}finally{w.db.close();}});

test('quota is atomic per member and page; denials are never cacheable',async()=>{
 const w=world();try{
  const insert=w.db.prepare("INSERT INTO portfolio_saved_views(uid,owner_user_id,page,name,spec_json) VALUES(?,1,'overview','Saved','{}')");
  for(let n=0;n<100;n++)insert.run(n.toString(16).padStart(32,'0'));
  assert.equal((await call(w,1,'POST','',{page:'overview',name:'Limit',spec:{}})).status,409);
  assert.equal((await call(w,1,'POST','',{page:'positions',name:'Separate page',spec:{}})).status,201);
  assert.equal((await call(w,2,'POST','',{page:'overview',name:'Separate member',spec:{}})).status,201);
  for(const who of [null,3])assert.equal((await call(w,who)).cache,'no-store');
  assert.equal((await call(w,1,'PATCH','/invalid',{name:'Name',version:1})).status,404);
  assert.equal((await call(w,1,'POST','',{page:['overview'],name:'Name',spec:{}})).status,400);
 }finally{w.db.close();}
});
