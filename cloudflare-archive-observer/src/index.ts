/** D5676: independent authenticated archive observer. Never attached as a tail consumer and never calls the studioos producer or Slack. */
import { archiveNotice,validArchiveMac,boundedArchiveText } from '../../cloudflare-worker-tail/src/protocol';
import { recordArchiveNotice,expectArchiveMarker,checkArchiveHealth } from './health';
export type ArchiveObserverEnv=ArchiveObserverBindings&{ARCHIVE_DB?:D1Database;ARCHIVE_LOGS?:R2Bucket;
 ARCHIVE_OBSERVER_SECRET?:string;ARCHIVE_PRODUCER_SECRET?:string;ARCHIVE_READER_SECRET?:string};
export default {async fetch(request:Request,env:ArchiveObserverEnv):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(env.ARCHIVE_OBSERVER_ENABLED!=='on'||!env.ARCHIVE_DB||request.method!=='POST'||!['/api/internal/archive-receipts','/expect','/check'].includes(path))return new Response(null,{status:404});
 try{
  const raw=await boundedArchiveText(request),secret=path==='/expect'?env.ARCHIVE_PRODUCER_SECRET:path==='/check'?env.ARCHIVE_READER_SECRET:env.ARCHIVE_OBSERVER_SECRET;
  if(!secret||!await validArchiveMac(secret,request.headers,path,raw))return Response.json({error:'archive_unauthorized'},{status:401});
  const data=JSON.parse(raw);
  if(path==='/api/internal/archive-receipts'){const n=archiveNotice(data);if(n.observed_ms>Date.now()+60000)return Response.json({error:'invalid_archive_clock'},{status:422});await recordArchiveNotice(env.ARCHIVE_DB,n);return Response.json({accepted:true});}
  if(path==='/expect'){
   if(!data||Object.keys(data).some(k=>!['marker','expected_ms','due_ms'].includes(k)))return Response.json({error:'invalid_expectation'},{status:422});
   if(!Number.isSafeInteger(data.expected_ms)||Math.abs(Date.now()-data.expected_ms)>60000)return Response.json({error:'invalid_expectation'},{status:422});
   const prior=await env.ARCHIVE_DB.prepare('SELECT MAX(expected_ms) AS last_ms FROM cf_archive_canaries').first<{last_ms:number|null}>();
   if(prior?.last_ms&&Date.now()-prior.last_ms<300000)return Response.json({error:'canary_rate_limited'},{status:429});
   await expectArchiveMarker(env.ARCHIVE_DB,data.marker,data.expected_ms,data.due_ms);return Response.json({accepted:true});
  }
  if(!env.ARCHIVE_LOGS)return Response.json({state:'unknown',error:'archive_read_binding_missing'},{status:503});
  if(!data||Object.keys(data).some(k=>k!=='opened_ms')||data.opened_ms!==null)return Response.json({error:'invalid_check'},{status:422});
  const now=Date.now();await env.ARCHIVE_DB.prepare('INSERT OR IGNORE INTO cf_archive_check_clock (clock_key,last_ms) VALUES (?,0)').bind('reader').run();
  const clock=await env.ARCHIVE_DB.prepare('UPDATE cf_archive_check_clock SET last_ms=? WHERE clock_key=? AND last_ms<=?').bind(now,'reader',now-5000).run();
  if(clock.meta.changes!==1)return Response.json({error:'archive_check_rate_limited'},{status:429,headers:{'retry-after':'5'}});
  return Response.json(await checkArchiveHealth(env.ARCHIVE_DB,env.ARCHIVE_LOGS,Date.now(),data.opened_ms),{headers:{'cache-control':'private, no-store'}});
 }catch{return Response.json({state:'unknown',error:'archive_observer_unavailable'},{status:503});}
}};
