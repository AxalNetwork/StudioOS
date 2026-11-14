/** D5676: deterministic conditional archive batches, bounded retries and independent metadata notices; never notifies through the producer. */
import { archiveNotice,archiveMac,boundedArchiveText,type ArchiveNotice } from './protocol';
export type TailEvent={scriptName?:string;eventTimestamp?:number;logs?:{message?:unknown[]}[];[key:string]:unknown};
export type ArchiveEnv={LOGS:R2Bucket;RETENTION_DAYS?:string;ENVIRONMENT?:string;ARCHIVE_TELEMETRY?:string;ARCHIVE_OBSERVER_SECRET?:string;ARCHIVE_OBSERVER?:Fetcher};
type Dependencies={now?:()=>number;pause?:(ms:number)=>Promise<void>;notice?:(n:ArchiveNotice)=>Promise<void>;put_timeout_ms?:number};
const enc=new TextEncoder(),max=4*1024*1024;
function canonical(value:unknown,seen=new Set<unknown>(),depth=0):unknown{
 if(depth>32||seen.has(value))throw Error('serialization_limit');
 if(!value||typeof value!=='object')return value;seen.add(value);
 try{return Array.isArray(value)?value.map(v=>canonical(v,seen,depth+1)):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical((value as Record<string,unknown>)[k],seen,depth+1)]));}
 finally{seen.delete(value);}
}
export async function postArchiveNotice(env:ArchiveEnv,n:ArchiveNotice){
 if(env.ARCHIVE_TELEMETRY!=='on'||!env.ARCHIVE_OBSERVER||(env.ARCHIVE_OBSERVER_SECRET?.length??0)<32)throw Error('archive_observer_unconfigured');
 const path='/api/internal/archive-receipts',raw=JSON.stringify(archiveNotice(n)),at=Date.now();
 const r=await env.ARCHIVE_OBSERVER.fetch('https://archive-observer.internal'+path,{method:'POST',body:raw,redirect:'error',headers:{'content-type':'application/json','x-archive-timestamp':String(at),'x-archive-signature':await archiveMac(env.ARCHIVE_OBSERVER_SECRET!,path,raw,at)},signal:AbortSignal.timeout(3000)});
 if(!r.ok||(JSON.parse(await boundedArchiveText(r,1024))).accepted!==true)throw Error('archive_observer_unavailable');
}
export async function writeArchiveBatch(events:TailEvent[],env:ArchiveEnv,ctx:Pick<ExecutionContext,'waitUntil'>,deps:Dependencies={}){
 const now=deps.now??Date.now,pause=deps.pause??(ms=>new Promise(r=>setTimeout(r,ms)));
 if(!Array.isArray(events)||!events.length)return;
 if(events.length>1000||events.some(e=>e.scriptName!=='studioos')){console.error('[studioos-tail] rejected_source_or_batch_limit',{events:events.length});return;}
 const lines:string[]=[],markers=new Set<string>();let lost=0,bytes=0;
 for(const e of events){
  let line:string;try{line=JSON.stringify(canonical(e));if(!line)throw Error('serialization_failed');}catch{lost++;line=JSON.stringify({_serialization_error:'unserializable_event',scriptName:'studioos',eventTimestamp:Number.isFinite(e.eventTimestamp)?e.eventTimestamp:null});}
  bytes+=enc.encode(line).length+80;if(bytes>max){console.error('[studioos-tail] archive_batch_limit',{events:events.length,lost_events:events.length});return;}
  lines.push(line);
  for(const log of e.logs??[])for(const raw of log.message??[]){try{const m=typeof raw==='string'&&raw.length<128?JSON.parse(raw):raw;if(m&&typeof m==='object'&&Object.keys(m).length===1&&'archive_canary'in m&&typeof m.archive_canary==='string'&&/^[a-f0-9]{32}$/.test(m.archive_canary))markers.add(m.archive_canary);}catch{}}
 }
 const stable=lines.join('\n'),batch_id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(stable)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const times=events.map(e=>e.eventTimestamp).filter((t):t is number=>Number.isSafeInteger(t)&&t!>=0&&t!<=now()+60000);
 const hour=times.length?new Date(Math.min(...times)).toISOString().slice(0,13).replaceAll('-','/').replace('T','/'):'undated';
 const object_key=`${hour}/${batch_id}.ndjson`,body=lines.map(line=>JSON.stringify({...JSON.parse(line),_received_at:new Date(now()).toISOString()})).join('\n')+'\n';
 const base={version:1 as const,source:'studioos-tail' as const,batch_id,object_key,events:events.length,bytes:enc.encode(body).length,lost_events:lost,markers:[...markers].slice(0,16)};
 if(base.bytes>max){console.error('[studioos-tail] archive_batch_limit',{events:events.length,lost_events:events.length});return;}
 let telemetryFailures=0;
 const notice=async(state:ArchiveNotice['state'],attempt:number)=>{if(!deps.notice&&env.ARCHIVE_TELEMETRY!=='on'){telemetryFailures++;return;}try{await (deps.notice??((n)=>postArchiveNotice(env,n)))(archiveNotice({...base,state,attempt,observed_ms:now()}));}catch{telemetryFailures++;console.error('[studioos-tail] archive_telemetry_unknown',{batches:1,events:events.length});}};
 await notice('received',0);
 for(let attempt=1;attempt<=3;attempt++){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const pending=env.LOGS.put(object_key,body,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/x-ndjson'},customMetadata:{batch_id,batch_size:String(events.length),lost_events:String(lost),canary_markers:base.markers.join(','),retention_days:env.RETENTION_DAYS||'2555',environment:env.ENVIRONMENT||'production'}});
   // A timed-out put may still commit. Keep it accounted for; every retry uses the same key and conditional write.
   ctx.waitUntil(pending.then(()=>{},()=>{}));
   const written=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('put_timeout')),deps.put_timeout_ms??5000);})]);
   if(!written){const existing=await env.LOGS.head(object_key);if(existing?.customMetadata?.batch_id!==batch_id||existing.customMetadata.batch_size!==String(events.length))throw Error('archive_identity_unknown');}
   await notice('confirmed',attempt);return {batch_id,confirmed:true,attempts:attempt,telemetry_verified:telemetryFailures===0};
  }catch{
   await notice(attempt===3?'exhausted':'retry',attempt);
   console.error('[studioos-tail] archive_write_unconfirmed',{batches:1,events:events.length,attempt,exhausted:attempt===3});
   if(attempt<3)await pause(attempt*100);
  }finally{if(timer!==undefined)clearTimeout(timer);}
 }
 return {batch_id,confirmed:false,attempts:3,telemetry_verified:telemetryFailures===0};
}
