/** D895 / migration 549: upgrade and real route claims, using synthetic data. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks, { createShareLink, deckShareMetrics, SHARE_VIEWER_COOKIE } from '../src/routes/decks.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const read = (p:string) => readFileSync(p,'utf8');
const migration = read('cloudflare-worker/sql/migrations/549_deck_share_nullable_view_limit.sql');
const source = read('cloudflare-worker/src/routes/decks.ts');
const scratch = mkdtempSync(join(tmpdir(),'deck-null-d895-'));
const seed = join(scratch,'schema.sqlite');
const schema = new DatabaseSync(seed,{enableForeignKeyConstraints:false});
schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
// The seed is the schema just before 549; the upgrade runs 549, then every later
// migration in order, as production does (D902's 567 adds columns 549's rebuild would drop).
const numbered=readdirSync('cloudflare-worker/sql/migrations').filter(n=>/^\d+_.*\.sql$/.test(n)&&migrationNumber(n)>BASELINE_CUTOFF).sort();
for(const name of numbered.filter(n=>migrationNumber(n)<549))schema.exec(read('cloudflare-worker/sql/migrations/'+name));
const later=numbered.filter(n=>migrationNumber(n)>549).map(n=>read('cloudflare-worker/sql/migrations/'+n));
schema.close();
after(()=>rmSync(scratch,{recursive:true,force:true}));
let serial=0;
const JWT_SECRET='synthetic-null-view-limit-d895-not-a-real-secret';
function fixture(upgrade=true){
 const path=join(scratch,`${++serial}.sqlite`);copyFileSync(seed,path);
 const db=new DatabaseSync(path,{enableForeignKeyConstraints:true});
 db.exec("INSERT INTO founders(id,name,email) VALUES(1001,'Synthetic Founder','founder@example.invalid'); INSERT INTO users(id,role,founder_id,name,email,is_active,subscription_tier) VALUES(2,'founder',1001,'Synthetic Founder','founder@example.invalid',1,'studio'); INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic Venture',1001); INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,'[]','Synthetic Deck',1,2)");
 if(upgrade){db.exec(migration);for(const sql of later)db.exec(sql);}
 const env:any={DB:d1Over(db),JWT_SECRET,ENVIRONMENT:'development'};
 const app=new Hono<any>().route('/api/decks',decks).route('/api/cycles/raise',cycleRaise);
 app.onError((err,c)=>c.json({error:err.message},(AUTH_ERROR_STATUSES[err.message]||500) as any));
 return {db,env,app};
}
type F=ReturnType<typeof fixture>;
async function call(f:F,path:string,method='GET',body?:unknown,auth=false,cookie?:string){
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(auth)headers.Authorization='Bearer '+await new SignJWT({user_id:2}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
 if(cookie)headers.Cookie=cookie;
 const r=await f.app.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})},f.env);
 return {status:r.status,body:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const open=(f:F,token:string,cookie?:string)=>call(f,'/api/decks/share/'+token,'GET',undefined,false,cookie);
const make=(f:F,extra:Record<string,unknown>={})=>createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1,...extra});
const row=(f:F,id:number|null)=>f.db.prepare('SELECT * FROM pitch_deck_share_tokens WHERE id=?').get(id) as any;
const nviews=(f:F)=>Number(f.db.prepare('SELECT COUNT(*) n FROM deck_share_views').get()!.n);

function legacy(f:F,id:number,limit:number,extra:Record<string,unknown>={}){
 f.db.prepare(`INSERT INTO pitch_deck_share_tokens(id,deck_id,token_hash,expires_at,used_at,created_by,created_at,view_limit,view_count,last_viewed_at,revoked_at,prospect_id,investor_label,allow_download,allow_forwarding,bound_viewer_hash)
 VALUES(?,10,?,'2099-01-01T00:00:00Z',?,2,'2020-01-01',?,?,?, ?,7,'Synthetic investor',0,0,'synthetic-browser-hash')`).run(id,'synthetic-hash-'+id,extra.used_at??null,limit,extra.view_count??4,'2025-01-01',extra.revoked_at??null);
}

test('549 preserves every token field and telemetry reference, changing only the unlimited sentinel',()=>{
 const f=fixture(false);try{
 f.db.exec("INSERT INTO raise_prospects(id,uid,project_id,name) VALUES(7,'synthetic-prospect',1,'Synthetic Prospect')");
 legacy(f,1,2147483647);legacy(f,2,3,{used_at:'2025-02-01',view_count:3});legacy(f,3,0,{revoked_at:'2025-03-01'});legacy(f,4,99);
 f.db.exec("INSERT INTO deck_share_views(id,share_token_id,deck_id,read_seconds) VALUES(51,1,10,17); INSERT INTO deck_share_conversions(id,share_token_id,deck_id,type) VALUES(61,1,10,'signup')");
 const before=f.db.prepare('SELECT * FROM pitch_deck_share_tokens ORDER BY id').all() as any[];
 const columns=f.db.prepare('PRAGMA table_info(pitch_deck_share_tokens)').all() as any[];
 const views=f.db.prepare('SELECT * FROM deck_share_views').all(),conversions=f.db.prepare('SELECT * FROM deck_share_conversions').all();
 const indexes=()=> (f.db.prepare('PRAGMA index_list(pitch_deck_share_tokens)').all() as any[]).map(i=>({name:i.origin==='u'?'unique constraint':i.name,unique:i.unique,origin:i.origin,partial:i.partial,columns:(f.db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name) as any[]).map(c=>c.name)})).sort((a,b)=>a.name.localeCompare(b.name));
 const oldIndexes=indexes();
 assert.doesNotThrow(()=>f.db.exec(migration));
 assert.deepEqual(indexes(),oldIndexes);
 assert.deepEqual((f.db.prepare('SELECT * FROM pitch_deck_share_tokens ORDER BY id').all() as any[]).map(r=>({...r})),before.map(r=>({...r,view_limit:r.view_limit===2147483647?null:r.view_limit})));
 assert.deepEqual((f.db.prepare('PRAGMA table_info(pitch_deck_share_tokens)').all() as any[]).map(r=>({...r})),columns.map(c=>({...c,notnull:c.name==='view_limit'?0:c.notnull})));
 assert.deepEqual(f.db.prepare('SELECT * FROM deck_share_views').all(),views);assert.deepEqual(f.db.prepare('SELECT * FROM deck_share_conversions').all(),conversions);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='deck_share_sequence_d895'").get()!.n,0);
 }finally{f.db.close();}
});

test('549 retains token uniqueness, lookup index, settings checks and prospect SET NULL',()=>{
 const f=fixture(false);try{
 f.db.exec("INSERT INTO raise_prospects(id,uid,project_id) VALUES(7,'synthetic-prospect',1)");legacy(f,1,2147483647);f.db.exec(migration);
 assert.ok((f.db.prepare('PRAGMA index_list(pitch_deck_share_tokens)').all() as any[]).some(i=>i.name==='idx_deck_share_hash'));
 assert.throws(()=>f.db.exec("INSERT INTO pitch_deck_share_tokens(deck_id,token_hash,expires_at) VALUES(10,'synthetic-hash-1','2099-01-01')"),/UNIQUE/);
 for(const sql of ['UPDATE pitch_deck_share_tokens SET allow_download=2 WHERE id=1','UPDATE pitch_deck_share_tokens SET allow_forwarding=2 WHERE id=1'])assert.throws(()=>f.db.prepare(sql).run(),/CHECK/);
 assert.throws(()=>f.db.exec('UPDATE pitch_deck_share_tokens SET prospect_id=999 WHERE id=1'),/FOREIGN KEY/);
 f.db.exec('DELETE FROM raise_prospects WHERE id=7');assert.equal(row(f,1).prospect_id,null);assert.ok(row(f,1));
 }finally{f.db.close();}
});

for(const empty of [false,true])test(`549 preserves deleted-id high-water mark with ${empty?'no':'some'} surviving tokens`,()=>{
 const f=fixture(false);try{
 f.db.exec("INSERT INTO pitch_deck_share_tokens(id,deck_id,token_hash,expires_at) VALUES(1,10,'survivor','2099-01-01'),(900,10,'deleted','2099-01-01'); DELETE FROM pitch_deck_share_tokens WHERE id=900");
 if(empty)f.db.exec('DELETE FROM pitch_deck_share_tokens');f.db.exec(migration);
 const inserted=f.db.prepare("INSERT INTO pitch_deck_share_tokens(deck_id,token_hash,expires_at,view_limit) VALUES(10,'next','2099-01-01',NULL)").run();assert.ok(Number(inserted.lastInsertRowid)>900);
 }finally{f.db.close();}
});

for(const value of [undefined,null,2147483647])test(`549 module writer stores SQL NULL for ${String(value)} unlimited cap`,async()=>{
 const f=fixture();try{const link=await make(f,{viewLimit:value});assert.equal(row(f,link.id).view_limit,null);assert.equal((await open(f,link.token)).status,200);assert.equal(row(f,link.id).used_at,null);
 const engagement=await call(f,'/api/decks/10/engagement','GET',undefined,true);assert.equal(engagement.status,200);const share=engagement.body.shares.find((s:any)=>s.id===link.id);assert.equal(share.view_limit,null);assert.equal(share.view_count,1);assert.equal(share.exhausted,false);
 }finally{f.db.close();}
});

test('549 Raise module route creates an unlimited row while editor defaults stay finite',async()=>{
 const f=fixture();try{
 const module=await call(f,'/api/cycles/raise/deck-links?project=1','POST',{deck_id:10,investor_label:'Synthetic investor',expires_days:null},true);assert.equal(module.status,201,JSON.stringify(module.body));
 assert.equal((f.db.prepare('SELECT view_limit FROM pitch_deck_share_tokens ORDER BY id LIMIT 1').get() as any).view_limit,null);
 const editor=await call(f,'/api/decks/10/share','POST',{},true);assert.equal(editor.status,200,JSON.stringify(editor.body));assert.equal(editor.body.view_limit,1);assert.equal(row(f,editor.body.share_id??editor.body.id).view_limit,1);
 const rows=f.db.prepare('SELECT view_limit FROM pitch_deck_share_tokens ORDER BY id').all() as any[];assert.deepEqual(rows.map(r=>r.view_limit),[null,1]);
 }finally{f.db.close();}
});

test('549 unlimited opens cross the legacy sentinel without being marked used',async()=>{
 const f=fixture();try{const link=await make(f);f.db.prepare('UPDATE pitch_deck_share_tokens SET view_count=2147483646 WHERE id=?').run(link.id);
 for(let i=0;i<4;i++)assert.equal((await open(f,link.token)).status,200);
 assert.equal(row(f,link.id).view_count,2147483650);assert.equal(row(f,link.id).used_at,null);assert.equal(nviews(f),4);
 }finally{f.db.close();}
});

for(const limit of [null,3])test(`549 concurrent opens obey ${limit===null?'unlimited':'finite'} capacity atomically`,async()=>{
 const f=fixture();try{const link=await make(f,{viewLimit:limit});const responses=await Promise.all(Array.from({length:8},()=>open(f,link.token)));const accepted=limit===null?8:3;
 assert.equal(responses.filter(r=>r.status===200).length,accepted);assert.equal(responses.filter(r=>r.status===410).length,8-accepted);assert.equal(row(f,link.id).view_count,accepted);assert.equal(nviews(f),accepted);assert.equal(!!row(f,link.id).used_at,limit!==null);
 }finally{f.db.close();}
});

for(const condition of ['expired','revoked','used'])test(`549 NULL limit does not reopen a ${condition} link`,async()=>{
 const f=fixture();try{const link=await make(f);
 if(condition==='expired')f.db.prepare("UPDATE pitch_deck_share_tokens SET expires_at='2000-01-01' WHERE id=?").run(link.id);
 if(condition==='revoked')f.db.prepare("UPDATE pitch_deck_share_tokens SET revoked_at='2020-01-01' WHERE id=?").run(link.id);
 if(condition==='used')f.db.prepare("UPDATE pitch_deck_share_tokens SET used_at='2020-01-01' WHERE id=?").run(link.id);
 assert.equal((await open(f,link.token)).status,410);assert.equal(row(f,link.id).view_count,0);assert.equal(nviews(f),0);
 }finally{f.db.close();}
});

test('549 NULL limits retain browser binding and count only admitted opens',async()=>{
 const f=fixture();try{const link=await make(f,{allowForwarding:false,allowDownload:false});const first=await open(f,link.token);assert.equal(first.status,200);assert.ok(first.cookie);
 assert.equal((await open(f,link.token,`${SHARE_VIEWER_COOKIE}=${'x'.repeat(32)}`)).status,403);assert.equal((await open(f,link.token,first.cookie)).status,200);assert.equal(row(f,link.id).view_count,2);assert.equal(nviews(f),2);assert.equal(row(f,link.id).allow_download,0);
 }finally{f.db.close();}
});

for(const missingColumn of [false,true])test(`549 ${missingColumn?'legacy missing-column':'fresh table'} bootstrap is nullable with a finite SQL default`,async()=>{
 const f=fixture();try{
 f.db.exec('DROP TABLE pitch_deck_share_tokens');
 if(missingColumn){const start=source.indexOf('`CREATE TABLE IF NOT EXISTS pitch_deck_share_tokens (')+1;const ddl=source.slice(start,source.indexOf('`',start)).replace(/^\s*view_limit INTEGER[^\n]*\n/m,'');f.db.exec(ddl);}
 const read=await call(f,'/api/decks/10/engagement','GET',undefined,true);assert.equal(read.status,200);
 const col:any=f.db.prepare('PRAGMA table_info(pitch_deck_share_tokens)').all().find((c:any)=>c.name==='view_limit');assert.equal(col.notnull,0);assert.equal(col.dflt_value,'1');
 const link=await make(f);assert.equal(row(f,link.id).view_limit,null);assert.equal((await open(f,link.token)).status,200);
 f.db.exec("INSERT INTO pitch_deck_share_tokens(deck_id,token_hash,expires_at) VALUES(10,'default-finite','2099-01-01')");assert.equal((f.db.prepare("SELECT view_limit FROM pitch_deck_share_tokens WHERE token_hash='default-finite'").get() as any).view_limit,1);
 }finally{f.db.close();}
});

test('549 metric compatibility keeps historical sentinel NULL and real finite values',()=>{
 assert.deepEqual(deckShareMetrics({view_limit:2147483647,view_count:0}),{view_limit:null,view_count:0,exhausted:false});
 assert.deepEqual(deckShareMetrics({view_limit:null,view_count:2147483648}),{view_limit:null,view_count:2147483648,exhausted:false});
 assert.deepEqual(deckShareMetrics({view_limit:1,view_count:1,used_at:'2020-01-01'}),{view_limit:1,view_count:1,exhausted:true});
});

test('549 a finite cap rejects an exhausted count even when used_at is missing',async()=>{
 const f=fixture();try{const link=await make(f,{viewLimit:3});f.db.prepare('UPDATE pitch_deck_share_tokens SET view_count=3,used_at=NULL WHERE id=?').run(link.id);
 assert.equal((await open(f,link.token)).status,410);assert.equal(row(f,link.id).view_count,3);assert.equal(row(f,link.id).used_at,null);assert.equal(nviews(f),0);
 }finally{f.db.close();}
});
