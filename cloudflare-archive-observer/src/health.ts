/** D5676: metadata-only independent archive expectations, write reconciliation and redacted health receipts. Never reads archive bodies. */
import { archiveNotice } from '../../cloudflare-worker-tail/src/protocol';
import { cfHash,parseCfReceipt,type CfReceipt } from '../../cloudflare-worker/src/services/cloudflareSourceReceipt';
export const ARCHIVE_WINDOW_MS=10*60000,ARCHIVE_GRACE_MS=60000;
export async function recordArchiveNotice(db:D1Database,value:unknown){
 const n=archiveNotice(value);
 const ops=[db.prepare(`INSERT OR IGNORE INTO cf_archive_batches (batch_id,object_key,events,bytes,attempt,state,first_ms,observed_ms,lost_events) VALUES (?,?,?,?,?,?,?,?,?)`).bind(n.batch_id,n.object_key,n.events,n.bytes,n.attempt,n.state,n.observed_ms,n.observed_ms,n.lost_events),
 db.prepare(`UPDATE cf_archive_batches SET attempt=MAX(attempt,?),state=CASE WHEN state='confirmed' OR ?='confirmed' THEN 'confirmed' WHEN ?>=attempt THEN ? ELSE state END,observed_ms=MAX(observed_ms,?),lost_events=MAX(lost_events,?)
  WHERE batch_id=? AND object_key=? AND events=?`).bind(n.attempt,n.state,n.attempt,n.state,n.observed_ms,n.lost_events,n.batch_id,n.object_key,n.events)];
 for(const marker of n.markers)ops.push(db.prepare('UPDATE cf_archive_canaries SET batch_id=? WHERE marker=? AND batch_id IS NULL AND expected_ms<=? AND EXISTS (SELECT 1 FROM cf_archive_batches WHERE batch_id=? AND object_key=? AND events=?)').bind(n.batch_id,marker,n.observed_ms+60000,n.batch_id,n.object_key,n.events));
 const results=await db.batch(ops);if(results.some(r=>(r.success as unknown)===false)||results[1].meta.changes!==1)throw Error('archive_receipt_unavailable');
}
export async function expectArchiveMarker(db:D1Database,marker:string,now:number,due:number){
 if(!/^[a-f0-9]{32}$/.test(marker)||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(due)||due<=now||due-now>300000)throw Error('invalid_archive_expectation');
 const r=await db.prepare('INSERT INTO cf_archive_canaries (marker,expected_ms,due_ms) VALUES (?,?,?)').bind(marker,now,due).run();if((r.success as unknown)===false)throw Error('archive_expectation_failed');
}
type Batch={batch_id:string;object_key:string;events:number;bytes:number;attempt:number;state:string;first_ms:number;observed_ms:number;lost_events:number};
type Marker={marker:string;expected_ms:number;due_ms:number;batch_id:string|null};
export async function checkArchiveHealth(db:D1Database,bucket:Pick<R2Bucket,'head'>,now=Date.now(),openEpisodeMs:number|null=null){
 const since=now-ARCHIVE_WINDOW_MS;let coverageStart=since;const episode_key=await cfHash(['cf','prod','studioos-tail','archive']);
 const make=async(state:CfReceipt['state'],code:CfReceipt['code'],count:number,denominator:number)=>parseCfReceipt({version:1,id:await cfHash([episode_key,state,code,since,now,count]),
  script:'studioos-tail',audience:'prod',family:'archive',component:'archive',state,code,occurred_ms:now,observed_ms:now,count,denominator,window_start_ms:coverageStart,window_end_ms:now,versions:[],source:'unknown',github:null,revision:null,episode_key,owner:'storage_oncall'});
 try{
  const [br,mr]=await Promise.all([db.prepare('SELECT batch_id,object_key,events,bytes,attempt,state,first_ms,observed_ms,lost_events FROM cf_archive_batches WHERE (observed_ms>=? OR verified_ms IS NULL) ORDER BY observed_ms LIMIT 101').bind(since).all<Batch>(),
   db.prepare('SELECT marker,expected_ms,due_ms,batch_id FROM cf_archive_canaries WHERE (expected_ms>=? OR verified_ms IS NULL) ORDER BY expected_ms LIMIT 101').bind(since).all<Marker>()]);
  if((br.success as unknown)===false||(mr.success as unknown)===false||!Array.isArray(br.results)||!Array.isArray(mr.results)||br.results.length>100||mr.results.length>100)throw Error('archive_inventory_unknown');
  coverageStart=Math.min(since,...br.results.map(b=>b.first_ms),...mr.results.map(m=>m.expected_ms));
  let confirmed=0,unconfirmed=0,lost=0,missed=0,pending=0,fresh=0,attempts=0;const verified=new Map<string,Record<string,string>>();let metadataUnknown=false;
  for(const b of br.results){attempts+=b.attempt;lost+=b.lost_events;let object:R2Object|null;let timer:ReturnType<typeof setTimeout>|undefined;
   try{object=await Promise.race([bucket.head(b.object_key),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('archive_head_timeout')),2000);})]);}catch{metadataUnknown=true;unconfirmed+=br.results.filter(x=>x.state==='exhausted'&&now-x.first_ms>=ARCHIVE_GRACE_MS).length;break;}finally{if(timer!==undefined)clearTimeout(timer);}
   if(object?.customMetadata?.batch_id===b.batch_id&&object.customMetadata.batch_size===String(b.events)){
    confirmed++;fresh=Math.max(fresh,object.uploaded.getTime());verified.set(b.batch_id,object.customMetadata!);
    await db.prepare('UPDATE cf_archive_batches SET verified_ms=? WHERE batch_id=?').bind(now,b.batch_id).run();
   }else if(now-b.first_ms>=ARCHIVE_GRACE_MS)unconfirmed++;else pending++;
  }
  for(const m of mr.results){if(m.batch_id&&verified.get(m.batch_id)?.canary_markers?.split(',').includes(m.marker)){await db.prepare('UPDATE cf_archive_canaries SET verified_ms=? WHERE marker=?').bind(now,m.marker).run();continue;}if(metadataUnknown&&m.batch_id){pending++;continue;}if(now>m.due_ms)missed++;else pending++;}
  const expected=br.results.length+mr.results.length,failing=unconfirmed+missed+(lost>0?1:0);
  const state=failing?'firing':!expected?'activity':pending||metadataUnknown?'unknown':openEpisodeMs!==null&&fresh>openEpisodeMs?'recovered':'activity';
  const code=missed?'marker_missing':unconfirmed||lost?'write_failed':!expected?'idle':pending||metadataUnknown?'not_verified':'write_verified';
  return {state,counts:{received_batches:br.results.length,confirmed_batches:confirmed,unconfirmed_batches:unconfirmed,serialization_losses:lost,missed_markers:missed,pending,attempts,metadata_unknown:metadataUnknown},last_independently_verified_ms:fresh||null,
   receipts:[await make(state,code,failing||confirmed,Math.max(expected,failing||confirmed))],coverage:'window_and_unverified' as const};
 }catch{return {state:'unknown' as const,counts:null,last_independently_verified_ms:null,receipts:[await make('unknown','telemetry_unavailable',0,0)],coverage:'unverifiable' as const};}
}
