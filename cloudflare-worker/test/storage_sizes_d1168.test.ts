/** D1168 / migration 605: actual migrated SQLite, synthetic objects only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {format} from 'node:util';
import {Hono} from 'hono';
import {SignJWT} from 'jose';
import {BASELINE_CUTOFF,migrationNumber,compareMigrations} from '../../scripts/lib/migrationPlan.mjs';
import {d1Over} from './_d1_sqlite.mjs';
import {AUTH_ERROR_STATUSES} from '../src/util/authErrors.ts';
import platform from '../src/routes/admin_platform.ts';
import brand from '../src/routes/brand.ts';
import settings from '../src/routes/settings.ts';
import imports from '../src/routes/imports.ts';
import {backfillMemberFileSizes} from '../src/services/memberFileSizeBackfill.ts';
import {memberFileStatement} from '../src/services/memberFiles.ts';
const ROOT=new URL('../sql/',import.meta.url),SECRET='synthetic-storage-test-secret-'.repeat(3);
const build=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});
build.exec(readFileSync(new URL('schema_baseline.sql',ROOT),'utf8'));
for(const name of readdirSync(new URL('migrations/',ROOT)).filter(n=>/^\d+_.*\.sql$/.test(n)&&migrationNumber(n)>BASELINE_CUTOFF).sort(compareMigrations))build.exec(readFileSync(new URL('migrations/'+name,ROOT),'utf8'));
const ddl=build.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map(x=>String(x.sql));build.close();
// Replay the actual migrated DDL once; each case receives a disposable exact
// copy, avoiding tens of thousands of redundant CREATE statements per run.
const workdir=mkdtempSync(join(tmpdir(),'storage-size-test-')),templatePath=join(workdir,'template.sqlite');
const template=new DatabaseSync(templatePath,{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});
for(const sql of ddl)template.exec(sql);template.close();let fixtureNumber=0;
const logLines:string[]=[];const originalConsole=new Map();
test.before(()=>{for(const key of ['log','info','warn','error','debug']as const){originalConsole.set(key,console[key]);console[key]=(...args:any[])=>{logLines.push(format(...args));};}});
test.after(()=>{rmSync(workdir,{recursive:true,force:true});for(const [key,value]of originalConsole)(console as any)[key]=value;for(const secret of ['synthetic-private','headshots/3/gone.png','brand-logos/3/live.svg','Zoë'])assert.ok(!logLines.join(' ').includes(secret),'logs hold outcomes and counts only');});
function fixture(){
 const dbPath=join(workdir,'case-'+(++fixtureNumber)+'.sqlite');copyFileSync(templatePath,dbPath);
 const db=new DatabaseSync(dbPath,{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});
 db.exec("INSERT INTO member_file_size_backfill_state(uid,phase) VALUES ('member-files-v1','headshot_rows')");
 db.exec("INSERT INTO users(id,name,email,role) VALUES (1,'Staff test','staff@example.test','admin'),(2,'Admin test','admin@example.test','admin'),(3,'Member test','member@example.test','investor');INSERT INTO super_admins(user_id) VALUES (1)");
 const session=db.prepare("INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES (?,?,?,datetime('now',?))");
 for(const id of [1,2,3])session.run(id,'good-'+id,'totp','+0 seconds');session.run(1,'weak','password','+0 seconds');session.run(1,'stale','totp','-2 days');
 const objects=new Map<string,Uint8Array>(),heads:string[]=[],lists:any[]=[],writes:string[]=[],deletes:string[]=[],sqls:string[]=[];
 let headHook:((key:string)=>any)|null=null,fail:RegExp|null=null;
 const native=d1Over(db);const env:any={JWT_SECRET:SECRET,ENVIRONMENT:'development',DB:{prepare(sql:string){sqls.push(sql);if(fail?.test(sql))throw Error('synthetic-private-db-key');return native.prepare(sql);},batch:(s:any[])=>native.batch(s)},FILES:{
  async head(key:string){heads.push(key);if(headHook)return headHook(key);return objects.has(key)?{size:objects.get(key)!.byteLength}:null;},
  async list(opts:any){lists.push(opts);const all=[...objects.keys()].filter(k=>k.startsWith(opts.prefix)).sort(),at=Number(opts.cursor||0),keys=all.slice(at,at+opts.limit),next=at+keys.length;return {objects:keys.map(key=>({key,size:objects.get(key)!.byteLength})),truncated:next<all.length,...(next<all.length?{cursor:String(next)}:{})};},
  async put(key:string,data:any){writes.push(key);objects.set(key,typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data));},
  async delete(key:string){deletes.push(key);objects.delete(key);},
  async get(){throw Error('backfill must never read content');},
 }};
 const app=new Hono<any>();app.route('/platform',platform);app.route('/brand',brand);app.route('/settings',settings);app.route('/imports',imports);
 app.onError((e,c)=>c.json({code:AUTH_ERROR_STATUSES[e.message]?'denied':'unreadable'},AUTH_ERROR_STATUSES[e.message]||503));
 async function call(path='/platform/storage/backfill-sizes',body:any={limit:2},actor=1,jti='good-'+actor){
  const token=await new SignJWT({user_id:actor,jti}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const form=body instanceof FormData;const res=await app.request(path,{method:'POST',headers:{Authorization:'Bearer '+token,...(!form?{'Content-Type':'application/json'}:{})},body:form?body:JSON.stringify(body)},env);
  return {status:res.status,body:await res.json()as any,headers:res.headers};
 }
 return {db,env,objects,heads,lists,writes,deletes,sqls,call,hook:(h:typeof headHook)=>{headHook=h;},fail:(r:RegExp|null)=>{fail=r;}};
}
function seedRows(f:ReturnType<typeof fixture>){
 f.db.exec("INSERT INTO demand_signals(id,project_id,kind,signal_date,evidence_file_key) VALUES (1,1,'loi','2026-01-01','validate-evidence/1/a.pdf');INSERT INTO formation_steps(id,project_id,title,created_by,proof_file_key) VALUES (1,1,'Filing',1,'build-proof/1/a.pdf');INSERT INTO entity_obligations(id,uid,entity_id,kind,title,cadence,proof_file_key) VALUES (1,'obl',1,'annual_report','Report','annual','build-proof/1/b.pdf');INSERT INTO obligation_occurrences(id,uid,event_id,held_on,minutes_file_key) VALUES (1,'occ',1,'2026-01-01','grow-minutes/1/a.pdf');INSERT INTO data_imports(id,user_id,source,target,raw_file_r2_key) VALUES (1,3,'spreadsheet','contacts','imports/3/a.csv')");
 for(const [key,n]of [['validate-evidence/1/a.pdf',11],['build-proof/1/a.pdf',12],['build-proof/1/b.pdf',13],['grow-minutes/1/a.pdf',14],['imports/3/a.csv',15]]as const)f.objects.set(key,new Uint8Array(n));
}
const rows=(db:any)=>['demand_signals','formation_steps','entity_obligations','obligation_occurrences','data_imports'].map(t=>db.prepare('SELECT size_bytes,size_missing_at FROM '+t+' WHERE id=1').get());

test('D1168: migration keeps legacy sizes unknown, adds no users column, and rejects negative sizes',()=>{
 const f=fixture();try{seedRows(f);for(const row of rows(f.db)){assert.equal(row.size_bytes,null);assert.equal(row.size_missing_at,null);}assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name='size_bytes'").get()!.n,0);assert.throws(()=>f.db.prepare('UPDATE demand_signals SET size_bytes=-1').run());assert.throws(()=>f.db.prepare('UPDATE demand_signals SET size_bytes=1.5').run());assert.throws(()=>f.db.prepare("INSERT INTO member_files(uid,r2_key,kind,size_bytes) VALUES ('x','x','headshot',-1)").run());}finally{f.db.close();}
});
test('D1168: all five row stores resume in bounded batches and record actual HEAD sizes',async()=>{
 const f=fixture();try{seedRows(f);let out:any;for(let i=0;i<8;i++){const before=f.heads.length;out=await backfillMemberFileSizes(f.env,1,2);assert.ok(f.heads.length-before<=2);assert.equal(out.checked,f.heads.length-before);const receipt=JSON.parse(String(f.db.prepare("SELECT details FROM activity_logs WHERE action='member_file_size_backfill' ORDER BY id DESC LIMIT 1").get()!.details));assert.deepEqual(receipt,Object.fromEntries(Object.entries(out).filter(([key])=>key!=='complete')));if(out.complete)break;}assert.equal(out.complete,true);assert.equal(out.outcome,'complete');assert.deepEqual(Object.keys(out).sort(),['changed','checked','complete','failed','missing','outcome','recorded','unattributed']);assert.deepEqual(rows(f.db).map(r=>r.size_bytes),[11,12,13,14,15]);assert.equal(new Set(f.heads).size,5);assert.equal(f.heads.length,5);assert.equal(f.writes.length,0);assert.equal(f.deletes.length,0);const text=JSON.stringify(f.db.prepare("SELECT details FROM activity_logs WHERE action='member_file_size_backfill'").all());assert.ok(!text.includes('a.pdf'));assert.ok(!text.includes('r2_key'));assert.ok(text.includes('recorded'));const gate=f.sqls.findIndex(s=>s.includes('INSERT INTO activity_logs'));assert.ok(gate>=0);assert.ok(f.sqls.findIndex(s=>s.includes('SELECT u.id AS owner_user_id'))>gate);}finally{f.db.close();}
});
test('D1168: missing is marked without losing the key; a measured empty object is a real zero',async()=>{
 const f=fixture();try{seedRows(f);f.objects.delete('validate-evidence/1/a.pdf');f.objects.set('build-proof/1/a.pdf',new Uint8Array());const out=await backfillMemberFileSizes(f.env,1,20);assert.equal(out.missing,1);const [missing,empty]=rows(f.db);assert.equal(missing.size_bytes,null);assert.match(missing.size_missing_at,/^\d{4}-/);assert.equal(f.db.prepare('SELECT evidence_file_key FROM demand_signals WHERE id=1').get()!.evidence_file_key,'validate-evidence/1/a.pdf');assert.equal(empty.size_bytes,0);assert.equal(empty.size_missing_at,null);await backfillMemberFileSizes(f.env,1,20);assert.equal(f.heads.filter(k=>k==='validate-evidence/1/a.pdf').length,1);}finally{f.db.close();}
});
test('D1168: HEAD failures stay retryable and never become missing or successful zero',async()=>{
 const f=fixture();try{seedRows(f);f.hook(()=>{throw Error('synthetic-private-object-key');});const bad=await backfillMemberFileSizes(f.env,1,20);assert.equal(bad.complete,false);assert.equal(bad.outcome,'unreadable');assert.equal(bad.failed,5);for(const row of rows(f.db)){assert.equal(row.size_bytes,null);assert.equal(row.size_missing_at,null);}assert.ok(!JSON.stringify(bad).includes('synthetic-private'));f.hook(null);const good=await backfillMemberFileSizes(f.env,1,20);assert.equal(good.recorded,5);assert.equal(good.failed,0);}finally{f.db.close();}
});
test('D1168: a late HEAD cannot overwrite a replaced, measured or missing file',async()=>{
 for(const change of ["evidence_file_key='validate-evidence/1/new.pdf',size_bytes=NULL","size_bytes=99","size_bytes=NULL,size_missing_at='2026-01-01'"]){
 const f=fixture();try{seedRows(f);f.hook(()=>{f.db.exec('UPDATE demand_signals SET '+change+' WHERE id=1');return {size:10};});const out=await backfillMemberFileSizes(f.env,1,1);assert.equal(out.changed,1);const row=f.db.prepare('SELECT evidence_file_key,size_bytes,size_missing_at FROM demand_signals WHERE id=1').get()!;assert.equal(row.size_bytes,change==='size_bytes=99'?99:null);if(change.includes('new.pdf'))assert.equal(row.evidence_file_key,'validate-evidence/1/new.pdf');if(change.includes('size_missing_at'))assert.equal(row.size_missing_at,'2026-01-01');}finally{f.db.close();}
 }
});
test('D1168: legacy profile pointers and paginated R2 namespaces are discovered and checkpointed',async()=>{
 const f=fixture();try{
 f.db.prepare("UPDATE users SET headshot_r2_key='headshots/3/gone.png' WHERE id=3").run();
 f.db.prepare("INSERT INTO landing_pages(project_id,slug,name,logo_asset_id,logo_dark_asset_id) VALUES (1,'test','Page','brand-logos/3/gone.svg','brand-logos/3/live.svg')").run();
 for(const key of ['headshots/3/one.png','headshots/3/two.png','brand-logos/3/live.svg','brand-logos/999/orphan.svg'])f.objects.set(key,new Uint8Array(17));
 const first=await backfillMemberFileSizes(f.env,1,1);assert.equal(first.complete,false);assert.equal(f.db.prepare('SELECT row_cursor FROM member_file_size_backfill_state').get()!.row_cursor,3);
 let out=first,unattributed=first.unattributed;for(let i=0;i<20&&!out.complete;i++){out=await backfillMemberFileSizes({...f.env},1,1);unattributed+=out.unattributed;}assert.equal(unattributed,1);
 assert.equal(out.complete,true);const files=f.db.prepare('SELECT r2_key,owner_user_id,size_bytes,size_missing_at FROM member_files').all();assert.equal(files.length,6);assert.equal(files.filter(x=>x.size_missing_at!==null).length,2);assert.equal(files.find(x=>x.r2_key==='brand-logos/3/live.svg')!.size_bytes,17);assert.equal(files.find(x=>x.r2_key==='brand-logos/999/orphan.svg')!.owner_user_id,null);assert.equal(f.db.prepare('SELECT phase FROM member_file_size_backfill_state').get()!.phase,'done');assert.ok(f.lists.some(x=>x.cursor==='1'));assert.ok(!JSON.stringify(out).includes('brand-logos/'));assert.equal(f.deletes.length,0);
 }finally{f.db.close();}
});
test('D1168: R2 discovery failures cannot claim completion but known rows still backfill',async()=>{
 const f=fixture();try{seedRows(f);f.db.prepare("UPDATE member_file_size_backfill_state SET phase='headshots'").run();f.env.FILES.list=async()=>{throw Error('synthetic-private-list-key');};const out=await backfillMemberFileSizes(f.env,1,20);assert.equal(out.recorded,5);assert.equal(out.failed,1);assert.equal(out.complete,false);assert.equal(out.outcome,'unreadable');assert.equal(f.db.prepare('SELECT phase FROM member_file_size_backfill_state').get()!.phase,'headshots');}finally{f.db.close();}
});
test('D1168: Super Admin, HQ, TOTP and recent step-up gate the backfill before any object calls',async()=>{
 const f=fixture();try{for(const [actor,jti]of [[2,'good-2'],[3,'good-3'],[1,'weak'],[1,'stale']]as const){const r=await f.call(undefined,{limit:2},actor,jti);assert.equal(r.status,403);}f.env.BRANCH_CODE='test-branch';assert.equal((await f.call()).status,403);assert.equal(f.heads.length,0);assert.equal(f.lists.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n,0);}finally{f.db.close();}
});
test('D1168: invalid limits/keys are refused, valid empty history is complete and no-store',async()=>{
 const f=fixture();try{for(const body of [{limit:0},{limit:21},{limit:1.5},{limit:'2'},{key:'secret'},[],null])assert.equal((await f.call(undefined,body)).status,400);const r=await f.call();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.body.recorded,0);assert.equal(r.body.complete,false);assert.equal(r.body.outcome,'partial');let done=r;for(let i=0;i<4&&!done.body.complete;i++)done=await f.call();assert.equal(done.body.complete,true);}finally{f.db.close();}
});
test('D1168: failed audit/store reads never return a successful empty batch or private errors',async()=>{
 for(const fail of [/INSERT INTO activity_logs/,/SELECT 'demand'/,/UPDATE activity_logs/]){const f=fixture();try{f.fail(fail);const r=await f.call();assert.equal(r.status,503);assert.equal(r.body.recorded,undefined);assert.ok(!JSON.stringify(r.body).includes('synthetic-private'));if(fail.source.startsWith('INSERT'))assert.equal(f.lists.length,0);}finally{f.db.close();}}
});
test('D1168: brand upload records its sanitized bytes with its key and caller; inline has no R2 row',async()=>{
 const f=fixture();try{const form=new FormData();form.set('file',new File(['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],'synthetic.svg',{type:'image/svg+xml'}));const r=await f.call('/brand/logo/upload',form,3);assert.equal(r.status,200,JSON.stringify(r.body));const row=f.db.prepare('SELECT * FROM member_files WHERE r2_key=?').get(r.body.asset_id)!;assert.equal(row.owner_user_id,3);assert.equal(row.kind,'brand_logo');assert.equal(row.size_bytes,f.objects.get(r.body.asset_id)!.byteLength);assert.equal(row.size_missing_at,null);delete f.env.FILES;assert.equal((await f.call('/brand/logo/upload',form,3)).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_files').get()!.n,1);}finally{f.db.close();}
});
test('D1168: headshot pointer and size commit atomically; replacement cleanup marks the former object missing',async()=>{
 const f=fixture();try{const body={data_uri:'data:image/png;base64,'+btoa('synthetic-png')};const first=await f.call('/settings/headshot',body,3);assert.equal(first.status,200,JSON.stringify(first.body));const a=f.db.prepare('SELECT * FROM member_files').get()!;assert.equal(a.size_bytes,13);assert.equal(a.owner_user_id,3);assert.equal(a.kind,'headshot');assert.equal(f.db.prepare('SELECT headshot_r2_key FROM users WHERE id=3').get()!.headshot_r2_key,a.r2_key);const second=await f.call('/settings/headshot',body,3);assert.equal(second.status,200);const old=f.db.prepare('SELECT * FROM member_files WHERE id=?').get(a.id)!;assert.equal(old.size_bytes,null);assert.ok(old.size_missing_at);const current=f.db.prepare('SELECT * FROM member_files WHERE r2_key=(SELECT headshot_r2_key FROM users WHERE id=3)').get()!;assert.equal(current.size_bytes,13);f.db.exec("CREATE TRIGGER reject_member_file BEFORE INSERT ON member_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");assert.equal((await f.call('/settings/headshot',body,3)).status,503);assert.equal(f.db.prepare('SELECT headshot_r2_key FROM users WHERE id=3').get()!.headshot_r2_key,current.r2_key);}finally{f.db.close();}
});
test('D1168: CSV import measures UTF-8 bytes and never records a size when storing failed',async()=>{
 const f=fixture();try{const csv='first_name,last_name,email\nZoë,Test,z@example.test\n',body={csv,target:'contacts',mapping:{first_name:'first_name',last_name:'last_name',email:'email'}};const r=await f.call('/imports/universal/commit',body,1);assert.equal(r.status,200,JSON.stringify(r.body));const row=f.db.prepare('SELECT raw_file_r2_key,size_bytes FROM data_imports ORDER BY id DESC LIMIT 1').get()!;assert.equal(row.size_bytes,new TextEncoder().encode(csv).byteLength);assert.notEqual(row.size_bytes,csv.length);assert.equal(row.size_bytes,f.objects.get(String(row.raw_file_r2_key))!.byteLength);f.env.FILES.put=async()=>{throw Error('synthetic-private-object-key');};assert.equal((await f.call('/imports/universal/commit',body,1)).status,200);const absent=f.db.prepare('SELECT raw_file_r2_key,size_bytes FROM data_imports ORDER BY id DESC LIMIT 1').get()!;assert.equal(absent.raw_file_r2_key,null);assert.equal(absent.size_bytes,null);}finally{f.db.close();}
});
test('D1168: member-file upserts are idempotent and measured sizes cannot be negative or fractional',async()=>{
 const f=fixture();try{await memberFileStatement(f.env,'brand-logos/3/a.svg',3,'brand_logo',10).run();await memberFileStatement(f.env,'brand-logos/3/a.svg',3,'brand_logo',11).run();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_files').get()!.n,1);assert.equal(f.db.prepare('SELECT size_bytes FROM member_files').get()!.size_bytes,11);for(const size of [-1,1.5,NaN,Infinity])assert.throws(()=>memberFileStatement(f.env,'brand-logos/3/b.svg',3,'brand_logo',size));}finally{f.db.close();}
});


test('D1168: LinkedIn photo import also commits its headshot pointer with measured metadata',async()=>{
 const f=fixture(),real=globalThis.fetch;let fetched=0;
 globalThis.fetch=async()=>{fetched++;return new Response(new Uint8Array([1,2,3,4,5]),{headers:{'content-type':'image/png'}});};
 try{const body={photo_url:'https://media.licdn.com/dms/image/synthetic'};
  const r=await f.call('/settings/profile/linkedin-import/apply',body,3);assert.equal(r.status,200);assert.equal(r.body.photo_applied,true);assert.equal(fetched,1);
  const row=f.db.prepare('SELECT * FROM member_files').get()!;assert.equal(row.size_bytes,5);assert.equal(row.kind,'headshot');assert.equal(row.owner_user_id,3);assert.equal(f.db.prepare('SELECT headshot_r2_key FROM users WHERE id=3').get()!.headshot_r2_key,row.r2_key);
  f.db.exec("CREATE TRIGGER reject_member_file BEFORE INSERT ON member_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  const bad=await f.call('/settings/profile/linkedin-import/apply',body,3);assert.equal(bad.status,200);assert.equal(bad.body.photo_applied,false);assert.equal(f.db.prepare('SELECT headshot_r2_key FROM users WHERE id=3').get()!.headshot_r2_key,row.r2_key);
 }finally{globalThis.fetch=real;f.db.close();}
});


test('D1168: a failed brand metadata write refuses success; discovery can recover the stored object',async()=>{
 const f=fixture();try{const form=new FormData();form.set('file',new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'synthetic.svg',{type:'image/svg+xml'}));f.fail(/INSERT INTO member_files/);const r=await f.call('/brand/logo/upload',form,3);assert.equal(r.status,503);assert.equal(r.body.asset_id,undefined);assert.equal(f.objects.size,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_files').get()!.n,0);f.fail(null);let done=false;for(let i=0;i<8&&!done;i++)done=(await backfillMemberFileSizes(f.env,1,2)).complete;assert.equal(done,true);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_files WHERE size_bytes IS NOT NULL').get()!.n,1);assert.equal(f.deletes.length,0);}finally{f.db.close();}
});


test('D1168: discovery compare-and-set never rewinds another batch or changes another job',async()=>{
 for(const change of ["phase='brand_logos'","r2_cursor='opaque-token'","row_cursor=99"]){
  const f=fixture();try{
   f.db.prepare("INSERT INTO member_file_size_backfill_state(uid,phase) VALUES ('other-job','headshot_rows')").run();
   const batch=f.env.DB.batch;
   f.env.DB.batch=async(statements:any[])=>{f.db.exec("UPDATE member_file_size_backfill_state SET "+change+" WHERE uid='member-files-v1'");f.env.DB.batch=batch;return batch(statements);};
   const out=await backfillMemberFileSizes(f.env,1,2);assert.equal(out.failed,0);
   const state=f.db.prepare("SELECT phase,r2_cursor,row_cursor FROM member_file_size_backfill_state WHERE uid='member-files-v1'").get()!;
   if(change.startsWith('phase'))assert.equal(state.phase,'brand_logos');
   if(change.startsWith('r2_cursor'))assert.equal(state.r2_cursor,'opaque-token');
   if(change.startsWith('row_cursor'))assert.equal(state.row_cursor,99);
   assert.equal(f.db.prepare("SELECT phase FROM member_file_size_backfill_state WHERE uid='other-job'").get()!.phase,'headshot_rows');
  }finally{f.db.close();}
 }
});
test('D1168: discovery does not clear a size already recorded by an upload',async()=>{
 const f=fixture();try{f.objects.set('headshots/3/known.png',new Uint8Array(17));await memberFileStatement(f.env,'headshots/3/known.png',3,'headshot',17).run();let complete=false;for(let i=0;i<8&&!complete;i++)complete=(await backfillMemberFileSizes(f.env,1,2)).complete;assert.equal(complete,true);assert.equal(f.heads.length,0);assert.equal(f.db.prepare('SELECT size_bytes FROM member_files').get()!.size_bytes,17);}finally{f.db.close();}
});
test('D1168: a namespace listing cannot seed unrelated private keys',async()=>{
 const f=fixture();try{f.db.prepare("UPDATE member_file_size_backfill_state SET phase='headshots'").run();f.env.FILES.list=async()=>({objects:[{key:'kyc/3/synthetic.pdf',size:9}],truncated:false});const out=await backfillMemberFileSizes(f.env,1,2);assert.equal(out.failed,1);assert.equal(out.complete,false);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_files').get()!.n,0);assert.equal(f.heads.length,0);}finally{f.db.close();}
});
test('D1168: invalid HEAD sizes are unreadable before any measurement write',async()=>{
 for(const size of [-1,1.5,NaN,Infinity]){const f=fixture();try{seedRows(f);f.hook(()=>({size}));const out=await backfillMemberFileSizes(f.env,1,1);assert.equal(out.failed,1);assert.equal(out.recorded,0);assert.equal(out.missing,0);assert.ok(!f.sqls.some(q=>q.startsWith('UPDATE demand_signals SET size_bytes')));assert.equal(f.db.prepare('SELECT size_bytes FROM demand_signals WHERE id=1').get()!.size_bytes,null);}finally{f.db.close();}}
});


test('D1168: the bounded pending read uses partial indexes and does not sort the remaining inventory',async()=>{
 const f=fixture();try{seedRows(f);await backfillMemberFileSizes(f.env,1,2);const q=f.sqls.find(s=>s.startsWith("SELECT 'demand'"))!;const plan=f.db.prepare('EXPLAIN QUERY PLAN '+q).all(0,2,0,2,0,2,0,2,0,2,0,2,2).map(x=>String(x.detail)).join('\n');for(const name of ['idx_demand_signals_size_pending','idx_formation_steps_size_pending','idx_entity_obligations_size_pending','idx_obligation_occurrences_size_pending','idx_data_imports_size_pending','idx_member_files_pending'])assert.ok(plan.includes(name),name);assert.doesNotMatch(plan,/USE TEMP B-TREE/);}finally{f.db.close();}
});
test('D1168: a removed account leaves unattributed file metadata without blocking account deletion',async()=>{
 const f=fixture();try{await memberFileStatement(f.env,'headshots/3/kept.png',3,'headshot',12).run();f.db.prepare('DELETE FROM user_sessions WHERE user_id=3').run();f.db.exec('PRAGMA foreign_keys=ON');f.db.prepare('DELETE FROM users WHERE id=3').run();const row=f.db.prepare('SELECT owner_user_id,size_bytes FROM member_files').get()!;assert.equal(row.owner_user_id,null);assert.equal(row.size_bytes,12);assert.equal(f.deletes.length,0);}finally{f.db.close();}
});


test('D1168: zero-row or failed audit results gate all object calls',async()=>{
 for(const result of [{success:true,meta:{changes:0}},{success:false,meta:{changes:1}}]){const f=fixture();try{seedRows(f);const prepare=f.env.DB.prepare;f.env.DB.prepare=(sql:string)=>sql.startsWith('INSERT INTO activity_logs')?{bind(){return this;},async run(){return result;}}:prepare(sql);const r=await f.call();assert.equal(r.status,503);assert.equal(f.heads.length,0);assert.equal(f.lists.length,0);assert.equal(f.db.prepare('SELECT phase FROM member_file_size_backfill_state').get()!.phase,'headshot_rows');}finally{f.db.close();}}
});
test('D1168: failed final audit results cannot report successful completion',async()=>{
 for(const result of [{success:true,meta:{changes:0}},{success:false,meta:{changes:1}}]){const f=fixture();try{seedRows(f);const prepare=f.env.DB.prepare;f.env.DB.prepare=(sql:string)=>sql.startsWith('UPDATE activity_logs')?{bind(){return this;},async run(){return result;}}:prepare(sql);const r=await f.call();assert.equal(r.status,503);assert.equal(r.body.recorded,undefined);assert.ok(!JSON.stringify(r.body).includes('r2_key'));}finally{f.db.close();}}
});
test('D1168: failed metadata writes and discovery batches remain unreadable, not successful counts',async()=>{
 const f=fixture();try{seedRows(f);const prepare=f.env.DB.prepare;f.env.DB.prepare=(sql:string)=>sql.startsWith('UPDATE demand_signals SET size_bytes')?{bind(){return this;},async run(){return {success:false,meta:{changes:1}};}}:prepare(sql);const out=await backfillMemberFileSizes(f.env,1,1);assert.equal(out.failed,1);assert.equal(out.recorded,0);assert.equal(f.db.prepare('SELECT size_bytes FROM demand_signals WHERE id=1').get()!.size_bytes,null);}finally{f.db.close();}
 const g=fixture();try{seedRows(g);g.env.DB.batch=async()=>[{success:false,meta:{changes:0}}];const out=await backfillMemberFileSizes(g.env,1,1);assert.equal(out.failed,1);assert.equal(out.outcome,'unreadable');assert.equal(out.complete,false);}finally{g.db.close();}
});

test('D1168: finished discovery never hides pending measurements or a failed HEAD',async()=>{
 const f=fixture();try{seedRows(f);f.db.prepare("UPDATE member_file_size_backfill_state SET phase='done'").run();const out=await backfillMemberFileSizes(f.env,1,1);assert.equal(out.recorded,1);assert.equal(out.complete,false);}finally{f.db.close();}
 const g=fixture();try{seedRows(g);g.db.prepare("UPDATE member_file_size_backfill_state SET phase='done'").run();for(const table of ['formation_steps','entity_obligations','obligation_occurrences','data_imports'])g.db.exec('UPDATE '+table+' SET size_bytes=1');g.hook(()=>{g.db.exec('UPDATE demand_signals SET size_bytes=99 WHERE id=1');throw Error('synthetic-private-head-failure');});const out=await backfillMemberFileSizes(g.env,1,1);assert.equal(out.failed,1);assert.equal(out.complete,false);assert.equal(out.outcome,'unreadable');}finally{g.db.close();}
});


test('D1168: bad prefixes, persistent HEAD failures and invalid measurements do not starve later stores',async()=>{
 for(const mode of ['prefix','head','size','blob']){const f=fixture();try{
  seedRows(f);f.db.exec("INSERT INTO demand_signals(id,project_id,kind,signal_date,evidence_file_key) VALUES (2,1,'loi','2026-01-01','validate-evidence/1/two.pdf'),(3,1,'loi','2026-01-01','validate-evidence/1/three.pdf')");
  if(mode==='prefix')f.db.exec("UPDATE demand_signals SET evidence_file_key='legacy/unreadable-'||id");
  f.db.exec("UPDATE users SET headshot_r2_key='headshots/3/present.png' WHERE id=3");f.objects.set('headshots/3/present.png',new Uint8Array(17));
  if(mode==='blob')f.db.exec("UPDATE demand_signals SET evidence_file_key=CAST('invalid' AS BLOB)");
  if(mode==='head'||mode==='size')f.hook(key=>{if(key.startsWith('validate-evidence/')){if(mode==='head')throw Error('synthetic-private-head-key');return {size:NaN};}return f.objects.has(key)?{size:f.objects.get(key)!.byteLength}:null;});
  let failures=0;for(let i=0;i<12;i++){const out=await backfillMemberFileSizes(f.env,1,1);failures+=out.failed;if(f.db.prepare("SELECT size_bytes FROM member_files WHERE r2_key='headshots/3/present.png'").get()?.size_bytes===17)break;}
  assert.ok(failures>=3);assert.equal(f.db.prepare('SELECT size_bytes FROM formation_steps WHERE id=1').get()!.size_bytes,12);assert.equal(f.db.prepare('SELECT size_bytes FROM entity_obligations WHERE id=1').get()!.size_bytes,13);assert.equal(f.db.prepare('SELECT size_bytes FROM obligation_occurrences WHERE id=1').get()!.size_bytes,14);assert.equal(f.db.prepare('SELECT size_bytes FROM data_imports WHERE id=1').get()!.size_bytes,15);assert.equal(f.db.prepare("SELECT size_bytes FROM member_files WHERE r2_key='headshots/3/present.png'").get()!.size_bytes,17);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM demand_signals WHERE size_bytes IS NULL AND size_missing_at IS NULL').get()!.n,3);
  f.hook(null);for(const id of [1,2,3]){const key='validate-evidence/1/repaired-'+id+'.pdf';f.db.prepare('UPDATE demand_signals SET evidence_file_key=? WHERE id=?').run(key,id);f.objects.set(key,new Uint8Array(40+id));}
  let complete=false;for(let i=0;i<12&&!complete;i++)complete=(await backfillMemberFileSizes(f.env,1,1)).complete;assert.equal(complete,true);assert.deepEqual(f.db.prepare('SELECT size_bytes FROM demand_signals ORDER BY id').all().map(r=>r.size_bytes),[41,42,43]);assert.ok(Number(f.db.prepare('SELECT measurement_pass FROM member_file_size_backfill_state').get()!.measurement_pass)>0);
 }finally{f.db.close();}}
});
test('D1168: late measurement checkpoints preserve a newer pass and never rewind the current pass',async()=>{
 for(const newerPass of [true,false]){const f=fixture();try{seedRows(f);f.hook(()=>{f.db.exec(newerPass?'UPDATE member_file_size_backfill_state SET measurement_pass=1,demand_after=0':'UPDATE member_file_size_backfill_state SET demand_after=99');return {size:11};});await backfillMemberFileSizes(f.env,1,1);const row=f.db.prepare('SELECT measurement_pass,demand_after FROM member_file_size_backfill_state').get()!;assert.equal(row.measurement_pass,newerPass?1:0);assert.equal(row.demand_after,newerPass?0:99);assert.equal(f.db.prepare('SELECT size_bytes FROM demand_signals WHERE id=1').get()!.size_bytes,11);}finally{f.db.close();}}
});


test('D1168: retry reset cannot replace another generation that won the race',async()=>{
 const f=fixture();try{seedRows(f);for(const table of ['formation_steps','entity_obligations','obligation_occurrences','data_imports'])f.db.exec('UPDATE '+table+' SET size_bytes=1');f.db.exec("UPDATE member_file_size_backfill_state SET phase='done',demand_after=1");const prepare=f.env.DB.prepare;
  f.env.DB.prepare=(sql:string)=>{const st=prepare(sql);if(!sql.startsWith('UPDATE member_file_size_backfill_state SET measurement_pass='))return st;return {bind(...params:any[]){const bound=st.bind(...params);return {async run(){f.db.exec('UPDATE member_file_size_backfill_state SET measurement_pass=1');return bound.run();}};}};};
  const out=await backfillMemberFileSizes(f.env,1,1);assert.equal(out.complete,false);assert.equal(f.heads.length,0);const row=f.db.prepare('SELECT measurement_pass,demand_after FROM member_file_size_backfill_state').get()!;assert.equal(row.measurement_pass,1);assert.equal(row.demand_after,1);
 }finally{f.db.close();}
});
test('D1168: failed member-file heads cannot starve another member file',async()=>{
 const f=fixture();try{f.db.exec("UPDATE member_file_size_backfill_state SET phase='done';INSERT INTO member_files(uid,r2_key,owner_user_id,kind) VALUES ('bad','headshots/3/bad.png',3,'headshot'),('good','headshots/3/good.png',3,'headshot')");f.hook(key=>{if(key.endsWith('bad.png'))throw Error('synthetic-private-head-failure');return {size:17};});const first=await backfillMemberFileSizes(f.env,1,1);assert.equal(first.failed,1);const second=await backfillMemberFileSizes(f.env,1,1);assert.equal(second.recorded,1);assert.equal(second.complete,false);assert.equal(f.db.prepare("SELECT size_bytes FROM member_files WHERE uid='good'").get()!.size_bytes,17);assert.equal(f.db.prepare("SELECT size_bytes FROM member_files WHERE uid='bad'").get()!.size_bytes,null);}finally{f.db.close();}
});

test('D1168: failed cursor writes report unreadable and remain resumable',async()=>{
 for(const kind of ['reset','checkpoint']){const f=fixture();try{seedRows(f);if(kind==='reset'){for(const table of ['formation_steps','entity_obligations','obligation_occurrences','data_imports'])f.db.exec('UPDATE '+table+' SET size_bytes=1');f.db.exec("UPDATE member_file_size_backfill_state SET phase='done',demand_after=1");}const prepare=f.env.DB.prepare;
  f.env.DB.prepare=(sql:string)=>sql.startsWith(kind==='reset'?'UPDATE member_file_size_backfill_state SET measurement_pass=':'UPDATE member_file_size_backfill_state SET demand_after=max')?{bind(){return this;},async run(){return {success:false,meta:{changes:0}};}}:prepare(sql);
  const r=await f.call();assert.equal(r.status,503);assert.equal(r.body.recorded,undefined);assert.ok(!JSON.stringify(r.body).includes('r2_key'));
 }finally{f.db.close();}}
});
