import type { Env, User } from '../types';
import { positiveCents, validClose, counselApproved, termsHash, readiness, matchReasons, founderRecipient, writableCall } from './roundCallPolicy';
import type { RoundCallTerms, InvestorThesis } from './roundCallPolicy';
import { notify } from './notify';
import { hashEmail } from '../util/hashEmail';
import { activeGrant, ndaActive } from '../routes/data_room';
import { roundCallPipelineStatements } from '../routes/contacts';

export class RoundCallError extends Error {
  status: 400 | 403 | 404 | 409 | 422 | 503;
  code: string;
  constructor(code: string, status: 400 | 403 | 404 | 409 | 422 | 503 = 400) { super(code); this.code = code; this.status = status; }
}
export interface CallRow extends RoundCallTerms {
  id: number; uid: string; project_id: number; company_id: number | null; round_id: number | null;
  state: string; terms_hash: string; counsel_approved_hash: string | null;
  counsel_approval_reference: string | null; counsel_approved_by: number | null; counsel_approved_at: string | null;
  created_by: number; created_at: string; updated_at: string; sent_at: string | null; closed_at: string | null;
}
export interface ProjectFacts {
  id: number; uid: string; name: string; founder_id: number; company_id: number | null;
  sector: string | null; stage: string; description: string | null;
  problem_statement: string | null; solution: string | null; use_of_funds: string | null;
  traction_summary: string | null; revenue: number | null; mrr: number | null; users_count: number | null;
}
interface Recipient {
  investor_user_id: number; origin: string; match_reasons_json: string; name: string; email: string;
  opened_at: string | null; data_room_requested_at: string | null; commitment_cents: number | null;
  responded_at: string | null; delivery_state: string;
}
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
export async function loadCall(env: Env, uid: string): Promise<CallRow> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(uid)) throw new RoundCallError('call_not_found', 404);
  const row = await env.DB.prepare('SELECT * FROM round_calls WHERE uid = ?').bind(uid).first<CallRow>();
  if (!row) throw new RoundCallError('call_not_found', 404);
  return row;
}
export async function projectFacts(env: Env, id: number): Promise<ProjectFacts> {
  const row = await env.DB.prepare('SELECT id, uid, name, founder_id, company_id, sector, stage, description, problem_statement, solution, use_of_funds, traction_summary, revenue, mrr, users_count FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<ProjectFacts>();
  if (!row) throw new RoundCallError('project_not_found', 404);
  return row;
}
export async function roundContext(env: Env, project: ProjectFacts, ownerId: number) {
  const round = await env.DB.prepare("SELECT id, uid, name, target_amount, close_date, notes, pre_money FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(project.id).first();
  const decks = await env.DB.prepare('SELECT id, version, title, is_current, created_at FROM pitch_decks WHERE project_id = ? ORDER BY version DESC, id DESC').bind(project.id).all();
  const scenario = await env.DB.prepare('SELECT uid, name, inputs_json, result_json, computed_at FROM cap_table_scenarios WHERE project_id = ? AND owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').bind(project.id, ownerId).first();
  const room = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM data_room_files WHERE project_id = ?) + (SELECT COUNT(*) FROM data_room_folders WHERE project_id = ?) AS count').bind(project.id, project.id).first<{ count: number }>();
  const chosen = await env.DB.prepare("SELECT p.id AS prospect_id, u.name, u.email FROM raise_prospects p JOIN users u ON LOWER(u.email) = LOWER(p.email) WHERE p.project_id = ? AND u.role = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved' ORDER BY u.name, p.id").bind(project.id).all();
  return { project, round, scenario, decks: decks.results || [], chosen: chosen.results || [],
    data_room: room && room.count > 0 ? { project_uid: project.uid } : null };
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new RoundCallError('invalid_call_fields');
  return value.trim();
}
export async function normalizeTerms(env: Env, project: ProjectFacts, input: Record<string, unknown>): Promise<RoundCallTerms> {
  const name = text(input.name, 200), terms = text(input.terms, 20000);
  if (!positiveCents(input.amount_cents) || !positiveCents(input.minimum_cheque_cents)
    || input.minimum_cheque_cents > input.amount_cents || !validClose(input.target_close) || input.target_close < today()
    || !['safe', 'equity', 'convertible_note'].includes(String(input.instrument))) throw new RoundCallError('invalid_call_fields');
  let deckId: number | null = null, deckVersion: number | null = null;
  if (input.deck_id != null) {
    if (!Number.isSafeInteger(input.deck_id)) throw new RoundCallError('invalid_deck');
    const deck = await env.DB.prepare('SELECT id, version FROM pitch_decks WHERE id = ? AND project_id = ?').bind(input.deck_id, project.id).first<{ id: number; version: number }>();
    if (!deck) throw new RoundCallError('deck_not_found', 404);
    if (input.deck_version != null && input.deck_version !== deck.version) throw new RoundCallError('deck_version_changed', 409);
    deckId = deck.id; deckVersion = deck.version;
  }
  let roomUid: string | null = null;
  if (input.data_room_project_uid != null) {
    if (input.data_room_project_uid !== project.uid) throw new RoundCallError('invalid_data_room');
    const room = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM data_room_files WHERE project_id = ?) + (SELECT COUNT(*) FROM data_room_folders WHERE project_id = ?) AS count').bind(project.id, project.id).first<{ count: number }>();
    if (!room || room.count === 0) throw new RoundCallError('data_room_not_recorded', 409);
    roomUid = project.uid;
  }
  return { name, terms, amount_cents: input.amount_cents, minimum_cheque_cents: input.minimum_cheque_cents,
    instrument: String(input.instrument), target_close: input.target_close, deck_id: deckId, deck_version: deckVersion,
    data_room_project_uid: roomUid, stage: project.stage, sector: project.sector };
}
async function audit(env: Env, actor: User, projectId: number, action: string, details: Record<string, unknown>) {
  return env.DB.prepare('INSERT INTO activity_logs(action, details, actor, user_id, project_id) VALUES(?,?,?,?,?)')
    .bind(action, JSON.stringify(details), await hashEmail(actor.email), actor.id, projectId);
}
export async function saveDraft(env: Env, project: ProjectFacts, actor: User, input: Record<string, unknown>, existing?: CallRow) {
  if (existing && existing.state !== 'draft') throw new RoundCallError('call_read_only', 409);
  const t = await normalizeTerms(env, project, input);
  const hash = await termsHash(t), at = now(), uid = existing?.uid || crypto.randomUUID();
  const round = await env.DB.prepare("SELECT id FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(project.id).first<{ id: number }>();
  const statement = existing
    ? env.DB.prepare("UPDATE round_calls SET name=?, amount_cents=?, instrument=?, terms=?, minimum_cheque_cents=?, target_close=?, deck_id=?, deck_version=?, data_room_project_uid=?, stage=?, sector=?, terms_hash=?, counsel_approved_hash=NULL, counsel_approval_reference=NULL, counsel_approved_by=NULL, counsel_approved_at=NULL, updated_at=? WHERE uid=? AND state='draft' AND updated_at=?")
      .bind(t.name,t.amount_cents,t.instrument,t.terms,t.minimum_cheque_cents,t.target_close,t.deck_id,t.deck_version,t.data_room_project_uid,t.stage,t.sector,hash,at,uid,existing.updated_at)
    : env.DB.prepare('INSERT INTO round_calls(uid,project_id,company_id,round_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,deck_version,data_room_project_uid,stage,sector,terms_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(uid,project.id,project.company_id,round?.id ?? null,t.name,t.amount_cents,t.instrument,t.terms,t.minimum_cheque_cents,t.target_close,t.deck_id,t.deck_version,t.data_room_project_uid,t.stage,t.sector,hash,actor.id,at,at);
  const result = await env.DB.batch([statement, await audit(env,actor,project.id,'round_call_draft_requested',{uid,terms_hash:hash})]);
  if (Number(result[0]?.meta?.changes) !== 1) throw new RoundCallError('draft_changed',409);
  return loadCall(env,uid);
}
export async function audience(env: Env, call: CallRow, chosenIds: unknown, includeMatches: unknown) {
  if (!Array.isArray(chosenIds) || chosenIds.length > 100 || chosenIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || typeof includeMatches !== 'boolean') throw new RoundCallError('invalid_audience');
  const selected = new Set(chosenIds as number[]);
  const chosen = await env.DB.prepare("SELECT p.id AS prospect_id, u.id AS investor_user_id FROM raise_prospects p JOIN users u ON LOWER(u.email)=LOWER(p.email) WHERE p.project_id=? AND u.role='investor' AND u.is_active=1 AND u.kyc_status='approved'").bind(call.project_id).all<{ prospect_id: number; investor_user_id: number }>();
  const rows = new Map<number, { investor_user_id: number; origin: string; reasons: string[] }>();
  const found = new Set<number>();
  for (const row of chosen.results || []) if (selected.has(row.prospect_id)) {
    found.add(row.prospect_id); rows.set(row.investor_user_id,{investor_user_id:row.investor_user_id,origin:'chosen',reasons:[]});
  }
  if (found.size !== selected.size) throw new RoundCallError('chosen_investor_unverified',422);
  if (includeMatches) {
    const project = await projectFacts(env,call.project_id);
    const profiles = await env.DB.prepare("SELECT p.user_id, p.sectors_json, p.stages_json, p.thesis_keywords_json, p.ticket_min_usd, p.ticket_max_usd, p.anti_thesis_sectors_json, p.anti_thesis_stages_json FROM investor_profiles p JOIN users u ON u.id=p.user_id WHERE u.role='investor' AND u.is_active=1 AND u.kyc_status='approved'").all<InvestorThesis & { user_id: number }>();
    for (const profile of profiles.results || []) {
      const reasons = matchReasons(call,profile,[project.name,project.description,project.problem_statement,project.solution,project.sector].filter(Boolean).join(' '));
      if (reasons.length && !rows.has(profile.user_id)) rows.set(profile.user_id,{investor_user_id:profile.user_id,origin:'match',reasons});
    }
  }
  if (rows.size > 500) throw new RoundCallError('audience_too_large',422);
  return [...rows.values()];
}
export async function saveAudience(env: Env, call: CallRow, actor: User, input: Record<string, unknown>) {
  if (call.state !== 'draft') throw new RoundCallError('call_read_only',409);
  const rows = await audience(env,call,input.chosen_prospect_ids,input.include_matches), at = now();
  const statements = [
    env.DB.prepare("DELETE FROM round_call_recipients WHERE call_id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='draft')").bind(call.id,call.id),
    ...rows.map(row => env.DB.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,match_reasons_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='draft')")
      .bind(call.id,row.investor_user_id,row.origin,JSON.stringify(row.reasons),call.id)),
    env.DB.prepare("UPDATE round_calls SET counsel_approved_hash=NULL,counsel_approved_by=NULL,counsel_approved_at=NULL,counsel_approval_reference=NULL,updated_at=? WHERE id=? AND state='draft'").bind(at,call.id),
    await audit(env,actor,call.project_id,'round_call_audience_requested',{uid:call.uid,chosen:rows.filter(r=>r.origin==='chosen').length,matched:rows.filter(r=>r.origin==='match').length}),
  ];
  const result = await env.DB.batch(statements);
  if (Number(result[result.length-2]?.meta?.changes) !== 1) throw new RoundCallError('call_read_only',409);
  return { chosen: rows.filter(r=>r.origin==='chosen').length, matched: rows.filter(r=>r.origin==='match').length,
    match_reasons: [...new Set(rows.filter(r=>r.origin==='match').flatMap(r=>r.reasons))] };
}
export async function founderPage(env: Env, call: CallRow) {
  const rows = await env.DB.prepare('SELECT r.investor_user_id,r.origin,r.match_reasons_json,r.opened_at,r.data_room_requested_at,r.commitment_cents,r.responded_at,r.delivery_state,u.name,u.email FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=? ORDER BY r.id').bind(call.id).all<Recipient>();
  const questions = await env.DB.prepare('SELECT q.uid,q.question,q.answer,q.asked_at,q.answered_at,u.name,u.email FROM round_call_questions q JOIN users u ON u.id=q.investor_user_id WHERE q.call_id=? ORDER BY q.asked_at,q.id').bind(call.id).all();
  const recipients = (rows.results || []).map(founderRecipient);
  return { call, viewer: 'founder', read_only: call.state==='closed' || (call.state==='sent' && call.target_close<today()),
    recipients, questions:questions.results || [], counsel_approved:counselApproved(call),
    readiness:readiness(call,await projectFacts(env,call.project_id)),
    progress:{ received:recipients.length,opened:recipients.filter(r=>r.opened_at).length,
      data_room_requests:recipients.filter(r=>r.data_room_requested_at).length,
      commitments:recipients.filter(r=>r.commitment_cents != null).length,
      committed_cents:recipients.reduce((sum,r)=>sum+(r.commitment_cents||0),0),target_cents:call.amount_cents } };
}
export async function sendCall(env: Env, call: CallRow, actor: User, acknowledgeMissing: unknown) {
  if (call.state !== 'draft') throw new RoundCallError('call_already_sent_or_closed',409);
  if (!counselApproved(call)) throw new RoundCallError('counsel_approval_required',409);
  if (call.target_close < today()) throw new RoundCallError('call_expired',409);
  const missing = readiness(call,await projectFacts(env,call.project_id)).filter(item=>!item.ready);
  if (missing.length && acknowledgeMissing !== true) throw new RoundCallError('readiness_acknowledgement_required',422);
  const rows = await env.DB.prepare("SELECT r.investor_user_id,u.role,u.is_active,u.kyc_status FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=?").bind(call.id).all<{investor_user_id:number;role:string;is_active:number;kyc_status:string}>();
  const recipients = rows.results || [];
  if (!recipients.length) throw new RoundCallError('audience_empty',422);
  if (recipients.some(r=>r.role!=='investor'||r.is_active!==1||r.kyc_status!=='approved')) throw new RoundCallError('audience_verification_changed',409);
  const at=now();
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE round_calls SET state='sent',sent_at=?,updated_at=? WHERE id=? AND state='draft' AND terms_hash=? AND counsel_approved_hash=terms_hash AND counsel_approved_by IS NOT NULL AND counsel_approved_at IS NOT NULL AND counsel_approval_reference IS NOT NULL AND target_close>=? AND NOT EXISTS(SELECT 1 FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=round_calls.id AND (u.role<>'investor' OR u.is_active<>1 OR u.kyc_status IS NULL OR u.kyc_status<>'approved'))").bind(at,at,call.id,call.terms_hash,today()),
    await audit(env,actor,call.project_id,'round_call_send_requested',{uid:call.uid,terms_hash:call.terms_hash,acknowledged_missing:missing.map(item=>item.key)}),
  ]);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_changed',409);
  let notified=0;
  for(const recipient of recipients) {
    let id:number|null=null;
    try { id=await notify(env,{userId:recipient.investor_user_id,type:'round_call_received',category:'deals',channels:['in_app'],title:'A private round call',body:'A founder has invited you to read a round call.',link:'/round-calls/'+call.uid}); }
    catch { /* Delivery is recorded as failed, never guessed successful. */ }
    await env.DB.prepare('UPDATE round_call_recipients SET delivery_state=?,notified_at=? WHERE call_id=? AND investor_user_id=?')
      .bind(id==null?'not_delivered':'notified',id==null?null:now(),call.id,recipient.investor_user_id).run();
    if(id!=null) notified++;
  }
  return { uid:call.uid,state:'sent',recipients:recipients.length,notified,not_delivered:recipients.length-notified };
}
export async function investorPage(env: Env, call: CallRow, investor: User) {
  if(call.state==='draft') throw new RoundCallError('call_not_found',404);
  const recipient=await env.DB.prepare('SELECT id,commitment_cents,data_room_requested_at FROM round_call_recipients WHERE call_id=? AND investor_user_id=?').bind(call.id,investor.id).first<{id:number;commitment_cents:number|null;data_room_requested_at:string|null}>();
  if(!recipient) throw new RoundCallError('call_not_found',404);
  await env.DB.prepare("UPDATE round_call_recipients SET opened_at=COALESCE(opened_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='sent' AND target_close>=?)").bind(now(),recipient.id,call.id,today()).run();
  const deck=call.deck_id==null?null:await env.DB.prepare('SELECT version,title,slides FROM pitch_decks WHERE id=? AND version=? AND project_id=?').bind(call.deck_id,call.deck_version,call.project_id).first();
  const nda=call.data_room_project_uid!=null && await ndaActive(env,call.created_by,investor.id);
  const grant=nda?await activeGrant(env,call.project_id,investor.id):null;
  const questions=await env.DB.prepare('SELECT uid,question,answer,asked_at,answered_at FROM round_call_questions WHERE call_id=? AND investor_user_id=? ORDER BY asked_at,id').bind(call.id,investor.id).all();
  return { viewer:'investor',call:{uid:call.uid,name:call.name,amount_cents:call.amount_cents,instrument:call.instrument,
      terms:call.terms,minimum_cheque_cents:call.minimum_cheque_cents,target_close:call.target_close,
      deck_version:call.deck_version,state:call.state,sent_at:call.sent_at},
    deck,recipient,questions:questions.results||[],read_only:!writableCall(call,today()),
    data_room:{recorded:call.data_room_project_uid!=null,nda_signed:!!nda,has_grant:!!grant,
      path:grant?'/data-room/shared/'+call.data_room_project_uid:null} };
}
export async function respond(env: Env, call: CallRow, investor: User, input: Record<string, unknown>) {
  if(!writableCall(call,today())) throw new RoundCallError('call_read_only',409);
  const recipient=await env.DB.prepare('SELECT id FROM round_call_recipients WHERE call_id=? AND investor_user_id=?').bind(call.id,investor.id).first<{id:number}>();
  if(!recipient) throw new RoundCallError('call_not_found',404);
  const action=input.action;
  if(!['commit','question','data_room'].includes(String(action))) throw new RoundCallError('invalid_response');
  let cents:number|null=null,question:string|null=null;
  if(action==='commit') {
    if(!positiveCents(input.amount_cents)||input.amount_cents<call.minimum_cheque_cents||input.amount_cents>call.amount_cents) throw new RoundCallError('invalid_commitment');
    cents=input.amount_cents;
  }
  if(action==='question') question=text(input.question,2000);
  if(action==='data_room') {
    if(!call.data_room_project_uid) throw new RoundCallError('data_room_not_recorded',409);
    if(!await ndaActive(env,call.created_by,investor.id)) throw new RoundCallError('nda_required',409);
  }
  const at=now();
  const statements=[
    env.DB.prepare("UPDATE round_call_recipients SET responded_at=COALESCE(responded_at,?),last_response_at=?,commitment_cents=CASE WHEN ?='commit' THEN ? ELSE commitment_cents END,data_room_requested_at=CASE WHEN ?='data_room' THEN COALESCE(data_room_requested_at,?) ELSE data_room_requested_at END WHERE id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='sent' AND target_close>=?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='investor' AND is_active=1 AND kyc_status='approved')").bind(at,at,action,cents,action,at,recipient.id,call.id,today(),investor.id),
    ...roundCallPipelineStatements(env,{callId:call.id,projectId:call.project_id,investorId:investor.id,name:investor.name,email:investor.email,at,commitmentCents:cents}),
  ];
  if(question) statements.push(env.DB.prepare('INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,asked_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM round_call_recipients r JOIN round_calls c ON c.id=r.call_id WHERE r.id=? AND r.last_response_at=? AND c.state='sent' AND c.target_close>=?)").bind(crypto.randomUUID(),call.id,investor.id,question,at,recipient.id,at,today()));
  statements.push(await audit(env,investor,call.project_id,'round_call_response_requested',{uid:call.uid,action}));
  const result=await env.DB.batch(statements);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_read_only_or_verification_changed',409);
  return {ok:true,pipeline_recorded:true};
}
export async function recordCounsel(env:Env,call:CallRow,actor:User,reference:unknown,expectedHash:unknown) {
  if(call.state!=='draft') throw new RoundCallError('call_read_only',409);
  if(expectedHash!==call.terms_hash) throw new RoundCallError('terms_changed',409);
  const ref=text(reference,2000);
  if(ref.length<10) throw new RoundCallError('counsel_reference_required');
  const at=now();
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE round_calls SET counsel_approved_hash=terms_hash,counsel_approved_by=?,counsel_approved_at=?,counsel_approval_reference=?,updated_at=? WHERE id=? AND state='draft' AND terms_hash=? AND updated_at=?").bind(actor.id,at,ref,at,call.id,call.terms_hash,call.updated_at),
    await audit(env,actor,call.project_id,'round_call_counsel_record_requested',{uid:call.uid,terms_hash:call.terms_hash,reference:ref}),
  ]);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('terms_changed',409);
  return {ok:true,terms_hash:call.terms_hash};
}
export async function manageCall(env:Env,call:CallRow,actor:User,input:Record<string,unknown>) {
  if(!writableCall(call,today())) throw new RoundCallError('call_read_only',409);
  const at=now();
  if(input.action==='close') {
    const result=await env.DB.batch([env.DB.prepare("UPDATE round_calls SET state='closed',closed_at=?,updated_at=? WHERE id=? AND state='sent' AND updated_at=?").bind(at,at,call.id,call.updated_at),
      await audit(env,actor,call.project_id,'round_call_close_requested',{uid:call.uid})]);
    if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_changed',409);
  } else if(input.action==='extend') {
    if(!validClose(input.target_close)||input.target_close<=call.target_close) throw new RoundCallError('invalid_extension');
    const hash=await termsHash({...call,target_close:input.target_close});
    const result=await env.DB.batch([env.DB.prepare("UPDATE round_calls SET target_close=?,terms_hash=?,counsel_approved_hash=NULL,counsel_approved_by=NULL,counsel_approved_at=NULL,counsel_approval_reference=NULL,updated_at=? WHERE id=? AND state='sent' AND updated_at=?").bind(input.target_close,hash,at,call.id,call.updated_at),
      await audit(env,actor,call.project_id,'round_call_extend_requested',{uid:call.uid,target_close:input.target_close})]);
    if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_changed',409);
  } else throw new RoundCallError('invalid_action');
  return loadCall(env,call.uid);
}
export async function answerQuestion(env:Env,call:CallRow,actor:User,questionUid:string,value:unknown) {
  if(!writableCall(call,today())) throw new RoundCallError('call_read_only',409);
  const answer=text(value,4000),at=now();
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE round_call_questions SET answer=?,answered_at=?,answered_by=? WHERE uid=? AND call_id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='sent' AND target_close>=?)").bind(answer,at,actor.id,questionUid,call.id,call.id,today()),
    await audit(env,actor,call.project_id,'round_call_answer_requested',{uid:call.uid,question_uid:questionUid}),
  ]);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('question_unavailable',409);
  return {ok:true};
}
