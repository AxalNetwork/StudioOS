/** D5676: independent SQLite receipt/check loop with actual writer protocol, conditional R2 faults and metadata-only inspection. */
import test, { before, after, mock } from 'node:test';import assert from 'node:assert/strict';import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
import { d1Over } from './_d1_sqlite.mjs';
import { writeArchiveBatch } from '../../cloudflare-worker-tail/src/archive.ts';
import tail from '../../cloudflare-worker-tail/src/index.ts';
import { archiveMac,type ArchiveNotice } from '../../cloudflare-worker-tail/src/protocol.ts';
import { recordArchiveNotice,expectArchiveMarker,checkArchiveHealth } from '../../cloudflare-archive-observer/src/health.ts';
import observer from '../../cloudflare-archive-observer/src/index.ts';
import { cfRoute } from '../src/services/cloudflareSourceReceipt.ts';
before(()=>mock.timers.enable({apis:['Date'],now:1900000000000}));
after(()=>mock.timers.reset());
const ROOT=new URL('../../',import.meta.url),marker='b'.repeat(32),secret='synthetic-archive-writer-key-'.repeat(3);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('cloudflare-archive-observer/migrations/202611121119_5676_metadata.sql',ROOT),'utf8'));const db=d1Over(sql) as any;
 let now=Date.now(),refuse=false,loseAck=false,headFail=false,puts=0,heads=0;const objects=new Map<string,any>(),notices:ArchiveNotice[]=[],pending:Promise<unknown>[]=[];
 const bucket:any={async put(key:string,body:string,options:any){puts++;if(refuse)throw Error('private R2 refusal');
  if(options.onlyIf?.get('If-None-Match')==='*'&&objects.has(key))return null;const object={key,body,size:Buffer.byteLength(body),uploaded:new Date(now),customMetadata:structuredClone(options.customMetadata)};objects.set(key,object);
  if(loseAck){loseAck=false;throw Error('lost ack');}return object;},async head(key:string){heads++;if(headFail)throw Error('metadata unavailable');const o=objects.get(key);return o?{uploaded:o.uploaded,size:o.size,customMetadata:o.customMetadata}:null;},get(){throw Error('archive bodies must never be read');}};
 const context={waitUntil(p:Promise<unknown>){pending.push(p);}},events=[{scriptName:'studioos',eventTimestamp:now,logs:[{message:[{archive_canary:marker},'private.example.invalid/customer-content']}]}];
 const sink=async(n:ArchiveNotice)=>{notices.push(structuredClone(n));await recordArchiveNotice(db,n);};
 const env:any={LOGS:bucket,ARCHIVE_TELEMETRY:'on',ARCHIVE_OBSERVER_SECRET:secret,ARCHIVE_OBSERVER:{fetch:async(url:any,init:any)=>{assert.equal(new URL(url).origin,'https://archive-observer.internal');return observer.fetch(new Request(url,init),{ARCHIVE_OBSERVER_ENABLED:'on',ARCHIVE_DB:db,ARCHIVE_LOGS:bucket,ARCHIVE_OBSERVER_SECRET:secret});}}};
 return {sql,db,bucket,objects,events,notices,env,context,now:()=>now,time:(t:number)=>{now=t;},refuse:(v=true)=>{refuse=v;},lostAck:()=>{loseAck=true;},badHead:(v=true)=>{headFail=v;},stats:()=>({puts,heads}),
  write:(factory=writeArchiveBatch)=>factory(events,env,context as any,{now:()=>now,pause:async()=>{},notice:sink,put_timeout_ms:100}),sink};
}

test('caught R2 refusal still returns successfully from handler but independent evidence fires and retains attempts',async()=>{
 const f=fixture();try{f.refuse();await expectArchiveMarker(f.db,marker,f.now(),f.now()+120000);await tail.tail(f.events,f.env,f.context as any);
  assert.equal(f.stats().puts,3);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM cf_archive_batches').get()!.n,1);
  const report=await checkArchiveHealth(f.db,f.bucket,f.now()+120001);assert.equal(report.state,'firing');assert.equal(cfRoute(report.receipts[0]).labels,'[cf][prod][studioos-tail][archive][firing]');
  assert.equal(report.counts!.attempts,3);assert.doesNotMatch(JSON.stringify(report),/object_key|ndjson|private\.example|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
 }finally{f.sql.close();}
});

test('quiet parent is idle; silent consumer or missed old canary cannot disappear from a rolling window',async()=>{
 const f=fixture();try{const idle=await checkArchiveHealth(f.db,f.bucket,f.now());assert.equal(idle.receipts[0].code,'idle');assert.equal(f.stats().heads,0);
  await expectArchiveMarker(f.db,marker,f.now()-3600000,f.now()-3500000);const missed=await checkArchiveHealth(f.db,f.bucket,f.now());assert.equal(missed.state,'firing');assert.equal(missed.counts!.missed_markers,1);
 }finally{f.sql.close();}
});

test('duplicate/delayed delivery and accepted-then-lost-ack create one conditional object and one logical batch',async()=>{
 const f=fixture();try{f.lostAck();const a=await f.write();assert.equal(a!.confirmed,true);assert.equal(a!.attempts,2);const firstUpload=[...f.objects.values()][0].uploaded.getTime();f.time(f.now()+3600000);await f.write();assert.equal([...f.objects.values()][0].uploaded.getTime(),firstUpload);
  assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM cf_archive_batches').get()!.n,1);
  const row=f.sql.prepare('SELECT state,attempt FROM cf_archive_batches').get()!;assert.equal(row.state,'confirmed');assert.equal(row.attempt,2);
  await f.sink({...f.notices[0],state:'received',attempt:0,observed_ms:f.now()});assert.equal(f.sql.prepare('SELECT state FROM cf_archive_batches').get()!.state,'confirmed');
 }finally{f.sql.close();}
});

test('one recovery requires a fresh independent write; writer ack or newest-object time alone cannot recover',async()=>{
 const f=fixture();try{const began=f.now();await expectArchiveMarker(f.db,marker,began,began+120000);f.refuse();await f.write();
  const fire=await checkArchiveHealth(f.db,f.bucket,began+120001);assert.equal(fire.state,'firing');
  f.time(began+130000);f.refuse(false);await f.write();const recovered=await checkArchiveHealth(f.db,f.bucket,f.now()+1,began+120001);
  assert.equal(recovered.state,'recovered');assert.equal(recovered.receipts[0].episode_key,fire.receipts[0].episode_key);assert.equal(recovered.counts!.confirmed_batches,1);
  assert.equal((await checkArchiveHealth(f.db,f.bucket,f.now()+2,f.now()+1)).state,'activity','old verified write is not a fresh recovery');
 }finally{f.sql.close();}
});

test('false writer confirmation, missing marker metadata and metadata outages stay distinct from verified success',async()=>{
 const f=fixture();try{await expectArchiveMarker(f.db,marker,f.now(),f.now()+1000);await f.write();const o=[...f.objects.values()][0];delete o.customMetadata.canary_markers;
  const missing=await checkArchiveHealth(f.db,f.bucket,f.now()+1001);assert.equal(missing.counts!.missed_markers,1);assert.equal(missing.state,'firing');
  f.badHead();assert.equal((await checkArchiveHealth(f.db,f.bucket,f.now()+2000)).state,'unknown');
  f.objects.clear();f.badHead(false);assert.equal((await checkArchiveHealth(f.db,f.bucket,f.now()+60001)).state,'firing','writer claimed confirmed but no object exists');
 }finally{f.sql.close();}
});

test('observer has independent role keys, rejects forged metadata and never exposes object pointers in check responses',async()=>{
 const f=fixture();try{await f.write();const n=f.notices.at(-1)!,path='/api/internal/archive-receipts',raw=JSON.stringify(n),at=Date.now();
  const request=(signature:string)=>new Request('https://observer.internal'+path,{method:'POST',body:raw,headers:{'x-archive-timestamp':String(at),'x-archive-signature':signature}});
  const e:any={ARCHIVE_OBSERVER_ENABLED:'on',ARCHIVE_DB:f.db,ARCHIVE_LOGS:f.bucket,ARCHIVE_OBSERVER_SECRET:secret,ARCHIVE_READER_SECRET:'reader-key'.repeat(5)};
  assert.equal((await observer.fetch(request(await archiveMac('wrong-key',path,raw,at)),e)).status,401);
  assert.equal((await observer.fetch(request(await archiveMac(secret,path,raw,at)),e)).status,200);
  assert.equal((await observer.fetch(request(await archiveMac(secret,path,raw,at)),{...e,ARCHIVE_OBSERVER_ENABLED:'off'})).status,404);
  const body=JSON.stringify({opened_ms:0}),checkPath='/check';assert.equal((await observer.fetch(new Request('https://observer.internal'+checkPath,{method:'POST',body,headers:{'x-archive-timestamp':String(at),'x-archive-signature':await archiveMac(e.ARCHIVE_READER_SECRET,checkPath,body,at)}}),e)).status,422,'reader cannot choose an incident recovery time');
  await assert.rejects(recordArchiveNotice(f.db,{...n,raw_tail:'never accept'}));
  const otherBatch = (n.batch_id[0] === 'a' ? 'b' : 'a').repeat(64);
  const mismatchedKey = n.object_key.replace(n.batch_id, otherBatch);
  await assert.rejects(recordArchiveNotice(f.db, { ...n, object_key: mismatchedKey }), /invalid_archive_notice/);
 }finally{f.sql.close();}
});

test('telemetry failure is explicit even when archive succeeds; self-tail/config cycles and per-notification CI are absent',async()=>{
 const f=fixture();try{let failed=0;const result=await writeArchiveBatch(f.events,f.env,f.context as any,{now:f.now,pause:async()=>{},notice:async()=>{failed++;throw Error('observer down');}});
  assert.equal(result!.confirmed,true);assert.equal(result!.telemetry_verified,false);assert.equal(failed,2);
  const cfg=readFileSync(new URL('cloudflare-archive-observer/wrangler.jsonc',ROOT),'utf8');assert.doesNotMatch(cfg,/tail_consumers|studioos-db|workflow_run|SLACK/);
  const index=readFileSync(new URL('cloudflare-archive-observer/src/index.ts',ROOT),'utf8');assert.doesNotMatch(index,/fetch\(['"]https:\/\/app\.axal|hooks\.slack|chat.postMessage/);
  const count=f.objects.size;await writeArchiveBatch([{scriptName:'studioos-tail',eventTimestamp:f.now()}],f.env,f.context as any,{notice:f.sink});assert.equal(f.objects.size,count);
 }finally{f.sql.close();}
});

test('capped or unreadable metadata is unknown rather than zero deliveries',async()=>{
 const f=fixture();try{for(let i=0;i<101;i++)await expectArchiveMarker(f.db,i.toString(16).padStart(32,'0'),f.now()-10000,f.now()-5000);
  const report=await checkArchiveHealth(f.db,f.bucket,f.now());assert.equal(report.state,'unknown');assert.equal(report.counts,null);
 }finally{f.sql.close();}
});

test('mutations: R2 confirmation, expected marker, independent head and private signature guards are necessary',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cf-archive-5676-'));let source=readFileSync(new URL('cloudflare-archive-observer/src/health.ts',ROOT),'utf8');
 source=source.replace("'../../cloudflare-worker-tail/src/protocol'",JSON.stringify(new URL('cloudflare-worker-tail/src/protocol.ts',ROOT).href)).replace("'../../cloudflare-worker/src/services/cloudflareSourceReceipt'",JSON.stringify(new URL('cloudflare-worker/src/services/cloudflareSourceReceipt.ts',ROOT).href));
 const mutations:[string,string,string,(factory:typeof checkArchiveHealth)=>Promise<void>][]=[
  ['missing-marker',"if(now>m.due_ms)missed++",'if(false)missed++',async factory=>{const f=fixture();try{await expectArchiveMarker(f.db,marker,f.now()-3000,f.now()-1000);assert.equal((await factory(f.db,f.bucket,f.now())).state,'firing');}finally{f.sql.close();}}],
  ['head-proof',"object?.customMetadata?.batch_id===b.batch_id", "b.state==='confirmed'",async factory=>{const f=fixture();try{await f.write();f.objects.clear();assert.equal((await factory(f.db,f.bucket,f.now()+60001)).state,'firing');}finally{f.sql.close();}}],
  ['freshness','fresh>openEpisodeMs','fresh>=0',async factory=>{const f=fixture();try{await f.write();assert.notEqual((await factory(f.db,f.bucket,f.now()+1,f.now()+1)).state,'recovered');}finally{f.sql.close();}}]
 ];
 try{for(const [label,before,after,journey] of mutations){assert.ok(source.includes(before));const p=join(dir,label+'.ts');writeFileSync(p,source.replaceAll(before,after));await assert.rejects(journey((await import(pathToFileURL(p).href)).checkArchiveHealth),'must kill '+label);}}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('conditional writer mutation cannot overwrite a replayed batch with a new received time',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'archive-conditional-'));
 try{  let writer=readFileSync(new URL('cloudflare-worker-tail/src/archive.ts',ROOT),'utf8').replace("'./protocol'",JSON.stringify(new URL('cloudflare-worker-tail/src/protocol.ts',ROOT).href));
  const before="onlyIf:new Headers({'If-None-Match':'*'}),";assert.ok(writer.includes(before));const file=join(dir,'unconditional.ts');writeFileSync(file,writer.replace(before,''));
  const broken=(await import(pathToFileURL(file).href)).writeArchiveBatch;await assert.rejects(async()=>{const f=fixture();try{await f.write(broken);const first=[...f.objects.values()][0].uploaded.getTime();f.time(f.now()+1000);await f.write(broken);assert.equal([...f.objects.values()][0].uploaded.getTime(),first);}finally{f.sql.close();}},'conditional write mutation is killed');
}finally{rmSync(dir,{recursive:true,force:true});}
});

test('independent observer binding and handler contracts typecheck in their own project',async()=>{
 const { spawnSync }=await import('node:child_process');const { fileURLToPath }=await import('node:url');
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url)),'--noEmit','-p',fileURLToPath(new URL('cloudflare-archive-observer/tsconfig.json',ROOT))],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stdout+r.stderr);
});
