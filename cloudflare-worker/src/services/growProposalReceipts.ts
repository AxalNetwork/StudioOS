/** #6315: durable Grow acceptance receipts, scoped record links and atomic edit-safe undo. */
import type { Env } from '../types';
import { Refused } from './growWriters';
export type GrowProposalSource = 'mercury'|'google'|'posthog'|'beehiiv';
type TargetKind = 'partner'|'obligation'|'feedback'|'channel';
type Target = {id:number;uid:string;grow_undo_version:number};
type Receipt = {uid:string;project_id:number;source:GrowProposalSource;source_id:number;target_kind:TargetKind;target_id:number;target_uid:string;target_version:number;created_record:number;accepted_by:number;state:string};
const MODULES = {partner:'partner-network',obligation:'durable-company-building',feedback:'product-improvement',channel:'distribution'} as const;
const LABELS = {partner:'Partner network',obligation:'Durable company-building obligations',feedback:'Product improvement feedback',channel:'Distribution channels'};
const destination=(row:Receipt)=>({uid:row.uid,source:row.source,source_id:row.source_id,label:LABELS[row.target_kind],
 href:`/grow/${MODULES[row.target_kind]}/${encodeURIComponent(row.target_uid)}?project_id=${row.project_id}`,created_record:!!row.created_record,can_undo:true});
export async function rememberGrowProposal(env:Env,pid:number,userId:number,source:GrowProposalSource,sourceId:number,kind:TargetKind,key:string|number,created:boolean){
 let target:Target|null=null;
 switch(kind){
  case 'partner': target=await env.DB.prepare('SELECT id,uid AS uid,grow_undo_version FROM growth_partners WHERE uid=? AND project_id=?').bind(key,pid).first<Target>();break;
  case 'obligation': target=await env.DB.prepare('SELECT id,CAST(id AS TEXT) AS uid,grow_undo_version FROM compliance_events WHERE id=? AND project_id=?').bind(key,pid).first<Target>();break;
  case 'feedback': target=await env.DB.prepare('SELECT id,uid AS uid,grow_undo_version FROM product_feedback WHERE uid=? AND project_id=?').bind(key,pid).first<Target>();break;
  case 'channel': target=await env.DB.prepare('SELECT id,uid AS uid,grow_undo_version FROM growth_channels WHERE uid=? AND project_id=?').bind(key,pid).first<Target>();break;
 }
 if(!target)throw new Refused(409,'The accepted destination could not be read. Reload the module.');
 const uid=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO grow_proposal_receipts(uid,project_id,source,source_id,target_kind,target_id,target_uid,target_version,created_record,accepted_by)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid,pid,source,sourceId,kind,target.id,target.uid,created?0:target.grow_undo_version,created?1:0,userId).run();
 return destination({uid,project_id:pid,source,source_id:sourceId,target_kind:kind,target_uid:target.uid,created_record:created?1:0} as Receipt);
}
export async function growProposalReceipts(env:Env,pid:number,userId:number,source:string){
 if(!['mercury','google','posthog','beehiiv'].includes(source))throw new Refused(400,'Choose a Grow proposal source.');
 const rows=await env.DB.prepare("SELECT * FROM grow_proposal_receipts WHERE project_id=? AND accepted_by=? AND source=? AND state='accepted' ORDER BY created_at DESC,uid DESC").bind(pid,userId,source).all<Receipt>();
 const receipts=(rows.results||[]).map(destination);
 // Historical acceptances have a destination but no proof that we created an
 // unchanged record. Link them honestly; never infer delete permission.
 let old:D1Result<any>|undefined;
 if(source==='google')old=await env.DB.prepare(`SELECT p.id AS source_id,f.local_id AS target_id,CAST(f.local_id AS TEXT) AS target_uid FROM google_workspace_proposals p
  JOIN integrations i ON i.id=p.integration_id JOIN connector_fed_items f ON f.integration_id=p.integration_id AND f.project_id=p.project_id AND f.external_id='calendar:'||json_extract(p.payload_json,'$.event_id')||':'||p.project_id
  JOIN compliance_events t ON t.id=f.local_id AND t.project_id=p.project_id
  WHERE p.project_id=? AND i.user_id=? AND p.status='accepted' AND f.local_table='compliance_events'
   AND NOT EXISTS(SELECT 1 FROM grow_proposal_receipts r WHERE r.project_id=p.project_id AND r.source='google' AND r.source_id=p.id)`).bind(pid,userId).all();
 if(source==='posthog')old=await env.DB.prepare(`SELECT p.id AS source_id,t.id AS target_id,t.uid AS target_uid FROM posthog_proposals p
  JOIN integrations i ON i.id=p.integration_id JOIN product_feedback t ON p.target_ref='product_feedback:'||t.uid AND t.project_id=p.project_id
  WHERE p.project_id=? AND i.user_id=? AND p.status='accepted'
   AND NOT EXISTS(SELECT 1 FROM grow_proposal_receipts r WHERE r.project_id=p.project_id AND r.source='posthog' AND r.source_id=p.id)`).bind(pid,userId).all();
 for(const item of old?.results||[]){const kind=source==='google'?'obligation':'feedback';
  receipts.push({...destination({uid:`legacy-${source}-${item.source_id}`,project_id:pid,source,target_kind:kind,...item} as Receipt),can_undo:false});
 }
 return {receipts};
}
export async function undoGrowProposal(env:Env,pid:number,userId:number,uid:string){
 const row=await env.DB.prepare("SELECT * FROM grow_proposal_receipts WHERE uid=? AND project_id=? AND accepted_by=? AND state='accepted'").bind(uid,pid,userId).first<Receipt>();
 if(!row)throw new Refused(404,'No undoable acceptance of yours is on this venture.');
 let claim:D1PreparedStatement;
 switch(row.target_kind){
  case 'partner': claim=env.DB.prepare(`UPDATE grow_proposal_receipts SET state='undoing' WHERE uid=? AND state='accepted'
    AND EXISTS(SELECT 1 FROM growth_partners t WHERE t.id=target_id AND t.project_id=grow_proposal_receipts.project_id AND t.grow_undo_version=target_version AND (created_record=0 OR (SELECT COUNT(*) FROM connector_fed_items WHERE local_table='growth_partners' AND local_id=t.id)<=1) AND (created_record=0 OR (NOT EXISTS(SELECT 1 FROM partner_revenue WHERE partner_id=t.id) AND NOT EXISTS(SELECT 1 FROM growth_partner_deals WHERE partner_id=t.id))))`).bind(uid);break;
  case 'obligation': claim=env.DB.prepare(`UPDATE grow_proposal_receipts SET state='undoing' WHERE uid=? AND state='accepted'
    AND EXISTS(SELECT 1 FROM compliance_events t WHERE t.id=target_id AND t.project_id=grow_proposal_receipts.project_id AND t.grow_undo_version=target_version AND (created_record=0 OR (SELECT COUNT(*) FROM connector_fed_items WHERE local_table='compliance_events' AND local_id=t.id)<=1))`).bind(uid);break;
  case 'feedback': claim=env.DB.prepare(`UPDATE grow_proposal_receipts SET state='undoing' WHERE uid=? AND state='accepted'
    AND EXISTS(SELECT 1 FROM product_feedback t WHERE t.id=target_id AND t.project_id=grow_proposal_receipts.project_id AND t.grow_undo_version=target_version)`).bind(uid);break;
  case 'channel': claim=env.DB.prepare(`UPDATE grow_proposal_receipts SET state='undoing' WHERE uid=? AND state='accepted'
    AND EXISTS(SELECT 1 FROM growth_channels t WHERE t.id=target_id AND t.project_id=grow_proposal_receipts.project_id AND t.grow_undo_version=target_version AND (created_record=0 OR (NOT EXISTS(SELECT 1 FROM channel_spend WHERE channel_id=t.id) AND NOT EXISTS(SELECT 1 FROM grow_campaign_channels WHERE channel_id=t.id))))`).bind(uid);break;
 }
 // Validate the source link in the same transaction before removing anything.
 // If it has changed, demote the claim back to accepted; every following write
 // is conditional on the claim still being undoing.
 const statements=[claim,
  env.DB.prepare(`UPDATE grow_proposal_receipts SET state='accepted' WHERE uid=? AND state='undoing' AND NOT (
   (source='mercury' AND EXISTS(SELECT 1 FROM mercury_partner_proposals p WHERE p.id=source_id AND p.project_id=grow_proposal_receipts.project_id AND p.state='accepted' AND p.growth_partner_id=target_id)) OR
   (source='google' AND EXISTS(SELECT 1 FROM google_workspace_proposals p WHERE p.id=source_id AND p.project_id=grow_proposal_receipts.project_id AND p.status='accepted' AND EXISTS(SELECT 1 FROM connector_fed_items f WHERE f.integration_id=p.integration_id AND f.project_id=p.project_id AND f.external_id='calendar:'||json_extract(p.payload_json,'$.event_id')||':'||p.project_id AND f.local_table='compliance_events' AND f.local_id=target_id))) OR
   (source='posthog' AND EXISTS(SELECT 1 FROM posthog_proposals p WHERE p.id=source_id AND p.project_id=grow_proposal_receipts.project_id AND p.status='accepted' AND p.target_ref='product_feedback:'||target_uid)) OR
   (source='beehiiv' AND EXISTS(SELECT 1 FROM beehiiv_publication_links p WHERE p.id=source_id AND p.project_id=grow_proposal_receipts.project_id AND p.channel_state='accepted' AND p.growth_channel_id=target_id))
  )`).bind(uid),
  env.DB.prepare(`UPDATE mercury_partner_proposals SET state='pending',growth_partner_id=NULL,decided_by=NULL,decided_at=NULL WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND source='mercury' AND state='undoing')`).bind(row.source_id,pid,uid),
  env.DB.prepare(`UPDATE google_workspace_proposals SET status='pending',decided_by=NULL,decided_at=NULL WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND source='google' AND state='undoing')`).bind(row.source_id,pid,uid),
  env.DB.prepare(`UPDATE posthog_proposals SET status='pending',target_ref=NULL,decided_by=NULL,decided_at=NULL WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND source='posthog' AND state='undoing')`).bind(row.source_id,pid,uid),
  env.DB.prepare(`UPDATE beehiiv_publication_links SET channel_state='pending',growth_channel_id=NULL,decided_by=NULL,decided_at=NULL WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND source='beehiiv' AND state='undoing')`).bind(row.source_id,pid,uid),
  env.DB.prepare(`UPDATE connector_fed_items SET local_id=NULL WHERE project_id=? AND local_id=? AND
   ((local_table='growth_partners' AND ?='partner') OR (local_table='compliance_events' AND ?='obligation'))
   AND EXISTS(SELECT 1 FROM grow_proposal_receipts r WHERE r.uid=? AND r.state='undoing' AND (
     (r.source='mercury' AND EXISTS(SELECT 1 FROM mercury_partner_proposals p WHERE p.id=r.source_id AND p.integration_id=connector_fed_items.integration_id AND connector_fed_items.external_id='grow:partner:'||p.project_id||':'||p.partner_uid)) OR
     (r.source='google' AND EXISTS(SELECT 1 FROM google_workspace_proposals p WHERE p.id=r.source_id AND p.integration_id=connector_fed_items.integration_id AND connector_fed_items.external_id='calendar:'||json_extract(p.payload_json,'$.event_id')||':'||p.project_id))
   ))`).bind(pid,row.target_id,row.target_kind,row.target_kind,uid),
 ];
 if(row.target_kind==='partner')statements.push(env.DB.prepare(`DELETE FROM growth_partners WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND state='undoing' AND created_record=1)`).bind(row.target_id,pid,uid));
 if(row.target_kind==='obligation')statements.push(env.DB.prepare(`DELETE FROM compliance_events WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND state='undoing' AND created_record=1)`).bind(row.target_id,pid,uid));
 if(row.target_kind==='feedback')statements.push(env.DB.prepare(`DELETE FROM product_feedback WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND state='undoing' AND created_record=1)`).bind(row.target_id,pid,uid));
 if(row.target_kind==='channel')statements.push(env.DB.prepare(`DELETE FROM growth_channels WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM grow_proposal_receipts WHERE uid=? AND state='undoing' AND created_record=1)`).bind(row.target_id,pid,uid));
 // Same fields and actor convention as logGrowWrite/logCycleWriteStatement,
 // conditional here so a refused/replayed undo cannot claim a successful write.
 statements.push(env.DB.prepare(`INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor)
  SELECT project_id,?, ?,target_uid,'grow_proposal_undone','Grow proposal acceptance undone',? FROM grow_proposal_receipts WHERE uid=? AND state='undoing'`).bind(userId,`grow.${MODULES[row.target_kind]}`,`user:${userId}`,uid),
  env.DB.prepare("UPDATE grow_proposal_receipts SET state='undone',undone_by=?,undone_at=CURRENT_TIMESTAMP WHERE uid=? AND state='undoing'").bind(userId,uid));
 const results=await env.DB.batch(statements);
 if(!Number(results.at(-1)?.meta?.changes))throw new Refused(409,'This destination changed after acceptance. Undo is no longer available.');
 return {ok:true};
}
