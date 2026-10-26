/** D891 / #2447: recorded provenance and the actual investor download gates. */
import type { Env, User } from '../types';
import { isSuperAdmin } from '../auth';
import { ownsVenture } from '../routes/_founder_validate_helpers';
import { logCycleWriteStatement, type CycleModules } from './cycleActivity';
import { collectEvidenceSources, candidateKey, EVIDENCE_AREAS, EVIDENCE_RULES, type EvidenceCandidate, type EvidenceArea, type CollectedEvidence } from './raiseEvidenceSources';
export { EVIDENCE_RULES, EVIDENCE_AREAS, collectEvidenceSources, evidenceDate, evidenceStale, evidenceHash, candidateKey } from './raiseEvidenceSources';
import { grantFolderScope, tierAdmits } from './dataRoomAccess';

/** Count a file only if a currently granted, active account can download it. D1103 — inside that grant's folders. */
export async function readableRoomFiles(env: Env, projectId: number): Promise<any[]> {
  const files = await env.DB.prepare('SELECT * FROM data_room_files WHERE project_id = ?').bind(projectId).all<any>();
  const grants = await env.DB.prepare(
    `SELECT g.id, g.investor_user_id,
       EXISTS (SELECT 1 FROM raise_prospects rp WHERE rp.project_id = g.project_id
         AND rp.stage = 'committed' AND LOWER(rp.email) = LOWER(u.email)) AS committed,
       EXISTS (SELECT 1 FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
         JOIN projects p ON p.founder_id = owner.founder_id
         WHERE p.id = g.project_id AND n.party_b_user_id = g.investor_user_id AND n.status = 'active'
           AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))) AS nda_signed
     FROM data_room_grants g JOIN users u ON u.id = g.investor_user_id AND u.is_active = 1
     WHERE g.project_id = ? AND g.status = 'active'
       AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))`,
  ).bind(projectId).all<any>();
  const now = Date.now();
  const scoped = await Promise.all((grants.results || []).map(async g => ({ ...g, folders: await grantFolderScope(env, Number(g.id)) })));
  return (files.results || []).filter(f => scoped.some(g =>
    tierAdmits(f, !!g.committed, now, g.folders) && (f.visibility === 'open' || (f.visibility === 'nda' && !!g.nda_signed))));
}

export type BankFact = { id: number; fact_key: string; label: string | null; amount_cents: number | null; burn_cents: number | null; value: number | null; as_of: string };
/** Recorded Mercury facts, only while the connection and its venture relationship remain live. */
export async function mercuryFacts(env: Env, projectId: number, kind: 'runway' | 'revenue'): Promise<BankFact[]> {
  const res = await env.DB.prepare(
    `SELECT f.id, f.fact_key, f.label, f.amount_cents, f.burn_cents, f.value, f.as_of
       FROM mercury_raise_facts f JOIN integrations i ON i.id = f.integration_id
       WHERE f.project_id = ? AND f.kind = ? AND i.provider_key = 'mercury' AND i.status = 'active'
         AND EXISTS (SELECT 1 FROM projects p JOIN users u ON u.id = i.user_id AND u.is_active = 1
           WHERE p.id = f.project_id AND ((p.founder_id IS NOT NULL AND u.founder_id = p.founder_id)
             OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id AND pm.status = 'accepted')))
       ORDER BY f.as_of DESC, f.id DESC`,
  ).bind(projectId, kind).all<BankFact>();
  return res.results || [];
}
export async function mercuryRunway(env: Env, projectId: number): Promise<BankFact | null> {
  return (await mercuryFacts(env, projectId, 'runway')).find(f => f.fact_key === 'runway') ?? null;
}

/** Verified receipts for the last complete UTC month; never relabelled as MRR. */
export async function verifiedMonthlyRevenue(env: Env, projectId: number) {
  return env.DB.prepare(
    `SELECT substr(received_on, 1, 7) AS month, SUM(amount_cents) AS cents
       FROM revenue_entries WHERE project_id = ? AND verification = 'verified' AND currency = 'usd'
         AND received_on >= date('now', 'start of month', '-1 month')
         AND received_on < date('now', 'start of month')
       GROUP BY substr(received_on, 1, 7) ORDER BY month DESC LIMIT 1`,
  ).bind(projectId).first<{ month: string; cents: number }>();
}

/** A malformed selection compares nothing; an absent legacy selection keeps its original default. */
export function selectedCheckSources(raw: string | null | undefined): string[] {
  if (raw == null) return ['deck', 'metrics'];
  try { const v: unknown = JSON.parse(raw); return Array.isArray(v) ? v.filter(k => k === 'deck' || k === 'metrics') : []; }
  catch { return []; }
}

// D1263 (#3286): candidates, pins and founder decisions. Existing D891 readers above stay intact.
export const EVIDENCE_OPTION = 'raise:evidence';
export const EVIDENCE_LINK_OPTION = 'raise:evidence-link';
export const EVIDENCE_PAGE = '/raise/evidence';
export const EVIDENCE_MAX_REFRESH_WRITES = 500;
const EVIDENCE_SENTENCES = {
  forbidden:'Only this venture’s founders can make this evidence decision.',
  not_found:'This evidence record is not available in this venture.',
  invalid:'The evidence request is invalid. Refresh and try again.',
  changed:'The source or evidence changed. Look again before confirming it.',
  decided:'This candidate has already been decided.',
  unreadable:'Evidence could not be read or saved. Nothing in this decision was saved; try again.',
  busy:'An evidence refresh is already running. Try again shortly.',
} as const;
export class RaiseEvidenceError extends Error {
  readonly code: keyof typeof EVIDENCE_SENTENCES;
  readonly status: 400|403|404|409|503;
  readonly sentence: string;
  constructor(code:keyof typeof EVIDENCE_SENTENCES,status:RaiseEvidenceError['status']) {
    super('raise_evidence_refused');this.code=code;this.status=status;this.sentence=EVIDENCE_SENTENCES[code];
  }
}
export type RaiseEvidenceContext = {env:Env;user:User;projectId:number;companyId:number|null;founder:boolean};
/** The route first uses scope(); this repeats project/company and founder identity for direct service callers. */
export async function raiseEvidenceContext(env:Env,user:User,projectId:number,activeCompany:number|null):Promise<RaiseEvidenceContext>{
  const project=await env.DB.prepare('SELECT id,founder_id,company_id FROM projects WHERE id=? AND deleted_at IS NULL').bind(projectId)
    .first<{id:number;founder_id:number|null;company_id:number|null}>();
  if(!project)throw new RaiseEvidenceError('not_found',404);
  const founder=user.role!=='admin'&&ownsVenture(project,user);
  if(!founder&&user.role!=='admin')throw new RaiseEvidenceError('forbidden',403);
  if(activeCompany!=null&&project.company_id!=null&&project.company_id!==activeCompany&&!isSuperAdmin(user))throw new RaiseEvidenceError('forbidden',403);
  if(!founder&&!isSuperAdmin(user)&&(project.company_id==null||activeCompany!==project.company_id))throw new RaiseEvidenceError('forbidden',403);
  return {env,user,projectId,companyId:project.company_id,founder};
}
function founderOnly(ctx:RaiseEvidenceContext){if(!ctx.founder)throw new RaiseEvidenceError('forbidden',403);}
const nonce=()=>crypto.randomUUID().replaceAll('-','');
const recordRef=(projectId:number)=>'project:'+projectId;
const plain=(value:unknown):Record<string,unknown>|null=>{try{const v=typeof value==='string'?JSON.parse(value):value;return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}};
export const evidenceUid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
const hashKey=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function version(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1)throw new RaiseEvidenceError('invalid',400);return Number(v);}
const MODULE_FOR:Record<EvidenceArea,CycleModules['raise']>={
  'Fundraising readiness':'fundraising-readiness','Investor narrative and Pitch deck':'investor-narrative','Use of funds':'use-of-funds','Data room':'data-room',
  'Cap table':'cap-table','Capital relationships':'capital-relationships','Legal':'fundraising-readiness','Capital model':'fundraising-readiness',
};
function activity(ctx:RaiseEvidenceContext,area:EvidenceArea,id:string,action:string,summary:string){
  return logCycleWriteStatement(ctx.env,{projectId:ctx.projectId,userId:ctx.user.id,cycle:'raise',module:MODULE_FOR[area],entityId:id,action,summary});
}
function evidenceSummary(ref: Pick<EvidenceCandidate,'kind'|'source_label'>, verb: string): string {
  const rule = EVIDENCE_RULES.find(r => r.kind === ref.kind);
  const label = ['connector','document','recorded','signed','typed'].includes(ref.source_label) ? ref.source_label : 'recorded';
  return rule ? `Evidence ${rule.kind} (${label}) ${verb}.` : `Evidence ${verb}.`;
}
/** The shared store holds safe proposal metadata, not bank values, notes, names or quote text. */
function proposalPayload(c:EvidenceCandidate){return JSON.stringify({area:c.area,kind:c.kind,source_table:c.source_table,source_ref:c.source_ref,
  source_label:c.source_label,provider:c.provider,observed_on:c.observed_on,strength:c.strength,summary:c.summary,snapshot_hash:c.snapshot_hash,private_reason:c.private_reason});}
export type EvidenceProposalRow={id:number;uid:string;source_ref:string;source_kind:string;source_label:string;payload_json:string;status:string;usage_log_id:number|null;model:string|null};
async function proposal(ctx:RaiseEvidenceContext,id:string,option=EVIDENCE_OPTION){
  if(!evidenceUid(id))throw new RaiseEvidenceError('not_found',404);
  const row=await ctx.env.DB.prepare(`SELECT id,uid,source_ref,source_kind,source_label,payload_json,status,usage_log_id,model FROM ai_rail_proposals
    WHERE uid=? AND record_ref=? AND rail_option=? AND kind='proposal'`).bind(id,recordRef(ctx.projectId),option).first<EvidenceProposalRow>();
  if(!row)throw new RaiseEvidenceError('not_found',404);return row;
}
export type RaiseEvidenceItem = Omit<EvidenceCandidate,'backs'|'stale'|'date_reason'> & {id:number;uid:string;project_id:number;state:'pinned'|'unpinned';proposal_uid:string|null;visibility:'private'|'summary'|'after_nda';version:number;mutation_uid:string;accepted_by:number|null;accepted_at:string;updated_at:string};
async function item(ctx:RaiseEvidenceContext,id:string){
  if(!evidenceUid(id))throw new RaiseEvidenceError('not_found',404);
  const row=await ctx.env.DB.prepare('SELECT * FROM raise_evidence_items WHERE uid=? AND project_id=?').bind(id,ctx.projectId).first<RaiseEvidenceItem>();
  if(!row)throw new RaiseEvidenceError('not_found',404);return row;
}
async function live(ctx:RaiseEvidenceContext,ref:Pick<EvidenceCandidate,'kind'|'area'|'source_table'|'source_ref'>,collected?:CollectedEvidence){
  const sources=collected??await collectEvidenceSources(ctx.env,ctx.projectId,ctx.user.id,new Date().toISOString(),[ref.kind]);
  const rule=EVIDENCE_RULES.find(r=>r.kind===ref.kind);
  if(!rule)throw new RaiseEvidenceError('changed',409);
  const block=sources.blocks.find(b=>b.dataset===rule.dataset);
  if(block?.state==='unreadable')throw new RaiseEvidenceError('unreadable',503);
  const current=sources.candidates.find(c=>c.kind===ref.kind&&candidateKey(c)===candidateKey(ref));
  if(!current)throw new RaiseEvidenceError('changed',409);return current;
}

/** One refresh lease and a one-hour successful-build clock. Partial sources do not become a fresh empty pack. */
export async function buildCandidates(ctx:RaiseEvidenceContext,opts:{force?:boolean;now?:string;sources?:CollectedEvidence}={}){
  founderOnly(ctx);const now=opts.now??new Date().toISOString(),token=nonce();
  const lease=await ctx.env.DB.prepare(`INSERT INTO raise_evidence_refreshes(project_id,last_attempt_at,lease_uid,lease_until)
    SELECT p.id,?,?,datetime(?,'+5 minutes') FROM projects p JOIN users u ON u.id=? AND u.is_active=1
    WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ? AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1)
    ON CONFLICT(project_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,lease_uid=excluded.lease_uid,lease_until=excluded.lease_until
    WHERE (raise_evidence_refreshes.lease_until IS NULL OR datetime(raise_evidence_refreshes.lease_until)<=datetime(?))
      AND (?=1 OR raise_evidence_refreshes.last_attempt_at IS NULL OR datetime(raise_evidence_refreshes.last_attempt_at)<datetime(?,'-1 hour'))`)
    .bind(now,token,now,ctx.user.id,ctx.projectId,ctx.companyId,now,opts.force?1:0,now).run();
  if(!lease.meta.changes){const cached=await ctx.env.DB.prepare('SELECT last_built_at,lease_until,outcome FROM raise_evidence_refreshes WHERE project_id=?').bind(ctx.projectId).first<{last_built_at:string|null;lease_until:string|null;outcome:string}>();
    return {refreshed:false,busy:cached?.lease_until!=null&&Date.parse(cached.lease_until.replace(' ','T')+'Z')>Date.parse(now),outcome:cached?.outcome??'not_recorded',changed:null,remaining:null};}
  let changed=0;
  try{
    const sources=opts.sources??await collectEvidenceSources(ctx.env,ctx.projectId,ctx.user.id,now);
    const rows=await ctx.env.DB.prepare(`SELECT id,uid,source_ref,source_kind,source_label,payload_json,status,usage_log_id,model FROM ai_rail_proposals WHERE record_ref=? AND rail_option=? AND kind='proposal'`)
      .bind(recordRef(ctx.projectId),EVIDENCE_OPTION).all<EvidenceProposalRow>();
    const byKey=new Map(rows.results.map(row=>[row.source_ref,row]));
    const pinned=await ctx.env.DB.prepare('SELECT area,source_table,source_ref FROM raise_evidence_items WHERE project_id=?').bind(ctx.projectId).all<Pick<EvidenceCandidate,'area'|'source_table'|'source_ref'>>();
    const taken=new Set(pinned.results.map(candidateKey));
    const pending=sources.candidates.filter(c=>{const row=byKey.get(candidateKey(c));return row?row.status==='proposed'&&plain(row.payload_json)?.snapshot_hash!==c.snapshot_hash:!taken.has(candidateKey(c));});
    const selected=pending.slice(0,EVIDENCE_MAX_REFRESH_WRITES);
    for(let offset=0;offset<selected.length;offset+=50){
      const statements=selected.slice(offset,offset+50).map(c=>{const previous=byKey.get(candidateKey(c));const kind=c.source_label==='connector'?'connector':'module';
        if(previous)return ctx.env.DB.prepare(`UPDATE ai_rail_proposals SET payload_json=?,source_kind=?,source_label=?,updated_at=? WHERE uid=? AND status='proposed'
          AND record_ref=? AND rail_option=? AND EXISTS(SELECT 1 FROM raise_evidence_refreshes WHERE project_id=? AND lease_uid=?)`)
          .bind(proposalPayload(c),kind,c.source_label,now,previous.uid,recordRef(ctx.projectId),EVIDENCE_OPTION,ctx.projectId,token);
        return ctx.env.DB.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,source_kind,source_ref,source_label)
          SELECT ?,?,?,?,?,'proposal',?,?,?,? WHERE EXISTS(SELECT 1 FROM raise_evidence_refreshes WHERE project_id=? AND lease_uid=?)
          ON CONFLICT DO NOTHING`).bind(nonce(),ctx.user.id,EVIDENCE_PAGE,EVIDENCE_OPTION,recordRef(ctx.projectId),proposalPayload(c),kind,candidateKey(c),c.source_label,ctx.projectId,token);
      });
      const results=await ctx.env.DB.batch(statements);changed+=results.reduce((n,r)=>n+Number(r.meta.changes??0),0);
    }
    const remaining=pending.length-selected.length;
    const outcome=sources.blocks.every(b=>b.state==='unreadable')?'unreadable':remaining||sources.blocks.some(b=>b.state==='unreadable')?'partial':'recorded';
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`UPDATE raise_evidence_refreshes SET last_built_at=CASE WHEN ?='recorded' THEN ? ELSE last_built_at END,outcome=?,blocks_json=?,lease_uid=NULL,lease_until=NULL WHERE project_id=? AND lease_uid=?`)
        .bind(outcome,now,outcome,JSON.stringify(sources.blocks),ctx.projectId,token),
      activity(ctx,'Fundraising readiness','refresh','evidence_refreshed','Evidence candidate refresh recorded.'),
    ]);
    return {refreshed:true,busy:false,outcome,changed,remaining};
  }catch{
    await ctx.env.DB.prepare(`UPDATE raise_evidence_refreshes SET outcome='unreadable',lease_uid=NULL,lease_until=NULL WHERE project_id=? AND lease_uid=?`).bind(ctx.projectId,token).run().catch(()=>{});
    return {refreshed:true,busy:false,outcome:'unreadable',changed,remaining:null};
  }
}

/** SQL NOT NULL provenance is also the batch's guard: no successful first write means the entire decision rolls back. */
function itemProvenance(ctx:RaiseEvidenceContext,uid:string,token:string,column:string,before:string|null,after:string,source:Pick<EvidenceCandidate,'source_label'|'source_ref'>,proposalId:number|null=null){
  return ctx.env.DB.prepare(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,proposal_id,fill_class,proposed_value,written_value,edited,citation_json,model,task,decided_by,target_row_ref,ai_usage_log_id,ai_proposal_id)
    VALUES('raise_evidence_items',(SELECT id FROM raise_evidence_items WHERE uid=? AND project_id=? AND mutation_uid=?),?,NULL,'restatement',?,?,0,?,NULL,'raise:evidence',?,?,NULL,?)`)
    .bind(uid,ctx.projectId,token,column,after,after,JSON.stringify({source_kind:source.source_label==='connector'?'connector':'module',source_ref:source.source_ref,source_label:source.source_label,prior_value:before}),ctx.user.id,uid,proposalId);
}
function proposalProvenance(ctx:RaiseEvidenceContext,q:EvidenceProposalRow,token:string,written:string){
  return ctx.env.DB.prepare(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,proposal_id,fill_class,proposed_value,written_value,edited,citation_json,model,task,decided_by,target_row_ref,ai_usage_log_id,ai_proposal_id)
    VALUES('ai_rail_proposals',(SELECT id FROM ai_rail_proposals WHERE uid=? AND record_ref=? AND json_extract(decided_payload_json,'$.decision_uid')=?),'status',NULL,'restatement',?,?,0,?,NULL,'raise:evidence',?,?,NULL,?)`)
    .bind(q.uid,recordRef(ctx.projectId),token,written,written,JSON.stringify({source_kind:q.source_kind,source_ref:q.source_ref,source_label:q.source_label,prior_value:'proposed'}),ctx.user.id,q.uid,q.id);
}
async function decideBatch(ctx:RaiseEvidenceContext,statements:ReturnType<Env['DB']['prepare']>[],check?:()=>Promise<boolean|RaiseEvidenceError|null>){
  try{await ctx.env.DB.batch(statements);}catch{const conflict=check?await check().catch(()=>false):false;if(conflict instanceof RaiseEvidenceError)throw conflict;if(conflict)throw new RaiseEvidenceError('decided',409);throw new RaiseEvidenceError('unreadable',503);}
}

/** Accept only the exact source snapshot the founder saw. Values and labels are always rebuilt by code. */
export async function acceptItem(ctx:RaiseEvidenceContext,uid:string,expectedHash:unknown){
  founderOnly(ctx);if(!hashKey(expectedHash))throw new RaiseEvidenceError('invalid',400);
  const q=await proposal(ctx,uid);if(q.status!=='proposed')throw new RaiseEvidenceError('decided',409);
  const offered=plain(q.payload_json);if(!offered||offered.snapshot_hash!==expectedHash)throw new RaiseEvidenceError('changed',409);
  const current=await live(ctx,offered as EvidenceCandidate);if(current.snapshot_hash!==expectedHash)throw new RaiseEvidenceError('changed',409);
  const token=nonce(),id=nonce();
  const claim=ctx.env.DB.prepare(`UPDATE ai_rail_proposals SET status='accepted',decided_payload_json=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE uid=? AND record_ref=? AND rail_option=? AND status='proposed' AND json_extract(payload_json,'$.snapshot_hash')=?
    AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ?
      AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
    .bind(JSON.stringify({decision_uid:token,snapshot_hash:expectedHash}),uid,recordRef(ctx.projectId),EVIDENCE_OPTION,expectedHash,ctx.user.id,ctx.projectId,ctx.companyId);
  const pin=ctx.env.DB.prepare(`INSERT INTO raise_evidence_items(uid,project_id,area,kind,source_table,source_ref,provider,source_label,strength,observed_on,summary,value_num,value_unit,currency,snapshot_hash,proposal_uid,visibility,private_reason,mutation_uid,accepted_by,updated_by)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ai_rail_proposals WHERE uid=? AND record_ref=? AND json_extract(decided_payload_json,'$.decision_uid')=?)`)
    .bind(id,ctx.projectId,current.area,current.kind,current.source_table,current.source_ref,current.provider,current.source_label,current.strength,current.observed_on,current.summary,current.value_num,current.value_unit,current.currency,current.snapshot_hash,q.uid,current.private_reason?'private':'after_nda',current.private_reason,token,ctx.user.id,ctx.user.id,q.uid,recordRef(ctx.projectId),token);
  await decideBatch(ctx,[claim,pin,itemProvenance(ctx,id,token,'snapshot_hash',null,current.snapshot_hash,current,q.id),activity(ctx,current.area,id,'evidence_accepted',evidenceSummary(current,'accepted'))],async()=> (await proposal(ctx,uid)).status!=='proposed');
  return item(ctx,id);
}
export async function dismissItem(ctx:RaiseEvidenceContext,uid:string){
  founderOnly(ctx);const q=await proposal(ctx,uid);if(q.status!=='proposed')throw new RaiseEvidenceError('decided',409);
  const offered=plain(q.payload_json);if(!offered||!EVIDENCE_AREAS.includes(offered.area as EvidenceArea))throw new RaiseEvidenceError('changed',409);
  const token=nonce();
  const claim=ctx.env.DB.prepare(`UPDATE ai_rail_proposals SET status='discarded',decided_payload_json=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE uid=? AND record_ref=? AND rail_option=? AND status='proposed' AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1
      WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ? AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
    .bind(JSON.stringify({decision_uid:token}),uid,recordRef(ctx.projectId),EVIDENCE_OPTION,ctx.user.id,ctx.projectId,ctx.companyId);
  await decideBatch(ctx,[claim,proposalProvenance(ctx,q,token,'discarded'),activity(ctx,offered.area as EvidenceArea,uid,'evidence_dismissed',evidenceSummary(offered as EvidenceCandidate,'dismissed'))],async()=> (await proposal(ctx,uid)).status!=='proposed');
  return {uid,status:'discarded'};
}

/** Sharing/unpinning is a versioned founder decision; confirming a changed source never creates a second candidate. */
export async function setSharing(ctx:RaiseEvidenceContext,uid:string,data:Record<string,unknown>){
  founderOnly(ctx);if(Object.keys(data).some(k=>!['version','visibility','state','confirm_current'].includes(k)))throw new RaiseEvidenceError('invalid',400);
  const old=await item(ctx,uid),expected=version(data.version);if(expected!==old.version)throw new RaiseEvidenceError('changed',409);
  if(data.visibility!==undefined&&!['private','summary','after_nda'].includes(String(data.visibility)))throw new RaiseEvidenceError('invalid',400);
  if(data.state!==undefined&&!['pinned','unpinned'].includes(String(data.state)))throw new RaiseEvidenceError('invalid',400);
  if(data.confirm_current!==undefined&&typeof data.confirm_current!=='boolean')throw new RaiseEvidenceError('invalid',400);
  const visibility=(data.visibility??old.visibility) as RaiseEvidenceItem['visibility'],state=(data.state??old.state) as RaiseEvidenceItem['state'];
  // Unpin and make-private remain possible when the source is gone or unreadable.
  let current:Omit<EvidenceCandidate,'backs'|'stale'|'date_reason'>=old;
  if(state==='pinned'&&(visibility!=='private'||data.confirm_current===true||old.state!=='pinned')){
    current=await live(ctx,old);if(current.snapshot_hash!==old.snapshot_hash&&data.confirm_current!==true)throw new RaiseEvidenceError('changed',409);
  }else if(data.confirm_current===true)current=await live(ctx,old);
  const token=nonce();
  const change=ctx.env.DB.prepare(`UPDATE raise_evidence_items SET visibility=?,state=?,snapshot_hash=?,source_label=?,provider=?,strength=?,observed_on=?,summary=?,value_num=?,value_unit=?,currency=?,private_reason=?,version=version+1,mutation_uid=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE uid=? AND project_id=? AND version=? AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1
      WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ? AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
    .bind(visibility,state,current.snapshot_hash,current.source_label,current.provider,current.strength,current.observed_on,current.summary,current.value_num,current.value_unit,current.currency,current.private_reason,token,ctx.user.id,uid,ctx.projectId,expected,ctx.user.id,ctx.projectId,ctx.companyId);
  await decideBatch(ctx,[change,itemProvenance(ctx,uid,token,'visibility',old.visibility,visibility,current),
    itemProvenance(ctx,uid,token,'state',old.state,state,current),itemProvenance(ctx,uid,token,'snapshot_hash',old.snapshot_hash,current.snapshot_hash,current),
    ctx.env.DB.prepare(`UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE project_id=? AND id IN
      (SELECT l.claim_id FROM raise_claim_evidence l JOIN raise_evidence_items i ON i.id=l.item_id AND i.project_id=l.project_id WHERE i.uid=? AND i.project_id=? AND i.mutation_uid=?)`).bind(ctx.projectId,uid,ctx.projectId,token),
    activity(ctx,old.area,uid,'evidence_changed',evidenceSummary(old,'sharing or pin state changed')),
  ],async()=> (await item(ctx,uid)).version!==expected ? new RaiseEvidenceError('changed',409) : null);
  return item(ctx,uid);
}

/** Manual links cannot claim to be computed or Eadwyn-written. A supplied Eadwyn proposal must match both records and a real run. */
export async function linkClaim(ctx:RaiseEvidenceContext,claimUid:string,data:Record<string,unknown>,remove=false){
  founderOnly(ctx);if(Object.keys(data).some(k=>!['item_id','item_version','proposal_uid'].includes(k))||!evidenceUid(claimUid)||!evidenceUid(data.item_id))throw new RaiseEvidenceError('invalid',400);
  const claim=await ctx.env.DB.prepare('SELECT id,uid FROM raise_claims WHERE uid=? AND project_id=?').bind(claimUid,ctx.projectId).first<{id:number;uid:string}>();
  if(!claim)throw new RaiseEvidenceError('not_found',404);
  const selected=await item(ctx,data.item_id),token=nonce();
  const readLink=()=>ctx.env.DB.prepare('SELECT id FROM raise_claim_evidence WHERE project_id=? AND claim_id=? AND item_id=?').bind(ctx.projectId,claim.id,selected.id).first();
  const existing=await readLink();
  if(remove&&!existing)throw new RaiseEvidenceError('not_found',404);
  if(!remove&&existing)throw new RaiseEvidenceError('decided',409);
  if(!remove){
    const expected=version(data.item_version);if(expected!==selected.version||selected.state!=='pinned')throw new RaiseEvidenceError('changed',409);
    const current=await live(ctx,selected);if(current.snapshot_hash!==selected.snapshot_hash)throw new RaiseEvidenceError('changed',409);
  }
  let q:EvidenceProposalRow|null=null;
  if(data.proposal_uid!==undefined){
    if(remove||!evidenceUid(data.proposal_uid))throw new RaiseEvidenceError('invalid',400);
    q=await proposal(ctx,data.proposal_uid,EVIDENCE_LINK_OPTION);const payload=plain(q.payload_json);
    if(q.status!=='proposed')throw new RaiseEvidenceError('decided',409);
    if(q.usage_log_id==null||!q.model||payload?.claim_id!==claimUid||payload?.item_id!==selected.uid||payload?.snapshot_hash!==selected.snapshot_hash)throw new RaiseEvidenceError('changed',409);
    const run=await ctx.env.DB.prepare('SELECT id FROM ai_usage_logs WHERE id=? AND user_id=? AND model=? AND rail_option=? AND record_ref=?').bind(q.usage_log_id,ctx.user.id,q.model,EVIDENCE_LINK_OPTION,recordRef(ctx.projectId)).first();
    if(!run)throw new RaiseEvidenceError('forbidden',403);
  }
  const statements:ReturnType<Env['DB']['prepare']>[]=[];
  if(q)statements.push(ctx.env.DB.prepare(`UPDATE ai_rail_proposals SET status='accepted',decided_payload_json=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE uid=? AND record_ref=? AND rail_option=? AND status='proposed'`).bind(JSON.stringify({decision_uid:token}),q.uid,recordRef(ctx.projectId),EVIDENCE_LINK_OPTION));
  if(remove){
    statements.push(ctx.env.DB.prepare(`UPDATE raise_claim_evidence SET mutation_uid=? WHERE claim_id=? AND item_id=? AND project_id=? AND EXISTS
      (SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ?
       AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
      .bind(token,claim.id,selected.id,ctx.projectId,ctx.user.id,ctx.projectId,ctx.companyId));
  }else{
    statements.push(ctx.env.DB.prepare(`INSERT INTO raise_claim_evidence(project_id,claim_id,item_id,how,proposal_uid,created_by,mutation_uid)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM raise_evidence_items WHERE id=? AND project_id=? AND state='pinned' AND version=? AND snapshot_hash=?)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM ai_rail_proposals WHERE uid=? AND record_ref=? AND json_extract(decided_payload_json,'$.decision_uid')=?))
      AND EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=? AND u.is_active=1 WHERE p.id=? AND p.deleted_at IS NULL AND p.company_id IS ?
        AND p.founder_id=u.founder_id AND u.role<>'admin' AND (u.role='founder' OR u.spinout_lab_active=1))`)
      .bind(ctx.projectId,claim.id,selected.id,q?'eadwyn_accepted':'founder',q?.uid??null,ctx.user.id,token,selected.id,ctx.projectId,selected.version,selected.snapshot_hash,
        q?.uid??null,q?.uid??null,recordRef(ctx.projectId),token,ctx.user.id,ctx.projectId,ctx.companyId));
  }
  // A no-op, a duplicate link or a failed permission check cannot leave provenance or activity.
  statements.push(ctx.env.DB.prepare(`INSERT INTO fill_provenance(target_table,target_row_id,target_column,proposal_id,fill_class,proposed_value,written_value,edited,citation_json,model,task,decided_by,target_row_ref,ai_usage_log_id,ai_proposal_id)
    VALUES('raise_claim_evidence',(SELECT id FROM raise_claim_evidence WHERE project_id=? AND claim_id=? AND item_id=? AND mutation_uid=?),'how',NULL,'restatement',?,?,0,?,?,?, ?,?,?,?)`)
    .bind(ctx.projectId,claim.id,selected.id,token,remove?'unlinked':q?'eadwyn_accepted':'founder',remove?'unlinked':q?'eadwyn_accepted':'founder',
      JSON.stringify({source_kind:q?'eadwyn':selected.source_label==='connector'?'connector':'module',source_ref:selected.source_ref,source_label:selected.source_label,
        prior_value:remove?'linked':null,claim_uid:claimUid,item_uid:selected.uid}),q?.model??null,q?EVIDENCE_LINK_OPTION:EVIDENCE_OPTION,ctx.user.id,claimUid,q?.usage_log_id??null,q?.id??null));
  if(remove)statements.push(ctx.env.DB.prepare('DELETE FROM raise_claim_evidence WHERE project_id=? AND claim_id=? AND item_id=? AND mutation_uid=?').bind(ctx.projectId,claim.id,selected.id,token));
  statements.push(ctx.env.DB.prepare("UPDATE raise_claims SET state='not_backed',checked_at=NULL WHERE id=? AND project_id=?").bind(claim.id,ctx.projectId),activity(ctx,selected.area,claimUid,remove?'evidence_unlinked':'evidence_linked',evidenceSummary(selected,remove?'unlinked from a claim':'linked to a claim; its state needs checking')));
  await decideBatch(ctx,statements,async()=>{
    if(q&&(await proposal(ctx,q.uid,EVIDENCE_LINK_OPTION)).status!=='proposed')return new RaiseEvidenceError('decided',409);
    if((await item(ctx,selected.uid)).version!==selected.version)return new RaiseEvidenceError('changed',409);
    const linked=await readLink();
    return remove&&!linked?new RaiseEvidenceError('not_found',404):!remove&&linked?new RaiseEvidenceError('decided',409):null;
  });
  return {claim_id:claimUid,item_id:selected.uid,linked:!remove,how:remove?null:q?'eadwyn_accepted':'founder'};
}

const unreadableBlock={state:'unreadable',rows:null,has_more:null,reason:'This evidence block could not be read. Try again.'} as const;
/** Each read block fails independently. Admins get metadata, never bank figures, quote bodies or claim text. */
export async function readRaiseEvidence(ctx:RaiseEvidenceContext,query:{limit?:number;offset?:number;refresh?:boolean}={}){
  const limit=query.limit??50,offset=query.offset??0;if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new RaiseEvidenceError('invalid',400);
  let sources:CollectedEvidence|null=null,refresh:unknown={refreshed:false,outcome:'founder_only'};
  if(ctx.founder){sources=await collectEvidenceSources(ctx.env,ctx.projectId,ctx.user.id);
    try{refresh=await buildCandidates(ctx,{force:query.refresh,sources});}catch{refresh={refreshed:false,outcome:'unreadable',reason:'Candidates could not be prepared. Try again.'};}}
  const current=new Map(sources?.candidates.map(c=>[candidateKey(c),c])??[]);
  const items=await(async()=>{try{
    const rows=await ctx.env.DB.prepare(`SELECT * FROM raise_evidence_items WHERE project_id=? AND (?=1 OR private_reason IS NULL) ORDER BY id DESC LIMIT ? OFFSET ?`).bind(ctx.projectId,ctx.founder?1:0,limit+1,offset).all<RaiseEvidenceItem>();
    return {state:'recorded',rows:rows.results.slice(0,limit).map(row=>{
      const found=current.get(candidateKey(row));const rule=EVIDENCE_RULES.find(r=>r.kind===row.kind);
      const failed=rule&&sources?.blocks.some(b=>b.dataset===rule.dataset&&b.state==='unreadable');
      const changed=ctx.founder?found?found.snapshot_hash!==row.snapshot_hash:null:null;
      const common={uid:row.uid,area:row.area,kind:row.kind,source_label:row.source_label,provider:row.provider,strength:row.strength,observed_on:row.observed_on,summary:row.summary,
        state:row.state,visibility:row.visibility,version:row.version};
      if(!ctx.founder)return common;
      const bankUnavailable=row.private_reason==='bank'&&(!found||failed);
      return {...common,source_table:row.source_table,source_ref:row.source_ref,snapshot_hash:row.snapshot_hash,
        value_num:bankUnavailable?null:row.value_num,value_unit:bankUnavailable?null:row.value_unit,currency:bankUnavailable?null:row.currency,
        source_state:failed?'unreadable':!found?'not_recorded':changed?'changed':'recorded',source_changed:changed,
        stale:found?.stale??null,date_reason:found?.date_reason??'The source observation date is not recorded.'};
    }),has_more:rows.results.length>limit};
  }catch{return unreadableBlock;}})();
  const proposals=await(async()=>{try{
    const rows=await ctx.env.DB.prepare(`SELECT id,uid,source_ref,source_kind,source_label,payload_json,status,usage_log_id,model FROM ai_rail_proposals
      WHERE record_ref=? AND rail_option=? AND kind='proposal' AND status='proposed'
        AND (?=1 OR json_extract(payload_json,'$.private_reason') IS NULL) ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(recordRef(ctx.projectId),EVIDENCE_OPTION,ctx.founder?1:0,limit+1,offset).all<EvidenceProposalRow>();
    return {state:'recorded',rows:rows.results.slice(0,limit).map(q=>{const offered=plain(q.payload_json);if(!offered)throw new Error('proposal_unreadable');
      const found=current.get(q.source_ref),fresh=found?.snapshot_hash===offered.snapshot_hash;
      const metadata={uid:q.uid,area:offered.area,kind:offered.kind,source_label:offered.source_label,provider:offered.provider,strength:offered.strength,observed_on:offered.observed_on,summary:offered.summary,status:q.status};
      if(!ctx.founder)return metadata;
      return {...metadata,source_table:offered.source_table,source_ref:offered.source_ref,snapshot_hash:offered.snapshot_hash,value_num:fresh?found?.value_num??null:null,
        value_unit:fresh?found?.value_unit??null:null,currency:fresh?found?.currency??null:null,can_accept:!!fresh,source_state:fresh?'recorded':'changed',
        date_reason:found?.date_reason??'The source observation date is not recorded.',stale:found?.stale??null};
    }),has_more:rows.results.length>limit};
  }catch{return unreadableBlock;}})();
  const claims=await(async()=>{try{
    const rows=await ctx.env.DB.prepare('SELECT id,uid,surface,surface_version,field_key,claim_kind,stated_value,state,checked_at FROM raise_claims WHERE project_id=? ORDER BY id DESC LIMIT ? OFFSET ?')
      .bind(ctx.projectId,limit+1,offset).all<{id:number;uid:string;surface:string;surface_version:string;field_key:string;claim_kind:string;stated_value:string|null;state:string;checked_at:string|null}>();
    const links=await ctx.env.DB.prepare(`SELECT c.uid AS claim_uid,i.uid AS item_uid,i.version AS item_version,l.how FROM raise_claim_evidence l JOIN raise_claims c ON c.id=l.claim_id AND c.project_id=l.project_id
      JOIN raise_evidence_items i ON i.id=l.item_id AND i.project_id=l.project_id WHERE l.project_id=? AND (?=1 OR i.private_reason IS NULL)`).bind(ctx.projectId,ctx.founder?1:0).all<{claim_uid:string;item_uid:string;item_version:number;how:string}>();
    return {state:'recorded',rows:rows.results.slice(0,limit).map(row=>ctx.founder?{...row,links:links.results.filter(l=>l.claim_uid===row.uid)}:
      {uid:row.uid,surface:row.surface,claim_kind:row.claim_kind,state:row.state,checked_at:row.checked_at}),has_more:rows.results.length>limit};
  }catch{return unreadableBlock;}})();
  const coverage=await(async()=>{try{const result=await ctx.env.DB.prepare(`SELECT area,source_label,state,visibility,COUNT(*) AS count FROM raise_evidence_items
    WHERE project_id=? AND (?=1 OR private_reason IS NULL) GROUP BY area,source_label,state,visibility`).bind(ctx.projectId,ctx.founder?1:0)
      .all<{area:string;source_label:string;state:string;visibility:string;count:number}>();return {state:'recorded',groups:result.results};}
    catch{return {state:'unreadable',groups:null,reason:'Coverage could not be read. Try again.'};}})();
  return {items,proposals,claims,coverage,sources:ctx.founder?sources?.blocks??null:null,refresh,permissions:{can_decide:ctx.founder,can_share:ctx.founder},limit,offset};
}
