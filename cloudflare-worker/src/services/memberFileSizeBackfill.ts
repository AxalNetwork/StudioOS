/** D1168: bounded metadata-only backfill. No object GET, PUT or DELETE. */
import type { Env } from '../types';
import type { MemberFileKind } from './memberFiles';
type Candidate = { source:string; id:number; r2_key:string; owner_user_id:number|null };
// Completed rows are durable checkpoints; UNION ALL + LIMIT stops at one bounded
// batch without sorting every remaining file in every source.
const PENDING = `SELECT 'demand' AS source,id,evidence_file_key AS r2_key,NULL AS owner_user_id FROM demand_signals WHERE evidence_file_key IS NOT NULL AND evidence_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL
 UNION ALL SELECT 'formation',id,proof_file_key,NULL FROM formation_steps WHERE proof_file_key IS NOT NULL AND proof_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL
 UNION ALL SELECT 'obligation',id,proof_file_key,NULL FROM entity_obligations WHERE proof_file_key IS NOT NULL AND proof_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL
 UNION ALL SELECT 'minutes',id,minutes_file_key,NULL FROM obligation_occurrences WHERE minutes_file_key IS NOT NULL AND minutes_file_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL
 UNION ALL SELECT 'import',id,raw_file_r2_key,NULL FROM data_imports WHERE raw_file_r2_key IS NOT NULL AND raw_file_r2_key <> '' AND size_bytes IS NULL AND size_missing_at IS NULL
 UNION ALL SELECT 'member',id,r2_key,owner_user_id FROM member_files WHERE size_bytes IS NULL AND size_missing_at IS NULL
 LIMIT ?`;
const prefixes:Record<string,string>={demand:'validate-evidence/',formation:'build-proof/',obligation:'build-proof/',minutes:'grow-minutes/',import:'imports/'};
function namespaceOwner(key:string):number|null {
 const match=/^(?:headshots|brand-logos)\/([1-9][0-9]{0,15})\/[^/]+$/.exec(key);
 const id=match?Number(match[1]):NaN;return Number.isSafeInteger(id)?id:null;
}
function seed(env:Env,key:string,owner:number|null,kind:MemberFileKind){
 return env.DB.prepare(`INSERT INTO member_files(uid,r2_key,owner_user_id,kind) VALUES (?,?,(SELECT id FROM users WHERE id=?),?) ON CONFLICT(r2_key) DO NOTHING`)
   .bind(crypto.randomUUID(),key,owner,kind);
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
/** Key + unknown-size predicates prevent a late HEAD overwriting a replacement/upload. */
function record(env:Env,row:Candidate,size:number|null,missing:string|null){
 const values=[size,missing,row.id,row.r2_key];
 switch(row.source){
  case 'demand': return env.DB.prepare('UPDATE demand_signals SET size_bytes=?,size_missing_at=? WHERE id=? AND evidence_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL').bind(...values);
  case 'formation': return env.DB.prepare('UPDATE formation_steps SET size_bytes=?,size_missing_at=? WHERE id=? AND proof_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL').bind(...values);
  case 'obligation': return env.DB.prepare('UPDATE entity_obligations SET size_bytes=?,size_missing_at=? WHERE id=? AND proof_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL').bind(...values);
  case 'minutes': return env.DB.prepare('UPDATE obligation_occurrences SET size_bytes=?,size_missing_at=? WHERE id=? AND minutes_file_key=? AND size_bytes IS NULL AND size_missing_at IS NULL').bind(...values);
  case 'import': return env.DB.prepare('UPDATE data_imports SET size_bytes=?,size_missing_at=? WHERE id=? AND raw_file_r2_key=? AND size_bytes IS NULL AND size_missing_at IS NULL').bind(...values);
  case 'member': return env.DB.prepare("UPDATE member_files SET size_bytes=?,size_missing_at=?,updated_at=datetime('now') WHERE id=? AND r2_key=? AND size_bytes IS NULL AND size_missing_at IS NULL").bind(...values);
  default:throw new Error('size_store_unreadable');
 }
}
export async function backfillMemberFileSizes(env:Env,actorId:number,limit:number){
 if(!env.FILES)throw new Error('file_storage_unavailable');
 const counts={checked:0,recorded:0,missing:0,failed:0,changed:0,unattributed:0};
 const auditUid=crypto.randomUUID();
 const started=await env.DB.prepare('INSERT INTO activity_logs(uid,user_id,action,details) VALUES (?,?,?,?)')
  .bind(auditUid,actorId,'member_file_size_backfill',JSON.stringify({outcome:'started'})).run();
 if(!started.success||started.meta.changes!==1)throw new Error('size_audit_unavailable');
 let outcome='unreadable';let complete=false;
 try{
  // Discovery can fail independently: still measure pending, already-known keys.
  try{await discover(env,limit);}catch{counts.failed++;}
  const pending=await env.DB.prepare(PENDING).bind(limit).all<Candidate>();
  if(!pending.success)throw new Error('size_store_unreadable');
  for(const row of pending.results||[]){
   const prefix=row.source==='member'?/^(headshots|brand-logos)\//.test(row.r2_key):row.r2_key.startsWith(prefixes[row.source]);
   if(!prefix){counts.failed++;continue;}
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
  const rest=await env.DB.prepare(PENDING).bind(1).all<Candidate>();
  if(!rest.success)throw new Error('size_store_unreadable');
  const state=await env.DB.prepare('SELECT phase FROM member_file_size_backfill_state WHERE uid=?').bind('member-files-v1').first<{phase:string}>();
  if(!state)throw new Error('size_store_unreadable');
  complete=counts.failed===0&&!(rest.results||[]).length&&state.phase==='done';
  outcome=complete?'complete':counts.failed?'unreadable':'partial';
  return {...counts,complete,outcome};
 }finally{
  const logged=await env.DB.prepare('UPDATE activity_logs SET details=? WHERE uid=? AND user_id=?')
   .bind(JSON.stringify({outcome,...counts}),auditUid,actorId).run();
  if(!logged.success||logged.meta.changes!==1)throw new Error('size_audit_unavailable');
 }
}
