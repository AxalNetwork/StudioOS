import type { Env, User } from '../types';
import { positiveCents, validClose, counselApproved, termsHash, deckContentHash, readiness, matchReasons, founderRecipient, writableCall, roundCallsEnabled, verifiedInvestor } from './roundCallPolicy';
import type { RoundCallTerms, InvestorThesis } from './roundCallPolicy';
import { notify } from './notify';
import { hashEmail } from '../util/hashEmail';
import { activeGrant, ndaActive } from '../routes/data_room';
import { roundCallPipelineStatements } from '../routes/contacts';

export class RoundCallError extends Error {
  status: 400 | 403 | 404 | 409 | 422 | 503;
  code: string;
  /** Authored validation copy, separate from unexpected exception/provider text. */
  sentence?: string;
  constructor(code: string, status: 400 | 403 | 404 | 409 | 422 | 503 = 400, sentence?: string) { super(sentence ?? code); this.code = code; this.status = status; this.sentence = sentence; }
}
export interface CallRow extends RoundCallTerms {
  id: number; uid: string; project_id: number; company_id: number | null; round_id: number | null;
  state: string; revision: number; terms_hash: string; counsel_approved_hash: string | null;
  counsel_approval_reference: string | null; counsel_approved_by: number | null; counsel_approved_at: string | null;
  counsel_requested_at: string | null; counsel_requested_by: number | null; counsel_requested_hash: string | null;
  created_by: number; created_at: string; updated_at: string; sent_at: string | null; closed_at: string | null;
}
export interface ProjectFacts {
  id: number; uid: string; name: string; founder_id: number | null; company_id: number | null;
  sector: string | null; stage: string; description: string | null;
  problem_statement: string | null; solution: string | null; use_of_funds: string | null;
  traction_summary: string | null; revenue: number | null; mrr: number | null; users_count: number | null;
}
interface Recipient {
  investor_user_id: number; origin: string; match_reasons_json: string; name: string; email: string;
  opened_at: string | null; data_room_requested_at: string | null; commitment_cents: number | null;
  responded_at: string | null; committed_at: string | null; last_response_at: string | null; delivery_state: string;
}
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
function enabled(env: Env) {
  if(!roundCallsEnabled(env)) throw new RoundCallError('round_calls_disabled',503);
}
async function verifiedReader(env: Env, actor: User) {
  enabled(env);
  const current=await env.DB.prepare('SELECT role,is_active,kyc_status FROM users WHERE id=?').bind(actor.id).first<User>();
  if(!current||!verifiedInvestor(current)) throw new RoundCallError('verified_investor_required',403);
}
async function founderActor(env: Env, actor: User, projectId: number) {
  enabled(env);
  const project=await projectFacts(env,projectId);
  const current=await env.DB.prepare('SELECT role,founder_id,spinout_lab_active,is_active FROM users WHERE id=?').bind(actor.id).first<User>();
  if(!current||Number(current.is_active)!==1||(current.role!=='founder'&&!(current.role==='exploring'&&Number(current.spinout_lab_active)===1))
    ||current.founder_id==null||current.founder_id!==project.founder_id) throw new RoundCallError('project_not_found',404);
}
async function counselActor(env: Env, actor: User, projectId: number) {
  enabled(env);
  const recorder=await env.DB.prepare("SELECT u.id FROM users u JOIN super_admins s ON s.user_id=u.id WHERE u.id=? AND u.role='admin' AND u.is_active=1 AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND (p.founder_id=u.founder_id OR EXISTS(SELECT 1 FROM user_company_links l WHERE l.user_id=u.id AND l.company_id=p.company_id)))").bind(actor.id,projectId).first();
  if(!recorder) throw new RoundCallError('independent_counsel_recorder_required',403);
}
async function currentDeck(env: Env, call: CallRow) {
  if(call.deck_id==null) { if(call.deck_content_hash!=null) throw new RoundCallError('approved_deck_changed',409); return null; }
  const deck=await env.DB.prepare('SELECT version,title,slides FROM pitch_decks WHERE id=? AND version=? AND project_id=?').bind(call.deck_id,call.deck_version,call.project_id).first<{version:number;title:string;slides:string}>();
  if(!deck||await deckContentHash(deck.slides)!==call.deck_content_hash) throw new RoundCallError('approved_deck_changed',409);
  return deck;
}
export async function loadCall(env: Env, uid: string): Promise<CallRow> {
  enabled(env);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(uid)) throw new RoundCallError('call_not_found', 404);
  const row = await env.DB.prepare('SELECT * FROM round_calls WHERE uid = ?').bind(uid).first<CallRow>();
  if (!row) throw new RoundCallError('call_not_found', 404);
  return row;
}
export async function projectFacts(env: Env, id: number): Promise<ProjectFacts> {
  enabled(env);
  const row = await env.DB.prepare('SELECT id, uid, name, founder_id, company_id, sector, stage, description, problem_statement, solution, use_of_funds, traction_summary, revenue, mrr, users_count FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<ProjectFacts>();
  if (!row) throw new RoundCallError('project_not_found', 404);
  return row;
}
export async function roundContext(env: Env, project: ProjectFacts, ownerId: number) {
  await founderActor(env,{id:ownerId} as User,project.id);
  const round = await env.DB.prepare("SELECT id, uid, name, target_amount, close_date, notes, pre_money FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(project.id).first();
  const decks = await env.DB.prepare(`SELECT id, version, title, is_current, created_at,
    CASE WHEN json_valid(slides) AND json_type(slides) = 'array' THEN json_array_length(slides) END AS slide_count FROM pitch_decks WHERE project_id = ? ORDER BY version DESC, id DESC`).bind(project.id).all();
  const scenario = await env.DB.prepare('SELECT uid, name, inputs_json, result_json, computed_at FROM cap_table_scenarios WHERE project_id = ? AND owner_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').bind(project.id, ownerId).first();
  const room = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM data_room_files WHERE project_id = ?) + (SELECT COUNT(*) FROM data_room_folders WHERE project_id = ?) AS count').bind(project.id, project.id).first<{ count: number }>();
  const chosen = await env.DB.prepare("SELECT p.id AS prospect_id, u.name, u.email FROM raise_prospects p JOIN users u ON LOWER(u.email) = LOWER(p.email) WHERE p.project_id = ? AND u.role = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved' ORDER BY u.name, p.id").bind(project.id).all();
  const issuance = await env.DB.prepare('SELECT valuation_cap_cents FROM safe_issuances WHERE project_id = ? ORDER BY id DESC LIMIT 1').bind(project.id).first<{ valuation_cap_cents: number }>();
  return { project, round, scenario, term_seeds: keyTermSeeds(round, issuance, scenario), decks: decks.results || [], chosen: chosen.results || [],
    data_room: room && room.count > 0 ? { project_uid: project.uid } : null };
}

/** Recorded dollar values become whole cents; missing/invalid values remain absent. */
function dollarCents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const cents = Math.round(Number(value) * 100);
  return positiveCents(cents) ? cents : null;
}
/** Per-instrument provenance: recorded terms win over the member's scenario. */
export function keyTermSeeds(round: any, issuance: any, scenario: any) {
  let inputs: any = {};
  try { inputs = JSON.parse(scenario?.inputs_json || '{}'); } catch { /* No readable scenario seed. */ }
  const safe = Array.isArray(inputs?.safes) ? inputs.safes.at(-1) : null;
  const note = Array.isArray(inputs?.safes) ? inputs.safes.filter((s: any) => s?.instrument === 'note').at(-1) ?? safe : null;
  const equity = Array.isArray(inputs?.rounds) ? inputs.rounds.at(-1) : null;
  const recordedCap = positiveCents(issuance?.valuation_cap_cents) ? issuance.valuation_cap_cents : null;
  const recordedPre = dollarCents(round?.pre_money);
  const scenarioCap = dollarCents(safe?.cap), scenarioPre = dollarCents(equity?.pre_money);
  const noteCap = dollarCents(note?.cap);
  const fraction = Number(note?.discount);
  const bps = Number.isFinite(fraction) && fraction > 0 && fraction <= .9 ? Math.round(fraction * 10000) : null;
  return {
    safe: { valuation_cap_cents: recordedCap ?? scenarioCap, discount_bps: null, pre_money_cents: null,
      source: recordedCap != null ? 'safe_issuance' : scenarioCap != null ? 'scenario' : null },
    equity: { valuation_cap_cents: null, discount_bps: null, pre_money_cents: recordedPre ?? scenarioPre,
      source: recordedPre != null ? 'raise_round' : scenarioPre != null ? 'scenario' : null },
    convertible_note: { valuation_cap_cents: noteCap, discount_bps: bps, pre_money_cents: null,
      source: noteCap != null || bps != null ? 'scenario' : null },
  };
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
  const cap = input.valuation_cap_cents ?? null, discount = input.discount_bps ?? null, preMoney = input.pre_money_cents ?? null;
  if (cap != null && input.instrument === 'equity') throw new RoundCallError('cap_not_in_form',400,'Equity has no valuation cap. Give the pre-money valuation.');
  if (discount != null && input.instrument !== 'convertible_note') throw new RoundCallError('discount_not_in_form',400,
    input.instrument === 'safe' ? 'A SAFE on Axal has a valuation cap and no discount (D578).' : 'A discount belongs to a convertible note.');
  if (preMoney != null && input.instrument !== 'equity') throw new RoundCallError('pre_money_not_in_form',400,'Pre-money valuation belongs to an equity round.');
  if ((cap != null && !positiveCents(cap)) || (preMoney != null && !positiveCents(preMoney))
    || (discount != null && (!Number.isSafeInteger(discount) || Number(discount) < 1 || Number(discount) > 9000))) throw new RoundCallError('invalid_call_fields');
  let deckId: number | null = null, deckVersion: number | null = null, deckHash: string | null = null;
  if (input.deck_id != null) {
    if (!Number.isSafeInteger(input.deck_id)) throw new RoundCallError('invalid_deck');
    const deck = await env.DB.prepare('SELECT id, version, slides FROM pitch_decks WHERE id = ? AND project_id = ?').bind(input.deck_id, project.id).first<{ id: number; version: number; slides: string }>();
    if (!deck) throw new RoundCallError('deck_not_found', 404);
    if (input.deck_version != null && input.deck_version !== deck.version) throw new RoundCallError('deck_version_changed', 409);
    deckId = deck.id; deckVersion = deck.version; deckHash = await deckContentHash(deck.slides);
  }
  let roomUid: string | null = null;
  if (input.data_room_project_uid != null) {
    if (input.data_room_project_uid !== project.uid) throw new RoundCallError('invalid_data_room');
    const room = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM data_room_files WHERE project_id = ?) + (SELECT COUNT(*) FROM data_room_folders WHERE project_id = ?) AS count').bind(project.id, project.id).first<{ count: number }>();
    if (!room || room.count === 0) throw new RoundCallError('data_room_not_recorded', 409);
    roomUid = project.uid;
  }
  return { name, terms, amount_cents: input.amount_cents, minimum_cheque_cents: input.minimum_cheque_cents,
    instrument: String(input.instrument), target_close: input.target_close, deck_id: deckId, deck_version: deckVersion, deck_content_hash: deckHash,
    data_room_project_uid: roomUid, stage: project.stage, sector: project.sector,
    valuation_cap_cents: cap as number | null, discount_bps: discount as number | null, pre_money_cents: preMoney as number | null };
}
async function audit(env: Env, actor: User, projectId: number, action: string, details: Record<string, unknown>) {
  return env.DB.prepare('INSERT INTO activity_logs(action, details, actor, user_id, project_id) VALUES(?,?,?,?,?)')
    .bind(action, JSON.stringify(details), await hashEmail(actor.email), actor.id, projectId);
}
export async function saveDraft(env: Env, project: ProjectFacts, actor: User, input: Record<string, unknown>, existing?: CallRow) {
  await founderActor(env,actor,project.id);
  if(existing&&existing.project_id!==project.id) throw new RoundCallError('project_not_found',404);
  if (existing && existing.state !== 'draft') throw new RoundCallError('call_read_only', 409);
  const t = await normalizeTerms(env, project, input);
  const hash = await termsHash(t), at = now(), uid = existing?.uid || crypto.randomUUID();
  if (existing && hash === existing.terms_hash) return existing;
  const round = await env.DB.prepare("SELECT id FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(project.id).first<{ id: number }>();
  const statement = existing
    ? env.DB.prepare("UPDATE round_calls SET name=?, amount_cents=?, instrument=?, terms=?, minimum_cheque_cents=?, target_close=?, deck_id=?, deck_version=?, deck_content_hash=?, data_room_project_uid=?, stage=?, sector=?, valuation_cap_cents=?, discount_bps=?, pre_money_cents=?, terms_hash=?, counsel_approved_hash=NULL, counsel_approval_reference=NULL, counsel_approved_by=NULL, counsel_approved_at=NULL, updated_at=?,revision=revision+1 WHERE uid=? AND project_id=? AND state='draft' AND revision=?")
      .bind(t.name,t.amount_cents,t.instrument,t.terms,t.minimum_cheque_cents,t.target_close,t.deck_id,t.deck_version,t.deck_content_hash,t.data_room_project_uid,t.stage,t.sector,t.valuation_cap_cents,t.discount_bps,t.pre_money_cents,hash,at,uid,project.id,existing.revision)
    : env.DB.prepare('INSERT INTO round_calls(uid,project_id,company_id,round_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,deck_version,deck_content_hash,data_room_project_uid,stage,sector,valuation_cap_cents,discount_bps,pre_money_cents,terms_hash,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(uid,project.id,project.company_id,round?.id ?? null,t.name,t.amount_cents,t.instrument,t.terms,t.minimum_cheque_cents,t.target_close,t.deck_id,t.deck_version,t.deck_content_hash,t.data_room_project_uid,t.stage,t.sector,t.valuation_cap_cents,t.discount_bps,t.pre_money_cents,hash,actor.id,at,at);
  const result = await env.DB.batch([statement, await audit(env,actor,project.id,'round_call_draft_requested',{uid,terms_hash:hash})]);
  if (Number(result[0]?.meta?.changes) !== 1) throw new RoundCallError('draft_changed',409);
  return loadCall(env,uid);
}
export async function audience(env: Env, call: CallRow, chosenIds: unknown, includeMatches: unknown) {
  if (!Array.isArray(chosenIds) || chosenIds.length > 100 || chosenIds.some(id => !Number.isSafeInteger(id) || id <= 0)
    || typeof includeMatches !== 'boolean') throw new RoundCallError('invalid_audience');
  const selected = new Set(chosenIds as number[]);
  const chosen = await env.DB.prepare("SELECT p.id AS prospect_id, u.id AS investor_user_id FROM raise_prospects p JOIN users u ON LOWER(u.email)=LOWER(p.email) WHERE p.project_id=? AND u.role='investor' AND u.is_active=1 AND u.kyc_status='approved'").bind(call.project_id).all<{ prospect_id: number; investor_user_id: number }>();
  const rows = new Map<number, { investor_user_id: number; origin: string; reasons: string[]; ticket_min_usd?: number | null; ticket_max_usd?: number | null }>();
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
      if (reasons.length && !rows.has(profile.user_id)) rows.set(profile.user_id,{investor_user_id:profile.user_id,origin:'match',reasons,ticket_min_usd:profile.ticket_min_usd,ticket_max_usd:profile.ticket_max_usd});
    }
  }
  if (rows.size > 500) throw new RoundCallError('audience_too_large',422);
  return [...rows.values()];
}
export function audienceSummary(rows: Array<{ origin: string; reasons: string[] }>) {
  return { chosen: rows.filter(r => r.origin === 'chosen').length, matched: rows.filter(r => r.origin === 'match').length,
    match_reasons: [...new Set(rows.filter(r => r.origin === 'match').flatMap(r => r.reasons))] };
}
export function audiencePreview(call: CallRow, rows: Awaited<ReturnType<typeof audience>>) {
  const matches = rows.filter(r => r.origin === 'match');
  const mins = matches.map(r => r.ticket_min_usd).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const maxs = matches.map(r => r.ticket_max_usd).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return { ...audienceSummary(rows), stage: call.stage, sector: call.sector,
    cheque_min_usd: matches.length >= 2 && mins.length === matches.length ? Math.floor(Math.min(...mins)) : null,
    cheque_max_usd: matches.length >= 2 && maxs.length === matches.length ? Math.ceil(Math.max(...maxs)) : null,
    reason: !call.sector?.trim() ? 'sector_not_recorded' : !call.stage?.trim() ? 'stage_not_recorded' : null };
}
export async function saveAudience(env: Env, call: CallRow, actor: User, input: Record<string, unknown>) {
  await founderActor(env,actor,call.project_id);
  if (call.state !== 'draft') throw new RoundCallError('call_read_only',409);
  const rows = await audience(env,call,input.chosen_prospect_ids,input.include_matches), at = now();
  const summary = audienceSummary(rows);
  const stored = await env.DB.prepare('SELECT investor_user_id, origin FROM round_call_recipients WHERE call_id = ?').bind(call.id).all<{ investor_user_id: number; origin: string }>();
  const key = (r: { investor_user_id: number; origin: string }) => r.investor_user_id + ':' + r.origin;
  const oldSet = new Set((stored.results || []).map(key));
  if (oldSet.size === rows.length && rows.every(row => oldSet.has(key(row)))) return summary;
  const statements = [
    env.DB.prepare("DELETE FROM round_call_recipients WHERE call_id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND project_id=? AND state='draft' AND revision=?)").bind(call.id,call.id,call.project_id,call.revision),
    ...rows.map(row => env.DB.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,match_reasons_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM round_calls WHERE id=? AND project_id=? AND state='draft' AND revision=?)")
      .bind(call.id,row.investor_user_id,row.origin,JSON.stringify(row.reasons),call.id,call.project_id,call.revision)),
    env.DB.prepare("UPDATE round_calls SET counsel_approved_hash=NULL,counsel_approved_by=NULL,counsel_approved_at=NULL,counsel_approval_reference=NULL,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND state='draft' AND revision=?").bind(at,call.id,call.project_id,call.revision),
    await audit(env,actor,call.project_id,'round_call_audience_requested',{uid:call.uid,chosen:rows.filter(r=>r.origin==='chosen').length,matched:rows.filter(r=>r.origin==='match').length}),
  ];
  const result = await env.DB.batch(statements);
  if (Number(result[result.length-2]?.meta?.changes) !== 1) throw new RoundCallError('call_read_only',409);
  return summary;
}
export async function founderPage(env: Env, call: CallRow, actor: User) {
  if(actor.role==='admin') await counselActor(env,actor,call.project_id); else await founderActor(env,actor,call.project_id);
  const rows = await env.DB.prepare('SELECT r.investor_user_id,r.origin,r.match_reasons_json,r.opened_at,r.data_room_requested_at,r.commitment_cents,r.committed_at,r.responded_at,r.last_response_at,r.delivery_state,u.name,u.email FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=? ORDER BY r.id').bind(call.id).all<Recipient>();
  const questions = await env.DB.prepare('SELECT q.uid,q.question,q.answer,q.asked_at,q.answered_at,u.name,u.email FROM round_call_questions q JOIN users u ON u.id=q.investor_user_id WHERE q.call_id=? ORDER BY q.asked_at,q.id').bind(call.id).all();
  const external = await env.DB.prepare("SELECT 'update-'||r.uid AS uid,r.message AS question,r.name,r.created_at AS asked_at,u.uid AS update_uid FROM update_ask_replies r JOIN update_asks a ON a.id=r.ask_id JOIN portfolio_updates u ON u.id=a.update_id WHERE a.kind='capital' AND a.link_ref=? AND u.project_id=? AND COALESCE(r.landed_module,'')<>'round_call' ORDER BY r.id").bind(call.uid,call.project_id).all();
  const recipients = (rows.results || []).map(founderRecipient);
  return { call, viewer: 'founder', read_only: call.state==='closed' || call.state==='awaiting_counsel' || (call.state==='sent' && call.target_close<today()),
    recipients, questions:[...(questions.results || []),...(external.results || [])], counsel_approved:counselApproved(call),
    readiness:readiness(call,await projectFacts(env,call.project_id)),
    progress:{ received:recipients.length,opened:recipients.filter(r=>r.opened_at).length,
      data_room_requests:recipients.filter(r=>r.data_room_requested_at).length,
      commitments:recipients.filter(r=>r.commitment_cents != null).length,
      committed_cents:recipients.reduce((sum,r)=>sum+(r.commitment_cents||0),0),target_cents:call.amount_cents } };
}
export async function sendCall(env: Env, call: CallRow, actor: User, acknowledgeMissing: unknown) {
  await founderActor(env,actor,call.project_id);
  const deck=await currentDeck(env,call);
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
    env.DB.prepare("UPDATE round_calls SET state='sent',sent_at=?,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND state='draft' AND terms_hash=? AND revision=? AND counsel_approved_hash=terms_hash AND counsel_approved_by IS NOT NULL AND counsel_approved_at IS NOT NULL AND counsel_approval_reference IS NOT NULL AND target_close>=? AND deck_id IS ? AND deck_version IS ? AND deck_content_hash IS ? AND (deck_id IS NULL OR EXISTS(SELECT 1 FROM pitch_decks d WHERE d.id=round_calls.deck_id AND d.version=round_calls.deck_version AND d.project_id=round_calls.project_id AND d.slides=?)) AND NOT EXISTS(SELECT 1 FROM round_call_recipients r JOIN users u ON u.id=r.investor_user_id WHERE r.call_id=round_calls.id AND (u.role<>'investor' OR u.is_active<>1 OR u.kyc_status IS NULL OR u.kyc_status<>'approved'))").bind(at,at,call.id,call.project_id,call.terms_hash,call.revision,today(),call.deck_id,call.deck_version,call.deck_content_hash ?? null,deck?.slides ?? null),
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
  await verifiedReader(env,investor);
  if(call.state==='draft') throw new RoundCallError('call_not_found',404);
  const recipient=await env.DB.prepare('SELECT id,commitment_cents,data_room_requested_at FROM round_call_recipients WHERE call_id=? AND investor_user_id=?').bind(call.id,investor.id).first<{id:number;commitment_cents:number|null;data_room_requested_at:string|null}>();
  if(!recipient) throw new RoundCallError('call_not_found',404);
  await env.DB.prepare("UPDATE round_call_recipients SET opened_at=COALESCE(opened_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='sent' AND target_close>=?)").bind(now(),recipient.id,call.id,today()).run();
  let deck: Awaited<ReturnType<typeof currentDeck>> | {unreadable:true};
  try { deck=await currentDeck(env,call); } catch(e) { if(!(e instanceof RoundCallError)||e.code!=='approved_deck_changed')throw e; deck={unreadable:true}; }
  const active=call.data_room_project_uid!=null?await activeGrant(env,call.project_id,investor.id):null;
  const nda=call.data_room_project_uid!=null && await ndaActive(env,active?.granted_by_user_id ?? call.created_by,investor.id);
  const grant=nda?active:null;
  const questions=await env.DB.prepare('SELECT uid,question,answer,asked_at,answered_at FROM round_call_questions WHERE call_id=? AND investor_user_id=? ORDER BY asked_at,id').bind(call.id,investor.id).all();
  return { viewer:'investor',call:{uid:call.uid,name:call.name,amount_cents:call.amount_cents,instrument:call.instrument,
      terms:call.terms,minimum_cheque_cents:call.minimum_cheque_cents,target_close:call.target_close,
      valuation_cap_cents:call.valuation_cap_cents ?? null,discount_bps:call.discount_bps ?? null,pre_money_cents:call.pre_money_cents ?? null,
      deck_version:call.deck_version,state:call.state,sent_at:call.sent_at},
    deck,recipient:{commitment_cents:recipient.commitment_cents,data_room_requested_at:recipient.data_room_requested_at},questions:questions.results||[],read_only:!writableCall(call,today()) || !!deck && 'unreadable' in deck,
    data_room:{recorded:call.data_room_project_uid!=null,nda_signed:!!nda,has_grant:!!grant,
      path:grant?'/research/diligence/'+encodeURIComponent(grant.uid):null} };
}
export async function respond(env: Env, call: CallRow, investor: User, input: Record<string, unknown>, extraStatements: (claim: string) => D1PreparedStatement[] = () => []) {
  await verifiedReader(env,investor);
  const deck=await currentDeck(env,call);
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
    const grant=await activeGrant(env,call.project_id,investor.id);
    if(!await ndaActive(env,grant?.granted_by_user_id ?? call.created_by,investor.id)) throw new RoundCallError('nda_required',409);
  }
  const at=now(),claim=crypto.randomUUID();
  const statements=[
    env.DB.prepare("UPDATE round_call_recipients SET responded_at=COALESCE(responded_at,?),last_response_at=?,response_claim=?,commitment_cents=CASE WHEN ?='commit' THEN ? ELSE commitment_cents END,committed_at=CASE WHEN ?='commit' THEN ? ELSE committed_at END,data_room_requested_at=CASE WHEN ?='data_room' THEN COALESCE(data_room_requested_at,?) ELSE data_room_requested_at END WHERE id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND state='sent' AND target_close>=? AND deck_id IS ? AND deck_version IS ? AND deck_content_hash IS ? AND (deck_id IS NULL OR EXISTS(SELECT 1 FROM pitch_decks d WHERE d.id=round_calls.deck_id AND d.version=round_calls.deck_version AND d.project_id=round_calls.project_id AND d.slides=?))) AND EXISTS(SELECT 1 FROM users WHERE id=? AND role='investor' AND is_active=1 AND kyc_status='approved')").bind(at,at,claim,action,cents,action,at,action,at,recipient.id,call.id,today(),call.deck_id,call.deck_version,call.deck_content_hash ?? null,deck?.slides ?? null,investor.id),
    ...roundCallPipelineStatements(env,{callId:call.id,projectId:call.project_id,investorId:investor.id,name:investor.name,email:investor.email,at,claim,commitmentCents:cents}),
  ];
  if(question) statements.push(env.DB.prepare("INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,asked_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM round_call_recipients r JOIN round_calls c ON c.id=r.call_id WHERE r.id=? AND r.response_claim=? AND c.state='sent' AND c.target_close>=?)").bind(crypto.randomUUID(),call.id,investor.id,question,at,recipient.id,claim,today()));
  statements.push(...extraStatements(claim));
  statements.push(await responseAudit(env,investor,call,action,claim));
  const result=await env.DB.batch(statements);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_read_only_or_verification_changed',409);
  return {ok:true,pipeline_recorded:true};
}
async function responseAudit(env: Env, actor: User, call: CallRow, action: unknown, claim: string) {
  return env.DB.prepare("INSERT INTO activity_logs(action,details,actor,user_id,project_id) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM round_call_recipients WHERE call_id=? AND investor_user_id=? AND response_claim=?)")
    .bind('round_call_response_requested',JSON.stringify({uid:call.uid,action}),await hashEmail(actor.email),actor.id,call.project_id,call.id,actor.id,claim);
}

/** The same live founder/company independence test used by counselActor. */
async function notifyCounselRequest(env: Env, call: CallRow) {
  try {
    const readers = await env.DB.prepare("SELECT u.id FROM users u JOIN super_admins s ON s.user_id=u.id WHERE u.role='admin' AND u.is_active=1 AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND (p.founder_id=u.founder_id OR EXISTS(SELECT 1 FROM user_company_links l WHERE l.user_id=u.id AND l.company_id=p.company_id)))")
      .bind(call.project_id).all<{ id: number }>();
    for (const reader of readers.results || []) {
      try {
        await notify(env,{userId:Number(reader.id),type:'round_call_counsel_requested',category:'deals',channels:['in_app'],
          title:'Counsel review requested',body:'A private round call needs an independent counsel review.',
          link:'/round-calls/'+call.uid,payload:{call_uid:call.uid,terms_hash:call.terms_hash,revision:call.revision}});
      } catch { /* The HQ queue is authoritative even if a notice fails. */ }
    }
  } catch { /* Already recorded: no notification failure can undo the request. */ }
}

/** Idempotent per current fingerprint, with an optimistic revision and audited winner only. */
export async function requestCounsel(env: Env, call: CallRow, actor: User, expectedRevision: unknown) {
  await founderActor(env,actor,call.project_id);
  if (!['draft','awaiting_counsel'].includes(call.state)) throw new RoundCallError('call_read_only',409);
  if (expectedRevision !== call.revision) throw new RoundCallError('call_changed',409);
  const at = now();
  const record = env.DB.prepare("UPDATE round_calls SET counsel_requested_at=?,counsel_requested_by=?,counsel_requested_hash=terms_hash WHERE uid=? AND state IN ('draft','awaiting_counsel') AND counsel_requested_hash IS NOT terms_hash AND revision=?")
    .bind(at,actor.id,call.uid,expectedRevision);
  // changes() refers to the immediately preceding UPDATE in this atomic D1
  // batch, so concurrent duplicates or stale revisions cannot add an audit.
  const auditRecord = env.DB.prepare('INSERT INTO activity_logs(action,details,actor,user_id,project_id) SELECT ?,?,?,?,? WHERE changes()=1')
    .bind('round_call_counsel_requested',JSON.stringify({uid:call.uid,terms_hash:call.terms_hash}),await hashEmail(actor.email),actor.id,call.project_id);
  const result = await env.DB.batch([record,auditRecord]);
  const current = await loadCall(env,call.uid);
  if (Number(result[0]?.meta?.changes) !== 1) {
    if (!['draft','awaiting_counsel'].includes(current.state)) throw new RoundCallError('call_read_only',409);
    if (current.revision !== expectedRevision || current.terms_hash !== call.terms_hash) throw new RoundCallError('call_changed',409);
    if (current.counsel_requested_hash !== current.terms_hash) throw new RoundCallError('call_changed',409);
    return {ok:true,uid:current.uid,duplicate:true,counsel_requested_at:current.counsel_requested_at};
  }
  await notifyCounselRequest(env,current);
  return {ok:true,uid:current.uid,duplicate:false,counsel_requested_at:current.counsel_requested_at};
}

/** HQ only at the route; live Super Admin status and independence remain enforced here too. */
export async function counselQueue(env: Env, actor: User) {
  enabled(env);
  const reader = await env.DB.prepare("SELECT u.id FROM users u JOIN super_admins s ON s.user_id=u.id WHERE u.id=? AND u.role='admin' AND u.is_active=1").bind(actor.id).first();
  if (!reader) throw new RoundCallError('independent_counsel_recorder_required',403);
  const rows = await env.DB.prepare(
    `SELECT c.uid,c.name,p.name AS project_name,c.instrument,c.state,c.terms_hash,c.revision,c.counsel_requested_at
       FROM round_calls c JOIN projects p ON p.id=c.project_id JOIN users u ON u.id=?
      WHERE c.state IN ('draft','awaiting_counsel') AND c.counsel_requested_hash=c.terms_hash
        AND NOT COALESCE(c.counsel_approved_hash=c.terms_hash AND c.counsel_approved_by IS NOT NULL
          AND c.counsel_approved_at IS NOT NULL AND c.counsel_approval_reference IS NOT NULL,0)
        AND NOT COALESCE(p.founder_id=u.founder_id,0)
        AND NOT EXISTS(SELECT 1 FROM user_company_links l WHERE l.user_id=u.id AND l.company_id=p.company_id)
      ORDER BY c.counsel_requested_at,c.id`,
  ).bind(actor.id).all();
  return {items:rows.results || []};
}

export async function recordCounsel(env:Env,call:CallRow,actor:User,reference:unknown,expectedHash:unknown,expectedRevision:unknown) {
  await counselActor(env,actor,call.project_id);
  const deck=await currentDeck(env,call);
  if(!['draft','awaiting_counsel'].includes(call.state)) throw new RoundCallError('call_read_only',409);
  if(expectedHash!==call.terms_hash||expectedRevision!==call.revision) throw new RoundCallError('terms_changed',409);
  const ref=text(reference,2000);
  if(ref.length<10) throw new RoundCallError('counsel_reference_required');
  const at=now();
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE round_calls SET state=CASE WHEN state='awaiting_counsel' THEN 'sent' ELSE state END,counsel_approved_hash=terms_hash,counsel_approved_by=?,counsel_approved_at=?,counsel_approval_reference=?,updated_at=? WHERE id=? AND project_id=? AND state IN ('draft','awaiting_counsel') AND terms_hash=? AND revision=? AND deck_id IS ? AND deck_version IS ? AND deck_content_hash IS ? AND (deck_id IS NULL OR EXISTS(SELECT 1 FROM pitch_decks d WHERE d.id=round_calls.deck_id AND d.version=round_calls.deck_version AND d.project_id=round_calls.project_id AND d.slides=?)) AND EXISTS(SELECT 1 FROM users u JOIN super_admins s ON s.user_id=u.id WHERE u.id=? AND u.role='admin' AND u.is_active=1)").bind(actor.id,at,ref,at,call.id,call.project_id,call.terms_hash,call.revision,call.deck_id,call.deck_version,call.deck_content_hash ?? null,deck?.slides ?? null,actor.id),
    await audit(env,actor,call.project_id,'round_call_counsel_record_requested',{uid:call.uid,terms_hash:call.terms_hash,reference:ref}),
  ]);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('terms_changed',409);
  try {
    await notify(env,{userId:call.created_by,type:'round_call_counsel_approved',category:'deals',channels:['in_app'],
      title:'Round call approved by counsel',
      body:call.state==='awaiting_counsel'?'Counsel approved the updated terms. Your call has resumed.':'Counsel approved the terms. Your round call is ready for the send step.',
      link:'/raise/calls/'+call.uid});
  } catch { /* An approval already recorded must survive a notice failure. */ }
  return {ok:true,terms_hash:call.terms_hash};
}
export async function manageCall(env:Env,call:CallRow,actor:User,input:Record<string,unknown>) {
  await founderActor(env,actor,call.project_id);
  if(call.state!=='sent'&&!(call.state==='awaiting_counsel'&&input.action==='close')) throw new RoundCallError('call_read_only',409);
  const at=now();
  if(input.action==='close') {
    const result=await env.DB.batch([env.DB.prepare("UPDATE round_calls SET state='closed',closed_at=?,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND state IN ('sent','awaiting_counsel') AND revision=?").bind(at,at,call.id,call.project_id,call.revision),
      await audit(env,actor,call.project_id,'round_call_close_requested',{uid:call.uid})]);
    if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_changed',409);
  } else if(input.action==='extend') {
    if(!validClose(input.target_close)||input.target_close<=call.target_close||input.target_close<today()) throw new RoundCallError('invalid_extension');
    const hash=await termsHash({...call,target_close:input.target_close});
    const result=await env.DB.batch([env.DB.prepare("UPDATE round_calls SET state='awaiting_counsel',target_close=?,terms_hash=?,counsel_requested_at=?,counsel_requested_by=?,counsel_requested_hash=?,counsel_approved_hash=NULL,counsel_approved_by=NULL,counsel_approved_at=NULL,counsel_approval_reference=NULL,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND state='sent' AND revision=?").bind(input.target_close,hash,at,actor.id,hash,at,call.id,call.project_id,call.revision),
      await audit(env,actor,call.project_id,'round_call_extend_requested',{uid:call.uid,target_close:input.target_close})]);
    if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('call_changed',409);
    await notifyCounselRequest(env,{...call,target_close:input.target_close,terms_hash:hash,revision:call.revision+1});
  } else throw new RoundCallError('invalid_action');
  return loadCall(env,call.uid);
}
export async function answerQuestion(env:Env,call:CallRow,actor:User,questionUid:string,value:unknown) {
  await founderActor(env,actor,call.project_id);
  if(!writableCall(call,today())) throw new RoundCallError('call_read_only',409);
  const answer=text(value,4000),at=now();
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE round_call_questions SET answer=?,answered_at=?,answered_by=? WHERE uid=? AND call_id=? AND EXISTS(SELECT 1 FROM round_calls WHERE id=? AND project_id=? AND state='sent' AND target_close>=?)").bind(answer,at,actor.id,questionUid,call.id,call.id,call.project_id,today()),
    await audit(env,actor,call.project_id,'round_call_answer_requested',{uid:call.uid,question_uid:questionUid}),
  ]);
  if(Number(result[0]?.meta?.changes)!==1) throw new RoundCallError('question_unavailable',409);
  return {ok:true};
}

/** D653/B1: only a currently open call belonging to this venture can be linked. */
export async function openCallForUpdate(env: Env, projectId: number): Promise<string|null> {
  if(!roundCallsEnabled(env)) return null;
  const row=await env.DB.prepare("SELECT uid FROM round_calls WHERE project_id=? AND state='sent' AND target_close>=? ORDER BY sent_at DESC,id DESC LIMIT 1").bind(projectId,today()).first<{uid:string}>();
  return row?.uid ?? null;
}
/** The update does not grant access. Network recipients receive capital text only. */
export async function updateAskLinks(env:Env,asks:any[],user:User,author:boolean,audienceName?:string) {
  return Promise.all(asks.map(async ask=>{
    if(ask.kind!=='capital')return ask;
    if(!roundCallsEnabled(env))return {...ask,link_ref:null,link_reason:'Coming soon. Round calls are not enabled.'};
    if(!ask.link_ref)return {...ask,link_ref:null,link_reason:'No open round call is linked to this ask.'};
    if(audienceName==='network')return {...ask,link_ref:null};
    const row=await env.DB.prepare("SELECT c.uid FROM round_calls c JOIN projects p ON p.id=c.project_id WHERE c.uid=? AND c.state='sent' AND c.target_close>=? AND ((?=1 AND p.founder_id=?) OR (?=1 AND EXISTS(SELECT 1 FROM round_call_recipients r WHERE r.call_id=c.id AND r.investor_user_id=?)))")
      .bind(ask.link_ref,today(),author?1:0,user.founder_id ?? null,verifiedInvestor(user)?1:0,user.id).first<{uid:string}>();
    return {...ask,link_ref:row?.uid ?? null};
  }));
}
/** The source update reply and the actual call response/pipeline share one D1 batch. */
export async function replyToLinkedCall(env:Env,ask:any,user:User,message:string,replyUid:string):Promise<boolean> {
  if(ask.kind!=='capital'||!ask.link_ref||!roundCallsEnabled(env)||!verifiedInvestor(user))return false;
  const row=await env.DB.prepare("SELECT c.* FROM round_calls c JOIN round_call_recipients r ON r.call_id=c.id WHERE c.uid=? AND c.project_id=? AND c.state='sent' AND c.target_close>=? AND r.investor_user_id=?")
    .bind(ask.link_ref,ask.project_id,today(),user.id).first<CallRow>();
  if(!row)return false;
  if(message.length>2000)throw new RoundCallError('question_too_long',400);
  const source=(claim:string)=>env.DB.prepare("INSERT INTO update_ask_replies(uid,ask_id,replier_user_id,name,email,message,landed_module,landed_ref) SELECT ?,?,?,?,?,?,'round_call',? WHERE EXISTS(SELECT 1 FROM round_call_recipients r JOIN round_calls c ON c.id=r.call_id JOIN users u ON u.id=r.investor_user_id WHERE c.id=? AND r.investor_user_id=? AND r.response_claim=? AND c.state='sent' AND c.target_close>=? AND u.role='investor' AND u.is_active=1 AND u.kyc_status='approved')")
    .bind(replyUid,ask.id,user.id,user.name,user.email,message,row.uid,row.id,user.id,claim,today());
  await respond(env,row,user,{action:'question',question:message},claim=>[source(claim)]);
  return true;
}
