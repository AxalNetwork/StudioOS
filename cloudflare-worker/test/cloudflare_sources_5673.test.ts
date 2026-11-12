/** D5673: real SQLite source journal, paginated provider fixtures and hostile metadata/redirection refusals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { d1Over } from './_d1_sqlite.mjs';
import { d1CfSourceStore, pendingCfSourceReceipts, forwardPendingCfSourceReceipts } from '../src/services/cloudflareSourceStore.ts';
import { reconcileCfScript, cfReadApi, type ReadCfApi } from '../src/services/cloudflareDeployments.ts';
import { cfRoute, parseCfReceipt, forwardCfReceipt } from '../src/services/cloudflareSourceReceipt.ts';
const NOW=1900000000000;
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(n=3){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../sql/migrations/202611121040_5673_cloudflare_source_receipts.sql',import.meta.url),'utf8'));
  const store=d1CfSourceStore(d1Over(db) as any),deps=Array.from({length:n},(_,i)=>({id:uid(i+1),created_on:new Date(NOW-(n-i)*1000).toISOString(),source:'wrangler',
    author_email:'private@example.invalid',annotations:{message:'<@everyone> https://private.invalid'},versions:[{version_id:uid(10000+i),percentage:100}]}));
  const readApi:ReadCfApi=async(path,q)=>{const rows=path.endsWith('/deployments')?[...deps].reverse():[...new Map(deps.map(d=>[d.versions[0].version_id,{id:d.versions[0].version_id,metadata:{created_on:d.created_on,source:'api',author_email:d.author_email}}])).values()].sort((a,b)=>Date.parse(b.metadata.created_on)-Date.parse(a.metadata.created_on));
    const page=Number(q.page),limit=Number(q.per_page);return {result:{[path.endsWith('/deployments')?'deployments':'items']:rows.slice((page-1)*limit,page*limit)},result_info:{total_pages:Math.ceil(rows.length/limit)}};};
  return {db,store,deps,readApi,run:(changes:Record<string,unknown>={},factory=reconcileCfScript)=>factory({script:'studioos',now:NOW,store,readApi,...changes} as any)};
}

test('captures immutable deployments/weights separately from version uploads, without health or private provider text',async()=>{
  const f=fixture();try{assert.equal((await f.run()).state,'observed');const rows=await pendingCfSourceReceipts(d1Over(f.db) as any);
    assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.code==='version_uploaded').length,3);
    assert.ok(rows.filter(r=>r.code!=='version_uploaded').every(r=>r.versions[0].weight===100&&r.github===null));
    assert.ok(rows.every(r=>r.state==='observed'));assert.doesNotMatch(JSON.stringify(rows),/private|everyone|author_email|success/);
    assert.equal(cfRoute(rows[0]).destination,'activity','unattributed receipts do not create competing GitHub release roots');
    const cursor=await f.store.read('deployments:studioos');assert.equal(cursor.active_id,f.deps.at(-1)!.id);
  }finally{f.db.close();}
});

test('more than 1000 results converge in a durable journal; overlap, replay and CAS never rewrite history',async()=>{
  const f=fixture(1205);try{assert.equal((await f.run()).state,'observed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cf_source_receipts').get()!.n,2410);
    const before=f.db.prepare('SELECT receipt_json FROM cf_source_receipts ORDER BY receipt_id LIMIT 1').get()!.receipt_json;
    await f.run({now:NOW+60000});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cf_source_receipts').get()!.n,2410);
    assert.equal(f.db.prepare('SELECT receipt_json FROM cf_source_receipts ORDER BY receipt_id LIMIT 1').get()!.receipt_json,before);
    const c=await f.store.read('deployments:studioos');assert.equal(await f.store.commit('deployments:studioos',c.revision-1,{through_ms:0,active_id:null,active_versions:[]},[]),false);
    assert.equal((await f.store.read('deployments:studioos')).through_ms,NOW+60000);
  }finally{f.db.close();}
});

test('traffic splits, repeated SHA/new rollout, explicit/inferred rollback and preview remain distinct',async()=>{
  const f=fixture(4);try{f.deps[1].versions=[{version_id:uid(10000),percentage:25},{version_id:uid(10001),percentage:75}];f.deps[2].versions=[{version_id:uid(10001),percentage:100}];f.deps[3].versions=[{version_id:uid(10000),percentage:100}];
    await f.run({script:'studioos-meeting-bot-preview',attribution:async(_s:string,id:string)=>({run_id:7,attempt:1,sha:'b'.repeat(40),rollout_key:id})});
    const rows=await pendingCfSourceReceipts(d1Over(f.db) as any);assert.ok(rows.every(r=>cfRoute(r).destination==='preview'));
    assert.ok(rows.some(r=>r.code==='rollback'));assert.ok(rows.some(r=>r.versions.length===2));
    const attributed=rows.filter(r=>r.github);assert.equal(new Set(attributed.map(r=>cfRoute(r).subject)).size,4,'same SHA is not one rollout');
  }finally{f.db.close();}
});

test('stale active deployment is still observed; capped, reordered, missing or failed inventories leave explicit gaps',async()=>{
  const f=fixture(1);try{f.deps[0].created_on=new Date(NOW-10*86400000).toISOString();await f.run();assert.equal((await f.store.read('deployments:studioos')).active_id,f.deps[0].id);
  }finally{f.db.close();}
  for(const mode of ['refused','capped','split-brain']){const g=fixture();try{
    let calls=0;const api:ReadCfApi=async(path,q)=>{if(mode==='refused')throw Error('secret body');
      if(mode==='capped'&&Number(q.per_page)===100)return {result:{deployments:Array.from({length:100},(_,i)=>({...g.deps[0],id:uid(100*Number(q.page)+i),created_on:new Date(NOW-(100*Number(q.page)+i)*100).toISOString()}))}};
      const r=await g.readApi(path,q);if(Number(q.per_page)===1&&++calls>1)(r.result as any).deployments[0]={...g.deps[2],id:uid(999)};return r;};
    assert.equal((await g.run({readApi:api})).state,'unknown');assert.equal((await g.store.read('deployments:studioos')).through_ms,0);
    const rows=await pendingCfSourceReceipts(d1Over(g.db) as any);assert.equal(rows.length,1);assert.equal(rows[0].state,'unknown');assert.doesNotMatch(JSON.stringify(rows),/secret body/);
  }finally{g.db.close();}}
});

test('API transport is read-only, script scoped, bounded and does not follow redirects',async()=>{
  let called=0;const api=cfReadApi('a'.repeat(32),'synthetic-token',(async(_url:any,init:any)=>{called++;assert.equal(init.redirect,'error');assert.equal(init.method,undefined);return Response.json({success:true,result:{items:[]}});}) as typeof fetch);
  await api('/workers/scripts/studioos/versions',{});assert.equal(called,1);await assert.rejects(api('/workers/scripts/other/deployments',{}));assert.equal(called,1);
  const bad=cfReadApi('a'.repeat(32),'synthetic-token',async()=>new Response(null,{status:302,headers:{location:'https://private.invalid'}}));await assert.rejects(bad('/workers/scripts/studioos/deployments',{}));
});

test('receipt validation refuses spoofed audience, arbitrary Slack content and premature enqueue acknowledgement',async()=>{
  const f=fixture();try{await f.run();const r=(await pendingCfSourceReceipts(d1Over(f.db) as any))[0];
    assert.throws(()=>parseCfReceipt({...r,audience:'preview'}));assert.throws(()=>parseCfReceipt({...r,meeting_url:'https://private.invalid'}));
    assert.throws(()=>parseCfReceipt({...r,code:'<@everyone>'}));await assert.rejects(forwardCfReceipt({enqueue:async()=>({durable:false})},r));
    let seen:any;await forwardCfReceipt({enqueue:async row=>{seen=row;return {durable:true};}},r);assert.equal(seen.labels.startsWith('[cf][prod][studioos]'),true);
  }finally{f.db.close();}
});

test('mutations: pagination, traffic weights, replay cursor and explicit unknown source are necessary',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'cf-source-5673-'));let source=readFileSync(new URL('../src/services/cloudflareDeployments.ts',import.meta.url),'utf8');
  source=source.replace("'./cloudflareSourceReceipt'",JSON.stringify(new URL('../src/services/cloudflareSourceReceipt.ts',import.meta.url).href));
  const variants:[string,string,string,(factory:typeof reconcileCfScript)=>Promise<void>][]=[
    ['paging','rows.length<100','rows.length<=100',async factory=>{const f=fixture(1205);try{await f.run({},factory);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cf_source_receipts').get()!.n,2410);}finally{f.db.close();}}],
    ['weights','weight:v.percentage','weight:100',async factory=>{const f=fixture();try{f.deps[2].versions=[{version_id:uid(10000),percentage:25},{version_id:uid(10001),percentage:75}];await f.run({},factory);const r=(await pendingCfSourceReceipts(d1Over(f.db) as any)).find(r=>r.versions.length===2)!;assert.deepEqual(r.versions.map(v=>v.weight),[25,75]);}finally{f.db.close();}}],
    ['unknown-cursor','through_ms:cursor.through_ms','through_ms:now',async factory=>{const f=fixture();try{await f.run({readApi:async()=>{throw Error('offline');}},factory);assert.equal((await f.store.read('deployments:studioos')).through_ms,0);}finally{f.db.close();}}],
  ];
  try{for(const [label,before,after,journey] of variants){assert.ok(source.includes(before));const path=join(dir,label+'.ts');writeFileSync(path,source.replaceAll(before,after));const broken=(await import(pathToFileURL(path).href)).reconcileCfScript;await assert.rejects(journey(broken),'must kill '+label);}}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('mounted source read refuses no session and ordinary admin, serves only redacted HQ metadata',async()=>{
  const { Hono }=await import('hono');const { SignJWT }=await import('jose');
  const { migratedDatabase,removeMigratedDatabases }=await import('./_storage_schema.ts');
  const { AUTH_ERROR_STATUSES }=await import('../src/util/authErrors.ts');
  const { withThrownResponses }=await import('../src/util/thrownResponse.ts');
  const { default:router }=await import('../src/routes/admin_cloudflare_sources.ts');
  const db=migratedDatabase(),secret='synthetic-source-observer-signing-key'.repeat(2);
  try{db.exec("INSERT INTO users(id,name,email,role,is_active) VALUES (44,'Staff','staff@example.test','admin',1),(66,'Hq','hq@example.test','admin',1);INSERT INTO super_admins(user_id) VALUES (66);");
    const app=new Hono<any>();app.route('/api/admin/platform/cloudflare-sources',router);
    app.onError((err,c)=>c.json({error:err.message},(AUTH_ERROR_STATUSES[err.message]||500) as any));
    const call=async(id:number|null)=>{const headers:Record<string,string>={};if(id!==null)headers.Authorization='Bearer '+await new SignJWT({user_id:id}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
      return withThrownResponses(()=>app.request('https://unit.test/api/admin/platform/cloudflare-sources',{headers},{JWT_SECRET:secret,ENVIRONMENT:'development',DB:d1Over(db)}));};
    assert.equal((await call(null)).status,401);assert.equal((await call(44)).status,403);const r=await call(66);assert.equal(r.status,200);
    assert.equal((await r.json()).delivery,'not_configured');
    const dir=mkdtempSync(join(tmpdir(),'cf-source-auth-'));
    try{const url=new URL('../src/routes/admin_cloudflare_sources.ts',import.meta.url);let broken=readFileSync(url,'utf8');
      broken=broken.replaceAll(/from '([^']+)'/g,(whole,name)=>name.startsWith('.')?'from '+JSON.stringify(new URL(name+'.ts',url).href):name==='hono'?'from '+JSON.stringify(import.meta.resolve('hono')):whole);
      assert.ok(broken.includes('await requireSuperAdmin(c);'));broken=broken.replace('await requireSuperAdmin(c);','');
      const file=join(dir,'unguarded.ts');writeFileSync(file,broken);const mutated=new Hono<any>();mutated.route('/source',(await import(pathToFileURL(file).href)).default);
      const leaked=await mutated.request('https://unit.test/source',{}, {ENVIRONMENT:'development',DB:d1Over(db)});
      assert.notEqual(leaked.status,401,'removing the auth guard must change the real unauthenticated journey');
      await assert.rejects(async()=>assert.equal(leaked.status,401),'auth mutation is killed');
    }finally{rmSync(dir,{recursive:true,force:true});}

  }finally{db.close();removeMigratedDatabases();}
});

test('forwarding records only durable sender acceptance and preserves pending work after refusal',async()=>{
 const f=fixture();try{await f.run();const db=d1Over(f.db) as any;
 await assert.rejects(forwardPendingCfSourceReceipts(db,{enqueue:async()=>({durable:false})},NOW));assert.equal((await pendingCfSourceReceipts(db)).length,6);
 const ids=new Set<string>();assert.equal(await forwardPendingCfSourceReceipts(db,{enqueue:async x=>{ids.add(x.receipt.id);return {durable:true};}},NOW),6);assert.equal(ids.size,6);
 assert.equal((await pendingCfSourceReceipts(db)).length,0);
 }finally{f.db.close();}
});

test('equal provider timestamps preserve active version but do not invent rollback ordering',async()=>{
 const f=fixture();try{f.deps[1].created_on=f.deps[0].created_on;f.deps[2].versions=f.deps[0].versions;await f.run();
 const rows=await pendingCfSourceReceipts(d1Over(f.db) as any);assert.ok(rows.some(r=>r.code==='history_gap'));assert.equal(rows.some(r=>r.code==='rollback'),false);
 assert.equal((await f.store.read('deployments:studioos')).active_id,f.deps[2].id);
 }finally{f.db.close();}
});


test('all-script reconcile cooldown respects any recently advanced script and avoids provider calls; old cursors allow a new attempt',async()=>{
 const {Hono}=await import('hono'),{SignJWT}=await import('jose');
 const {migratedDatabase,removeMigratedDatabases}=await import('./_storage_schema.ts');
 const {default:router}=await import('../src/routes/admin_cloudflare_sources.ts');
 const journey=async(r:any)=>{
  const db=migratedDatabase(),original=globalThis.fetch,secret='synthetic-source-write-key'.repeat(3);let calls=0;
  try{
   db.exec("INSERT INTO users(id,name,email,role,is_active) VALUES (66,'Hq','hq@example.test','admin',1);INSERT INTO super_admins(user_id) VALUES (66);INSERT INTO user_sessions(jti,user_id,factor,created_at,last_step_up_at) VALUES ('source-totp',66,'totp',datetime('now'),datetime('now'));");
   const token=await new SignJWT({user_id:66}).setJti('source-totp').setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
   const app=new Hono<any>();app.route('/source',r);const env={JWT_SECRET:secret,ENVIRONMENT:'development',DB:d1Over(db),CF_SOURCE_POLL:'on',CF_OBSERVER_READ_TOKEN:'synthetic-read-only',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
   globalThis.fetch=async()=>{calls++;throw Error('synthetic provider offline');};
   const post=()=>app.request('https://unit.test/source/reconcile',{method:'POST',headers:{Authorization:'Bearer '+token}},env);
   for(const script of ['studioos','studioos-meeting-bot','studioos-meeting-bot-preview','studioos-tail']){
    db.exec('DELETE FROM cf_source_cursors');await d1CfSourceStore(env.DB as any).read('deployments:'+script);
    db.prepare('UPDATE cf_source_cursors SET through_ms=?').run(Date.now());const response=await post();
    assert.equal(response.status,429,script);assert.equal(calls,0,script+' must not poll during the route cooldown');
   }
   db.prepare('UPDATE cf_source_cursors SET through_ms=0').run();const response=await post();assert.equal(response.status,200);assert.equal((await response.json()).state,'unknown');assert.ok(calls>0);
  }finally{globalThis.fetch=original;db.close();removeMigratedDatabases();}
 };
 await journey(router);
 const dir=mkdtempSync(join(tmpdir(),'cf-source-cooldown-'));
 try{
  const url=new URL('../src/routes/admin_cloudflare_sources.ts',import.meta.url);let broken=readFileSync(url,'utf8');
  broken=broken.replaceAll(/from '([^']+)'/g,(whole,name)=>name.startsWith('.')?'from '+JSON.stringify(new URL(name+'.ts',url).href):name==='hono'?'from '+JSON.stringify(import.meta.resolve('hono')):whole);
  assert.ok(broken.includes('cursors.some('));broken=broken.replace('cursors.some(','cursors.slice(0,1).some(');const file=join(dir,'cooldown.ts');writeFileSync(file,broken);
  await assert.rejects(journey((await import(pathToFileURL(file).href)).default),'single-script cooldown mutation must fail the real route');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
