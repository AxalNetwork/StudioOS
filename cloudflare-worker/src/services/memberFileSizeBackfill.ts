/** D1168: bounded metadata-only backfill. No object GET, PUT or DELETE. */
import type { Env } from '../types';
import type { MemberFileKind } from './memberFiles';
type Candidate = { source:string; id:number; r2_key:string; owner_user_id:number|null; scope_valid:number };
// Completed rows are durable checkpoints; UNION ALL + LIMIT stops at one bounded
// batch without sorting every remaining file in every source.
const PENDING = `SELECT 'demand' AS source,id,evidence_file_key AS r2_key,NULL AS owner_user_id,scope_valid FROM
 (SELECT id,evidence_file_key,evidence_file_key GLOB ('validate-evidence/'||project_id||'/*') AS scope_valid FROM demand_signals WHERE evidence_file_key IS NOT NULL AND evidence_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL AND id>? ORDER BY id LIMIT ?)
 UNION ALL SELECT 'formation',id,proof_file_key,NULL,scope_valid FROM
 (SELECT id,proof_file_key,proof_file_key GLOB ('build-proof/'||project_id||'/*') AS scope_valid FROM formation_steps WHERE proof_file_key IS NOT NULL AND proof_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL AND id>? ORDER BY id LIMIT ?)
 UNION ALL SELECT 'obligation',id,proof_file_key,NULL,scope_valid FROM
 (SELECT id,proof_file_key,EXISTS (SELECT 1 FROM projects p WHERE p.id=CAST(substr(proof_file_key,13) AS INTEGER) AND p.entity_id=entity_obligations.entity_id AND proof_file_key GLOB ('build-proof/'||p.id||'/*')) AS scope_valid FROM entity_obligations WHERE proof_file_key IS NOT NULL AND proof_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL AND id>? ORDER BY id LIMIT ?)
 UNION ALL SELECT 'minutes',id,minutes_file_key,NULL,scope_valid FROM
 (SELECT id,minutes_file_key,EXISTS (SELECT 1 FROM compliance_events e WHERE e.id=event_id AND minutes_file_key GLOB ('grow-minutes/'||e.project_id||'/*')) AS scope_valid FROM obligation_occurrences WHERE minutes_file_key IS NOT NULL AND minutes_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL AND id>? ORDER BY id LIMIT ?)
 UNION ALL SELECT 'import',id,raw_file_r2_key,NULL,scope_valid FROM
 (SELECT id,raw_file_r2_key,raw_file_r2_key GLOB ('imports/'||user_id||'/*') AS scope_valid FROM data_imports WHERE raw_file_r2_key IS NOT NULL AND raw_file_r2_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL AND id>? ORDER BY id LIMIT ?)
 UNION ALL SELECT 'member',id,r2_key,owner_user_id,scope_valid FROM
 (SELECT f.id,f.r2_key,f.owner_user_id,f.r2_key GLOB ((CASE f.kind WHEN 'headshot' THEN 'headshots/' ELSE 'brand-logos/' END)||COALESCE(CAST(f.owner_user_id AS TEXT)||'/', '')||'*') AS scope_valid FROM member_files f WHERE f.size_missing_at IS NULL AND f.size_unmeasurable_at IS NULL
   AND (f.size_bytes IS NULL OR (f.kind='headshot' AND (f.size_recheck_required=1 OR f.owner_user_id IS NULL)))
   AND f.id>? AND (f.size_bytes IS NULL OR (f.id>? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=f.owner_user_id AND u.headshot_r2_key=f.r2_key))) ORDER BY f.id LIMIT ?)
 LIMIT ?`;
const prefixes:Record<string,string>={demand:'validate-evidence/',formation:'build-proof/',obligation:'build-proof/',minutes:'grow-minutes/',import:'imports/'};
function namespaceOwner(key:string):number|null {
 const match=/^(?:headshots|brand-logos)\/([1-9][0-9]{0,15})\/[^/]+$/.exec(key);
 const id=match?Number(match[1]):NaN;return Number.isSafeInteger(id)?id:null;
}
function seed(env:Env,key:string,owner:number|null,kind:MemberFileKind){
 return env.DB.prepare(`INSERT INTO member_files(uid,r2_key,owner_user_id,kind,size_recheck_required) VALUES (?,?,(SELECT id FROM users WHERE id=?),?,CASE WHEN ?='headshot' AND NOT EXISTS (SELECT 1 FROM users WHERE id=? AND headshot_r2_key=?) THEN 1 ELSE 0 END) ON CONFLICT(r2_key) DO NOTHING`)
   .bind(crypto.randomUUID(),key,owner,kind,kind,owner,key);
}
/** All discovery positions live in D1, including legacy pointer scans. */
async function discover(env:Env,limit:number){
 const state=await env.DB.prepare("SELECT phase,r2_cursor,row_cursor FROM member_file_size_backfill_state WHERE uid=?").bind('member-files-v1').first<{phase:string;r2_cursor:string|null;row_cursor:number}>();
 if(!state)throw new Error('size_store_unreadable');
 if(state.phase==='done')return;
 const statements:D1PreparedStatement[]=[];
 let next=state.phase,cursor=state.r2_cursor,rowCursor=state.row_cursor;
 if(state.phase==='headshot_rows'){
  const rows=await env.DB.prepare(`SELECT u.id AS owner_user_id,u.headshot_r2_key AS r2_key FROM users u
   WHERE u.id>? AND u.headshot_r2_key IS NOT NULL AND u.headshot_r2_key <> '' ORDER BY u.id LIMIT ?`).bind(state.row_cursor,limit).all<{owner_user_id:number;r2_key:string}>();
  if(!rows.success)throw new Error('size_store_unreadable');
  for(const row of rows.results||[])statements.push(seed(env,row.r2_key,row.owner_user_id,'headshot'));
  rowCursor=rows.results?.at(-1)?.owner_user_id??state.row_cursor;
  if((rows.results||[]).length<limit){next='logo_rows';rowCursor=0;}
 }else if(state.phase==='logo_rows'){
  const rows=await env.DB.prepare(`SELECT id,logo_asset_id,logo_dark_asset_id FROM landing_pages
   WHERE id>? AND (logo_asset_id GLOB 'brand-logos/*' OR logo_dark_asset_id GLOB 'brand-logos/*') ORDER BY id LIMIT ?`)
   .bind(state.row_cursor,limit).all<{id:number;logo_asset_id:string|null;logo_dark_asset_id:string|null}>();
  if(!rows.success)throw new Error('size_store_unreadable');
  for(const row of rows.results||[])for(const key of [row.logo_asset_id,row.logo_dark_asset_id])if(key?.startsWith('brand-logos/'))statements.push(seed(env,key,namespaceOwner(key),'brand_logo'));
  rowCursor=rows.results?.at(-1)?.id??state.row_cursor;
  if((rows.results||[]).length<limit){next='headshots';rowCursor=0;}
 }else{
  const prefix=state.phase==='headshots'?'headshots/':'brand-logos/';
  const page=await env.FILES!.list({prefix,limit,...(state.r2_cursor?{cursor:state.r2_cursor}:{})});
  for(const object of page.objects){
   if(!object.key.startsWith(prefix))throw new Error('size_discovery_unreadable');
   statements.push(seed(env,object.key,namespaceOwner(object.key),state.phase==='headshots'?'headshot':'brand_logo'));
  }
  if(page.truncated&&!page.cursor)throw new Error('size_discovery_unreadable');
  next=page.truncated?state.phase:state.phase==='headshots'?'brand_logos':'done';
  cursor=page.truncated?page.cursor:null;
 }
 statements.push(env.DB.prepare(`UPDATE member_file_size_backfill_state SET phase=?,r2_cursor=?,row_cursor=?,updated_at=datetime('now')
  WHERE uid=? AND phase=? AND r2_cursor IS ? AND row_cursor=?`).bind(next,cursor,rowCursor,'member-files-v1',state.phase,state.r2_cursor,state.row_cursor));
 const results=await env.DB.batch(statements);if(results.some(r=>!r.success))throw new Error('size_store_unreadable');
}
type MeasurementCursor = {measurement_pass:number;demand_after:number;formation_after:number;obligation_after:number;minutes_after:number;import_after:number;member_after:number};
const cursorValues=(c:MeasurementCursor)=>[c.demand_after,c.formation_after,c.obligation_after,c.minutes_after,c.import_after,c.member_after];
const zeroCursor=():MeasurementCursor=>({measurement_pass:0,demand_after:0,formation_after:0,obligation_after:0,minutes_after:0,import_after:0,member_after:0});
const pendingRows=(env:Env,cursor:MeasurementCursor,limit:number,recheckAfter=cursor.member_after)=>env.DB.prepare(PENDING).bind(...cursorValues(cursor).slice(0,5).flatMap(after=>[after,limit]),cursor.member_after,recheckAfter,limit,limit).all<Candidate>();
async function measurementCursor(env:Env){
 const row=await env.DB.prepare(`SELECT measurement_pass,demand_after,formation_after,obligation_after,minutes_after,import_after,member_after
  FROM member_file_size_backfill_state WHERE uid=?`).bind('member-files-v1').first<MeasurementCursor>();
 if(!row)throw new Error('size_store_unreadable');return row;
}
/** Failed keys advance too. At the end of a pass they become retryable again. */
async function measurementBatch(env:Env,limit:number){
 let cursor=await measurementCursor(env),pending=await pendingRows(env,cursor,limit);
 if(!pending.success)throw new Error('size_store_unreadable');
 if(!(pending.results||[]).length&&cursorValues(cursor).some(n=>n>0)){
  const reset=await env.DB.prepare(`UPDATE member_file_size_backfill_state SET measurement_pass=measurement_pass+1,demand_after=0,formation_after=0,obligation_after=0,minutes_after=0,import_after=0,member_after=0,updated_at=datetime('now')
   WHERE uid=? AND measurement_pass=? AND demand_after=? AND formation_after=? AND obligation_after=? AND minutes_after=? AND import_after=? AND member_after=?`)
   .bind('member-files-v1',cursor.measurement_pass,...cursorValues(cursor)).run();
  if(!reset.success)throw new Error('size_store_unreadable');
  // A concurrent pass can win this reset. Read its current positions rather
  // than overwriting them or selecting an unbounded batch.
  cursor=await measurementCursor(env);pending=await pendingRows(env,cursor,limit);
  if(!pending.success)throw new Error('size_store_unreadable');
 }
 return {cursor,rows:pending.results||[]};
}
async function checkpointMeasurements(env:Env,cursor:MeasurementCursor){
 const saved=await env.DB.prepare(`UPDATE member_file_size_backfill_state SET demand_after=max(demand_after,?),formation_after=max(formation_after,?),obligation_after=max(obligation_after,?),minutes_after=max(minutes_after,?),import_after=max(import_after,?),member_after=max(member_after,?),updated_at=datetime('now') WHERE uid=? AND measurement_pass=?`)
  .bind(...cursorValues(cursor),'member-files-v1',cursor.measurement_pass).run();
 if(!saved.success)throw new Error('size_store_unreadable');
}
/** Key + unknown-size predicates prevent a late HEAD overwriting a replacement/upload. */
function record(env:Env,row:Candidate,size:number|null,missing:string|null,unmeasurable:string|null=null){
 const values=[size,missing,unmeasurable,row.id,row.r2_key];
 switch(row.source){
  case 'demand': return env.DB.prepare('UPDATE demand_signals SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=? WHERE id=? AND evidence_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL').bind(...values);
  case 'formation': return env.DB.prepare('UPDATE formation_steps SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=? WHERE id=? AND proof_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL').bind(...values);
  case 'obligation': return env.DB.prepare('UPDATE entity_obligations SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=? WHERE id=? AND proof_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL').bind(...values);
  case 'minutes': return env.DB.prepare('UPDATE obligation_occurrences SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=? WHERE id=? AND minutes_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL').bind(...values);
  case 'import': return env.DB.prepare('UPDATE data_imports SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=? WHERE id=? AND raw_file_r2_key=? AND size_bytes IS NULL AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL').bind(...values);
  case 'member': return env.DB.prepare(`UPDATE member_files SET size_bytes=?,size_missing_at=?,size_unmeasurable_at=?,updated_at=datetime('now') WHERE id=? AND r2_key=? AND size_missing_at IS NULL AND size_unmeasurable_at IS NULL
   AND (size_bytes IS NULL OR (kind='headshot' AND (size_recheck_required=1 OR owner_user_id IS NULL) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=member_files.owner_user_id AND u.headshot_r2_key=member_files.r2_key)))`).bind(...values);
  default:throw new Error('size_store_unreadable');
 }
}
export async function backfillMemberFileSizes(env:Env,actorId:number,limit:number){
 if(!env.FILES)throw new Error('file_storage_unavailable');
 const counts={checked:0,recorded:0,missing:0,failed:0,changed:0,unattributed:0,unmeasurable:0};
 const auditUid=crypto.randomUUID();
 const started=await env.DB.prepare('INSERT INTO activity_logs(uid,user_id,action,details) VALUES (?,?,?,?)')
  .bind(auditUid,actorId,'member_file_size_backfill',JSON.stringify({outcome:'started'})).run();
 if(!started.success||started.meta.changes!==1)throw new Error('size_audit_unavailable');
 let outcome='unreadable';let complete=false;
 try{
  // Discovery can fail independently: still measure pending, already-known keys.
  try{await discover(env,limit);}catch{counts.failed++;}
  const batch=await measurementBatch(env,limit);
  for(const row of batch.rows){
   switch(row.source){
    case 'demand':batch.cursor.demand_after=Math.max(batch.cursor.demand_after,row.id);break;
    case 'formation':batch.cursor.formation_after=Math.max(batch.cursor.formation_after,row.id);break;
    case 'obligation':batch.cursor.obligation_after=Math.max(batch.cursor.obligation_after,row.id);break;
    case 'minutes':batch.cursor.minutes_after=Math.max(batch.cursor.minutes_after,row.id);break;
    case 'import':batch.cursor.import_after=Math.max(batch.cursor.import_after,row.id);break;
    case 'member':batch.cursor.member_after=Math.max(batch.cursor.member_after,row.id);break;
   }
   const prefix=typeof row.r2_key==='string'&&(row.source==='member'?/^(headshots|brand-logos)\//.test(row.r2_key):row.r2_key.startsWith(prefixes[row.source]));
   if(!prefix||row.scope_valid!==1){
    // A durable terminal measurement state, distinct from missing or a failed
    // HEAD. The authoritative key remains visible and its byte count unknown.
    try{
     const saved=await record(env,row,null,null,new Date().toISOString()).run();
     if(!saved.success)throw new Error('size_store_unreadable');
     if(saved.meta.changes===1)counts.unmeasurable++;else counts.changed++;
    }catch{counts.failed++;}
    continue;
   }
   counts.checked++;
   if(row.source==='member'&&row.owner_user_id===null)counts.unattributed++;
   try{
    const head=await env.FILES.head(row.r2_key);
    if(head!==null&&(!Number.isSafeInteger(head?.size)||head.size<0)){counts.failed++;continue;}
    const saved=await record(env,row,head?head.size:null,head?null:new Date().toISOString()).run();
    if(!saved.success)throw new Error('size_store_unreadable');
    if(saved.meta.changes===1){if(head)counts.recorded++;else counts.missing++;}else counts.changed++;
   }catch{counts.failed++;}
  }
  await checkpointMeasurements(env,batch.cursor);
  const state=await env.DB.prepare('SELECT phase,member_after FROM member_file_size_backfill_state WHERE uid=?').bind('member-files-v1').first<{phase:string;member_after:number}>();
  if(!state)throw new Error('size_store_unreadable');
  // Unknown, measurable sizes block completion. Invalid scopes have a durable
  // unmeasurable marker. Known replaced headshots need one
  // verification per pass; future passes recheck them after a failed cleanup.
  const rest=await pendingRows(env,zeroCursor(),1,state.member_after);
  if(!rest.success)throw new Error('size_store_unreadable');
  complete=counts.failed===0&&!(rest.results||[]).length&&state.phase==='done';
  outcome=complete?'complete':counts.failed?'unreadable':'partial';
  return {...counts,complete,outcome};
 }finally{
  const logged=await env.DB.prepare('UPDATE activity_logs SET details=? WHERE uid=? AND user_id=?')
   .bind(JSON.stringify({outcome,...counts}),auditUid,actorId).run();
  if(!logged.success||logged.meta.changes!==1)throw new Error('size_audit_unavailable');
 }
}
