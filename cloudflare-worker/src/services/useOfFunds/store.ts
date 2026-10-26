/** D1176: scoped, bound scenario writes. Each change and its audit commit together. */
import type { Env, User } from '../../types';
import { copyLegacyBase, SECTION_LABELS, UofStoreError } from './legacy';
import { plan, SECTION_KEYS, type PlanInputs, type SectionKey, type Source } from './plan';

export type Scope = { projectId: number; user: User; founderUserId: number; readOnly?: boolean };
export class PlanError extends Error {
  status:number; code:string; sentence:string;
  recovery?: {method:'PUT';route:string};
  constructor(status: number, code: string, sentence: string) { super(sentence); this.status=status;this.code=code;this.sentence=sentence; }
}
export const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (v: object, k: string) => Object.hasOwn(v, k);
const bad = () => new PlanError(400, 'invalid_plan', 'Check the plan fields. Nothing was saved.');
export const idOf = (v: unknown): number => {
  if (!/^[1-9][0-9]{0,9}$/.test(String(v ?? ''))) throw new PlanError(404, 'not_found', 'Record not found.');
  return Number(v);
};
export const json = (raw: string | null, fallback: any = null): any => {
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch { throw new PlanError(503, 'unreadable', 'Stored plan data is Unreadable. Try again.'); }
};
const text = (v: unknown, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad();
  return v.trim();
};
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw bad();
  return v;
};
const month = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(v)) throw bad();
  return v;
};
const due = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12][0-9]|3[01]))?$/.test(v)) throw bad();
  if (v.length === 10 && new Date(v).toISOString().slice(0, 10) !== v) throw bad();
  return v;
};
const key = (v: unknown): SectionKey | null => {
  if (v === null) return null;
  if (!SECTION_KEYS.includes(v as SectionKey)) throw bad();
  return v as SectionKey;
};
const currency = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-zA-Z]{3}$/.test(v)) throw bad();
  return v.toLowerCase();
};
// Human-only routes never accept AI or connector provenance supplied by a client.
export function fields(b: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(b).some(k => !allowed.includes(k))) throw bad();
}
/** Conditional audit shares the mutation's Base-state guard inside its transaction. */
function scenarioAudit(env:Env,s:Scope,action:string,uid:string,isBase:number,entityId=uid) {
  return env.DB.prepare(`INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor)
    SELECT ?,?,'raise.use-of-funds',?,?,?,? FROM uof_scenarios WHERE uid=? AND project_id=? AND is_base=?`)
    .bind(s.projectId,s.user.id,entityId,action,`${s.user.role==='admin'?'Studio admin: ':''}${action.replace(/_/g,' ')}.`,`user:${s.user.id}`,uid,s.projectId,isBase);
}
export async function base(env: Env, s: Scope) {
  if (s.readOnly) {
    const existing=await env.DB.prepare('SELECT id FROM uof_scenarios WHERE project_id=? AND is_base=1').bind(s.projectId).first<{id:number}>();
    if (!existing) throw new PlanError(409,'plan_not_initialized','The founder must initialize this plan before a support session can read its Base.');
    return existing.id;
  }
  try { return (await copyLegacyBase(env.DB, s.projectId, s.founderUserId,uid=>scenarioAudit(env,s,'uof_scenario_created',uid,1))).scenarioId; }
  catch (e) {
    if (e instanceof UofStoreError) {
      if (e.code === 'unreadable') throw legacyRepair();
      throw new PlanError(e.code === 'not_found' ? 404 : 503, e.code, e.message);
    }
    throw e;
  }
}
function legacyRepair(conflict=false) {
  const error=new PlanError(409, conflict ? 'legacy_plan_changed' : 'legacy_plan_repair_required',
    "Review and correct this venture's saved plan fields before retrying. Existing data was kept.");
  error.recovery={method:'PUT',route:'/api/projects/:id'};
  return error;
}
async function planBatch(env:Env,statements:D1PreparedStatement[]) {
  try { return await env.DB.batch(statements); }
  catch(e) {
    // Only the fixed JSON assertion below parses JSON inside these batches.
    if(e instanceof Error && /malformed JSON/i.test(e.message)) throw legacyRepair(true);
    throw e;
  }
}
export async function scenario(env: Env, s: Scope, id: number) {
  const r = await env.DB.prepare('SELECT * FROM uof_scenarios WHERE project_id = ? AND id = ?').bind(s.projectId, id).first<any>();
  if (!r) throw new PlanError(404, 'not_found', 'Scenario not found.');
  return r;
}
export async function scenarioParts(env: Env, id: number) {
  const [lines, milestones] = await Promise.all([
    env.DB.prepare('SELECT * FROM uof_scenario_lines WHERE scenario_id = ? ORDER BY id').bind(id).all<any>(),
    env.DB.prepare('SELECT * FROM uof_milestones WHERE scenario_id = ? ORDER BY id').bind(id).all<any>(),
  ]);
  return { lines: lines.results ?? [], milestones: milestones.results ?? [] };
}
export async function hires(env: Env, s: Scope) {
  return (await env.DB.prepare('SELECT id, category_key, role, start_month, annual_cents, currency, updated_at FROM use_of_funds_hires WHERE project_id = ? ORDER BY start_month, id').bind(s.projectId).all<any>()).results ?? [];
}
const sourceOf = (label: string | null): Source => ({ typed: 'Typed', connector: 'Connector', document: 'Document', signed: 'Signed' }[label ?? ''] as Source) ?? 'Recorded';
export async function view(env: Env, s: Scope, r: any) {
  const { lines, milestones } = await scenarioParts(env, r.id);
  // Failure to read hires keeps allocations readable and model outputs explicitly missing.
  let hireRows: any[] | null = null;
  try { hireRows = await hires(env, s); } catch { /* one block stays Unreadable */ }
  const inputs: PlanInputs = {
    startMonth: r.start_month, horizonMonths: r.target_runway_months, targetMonths: r.target_runway_months, currency: r.currency,
    raiseCents: { value: r.amount_to_raise_cents, source: r.legacy_copied_at ? 'Recorded' : 'Typed' },
    cashCents: { value: r.cash_cents, source: 'Typed' }, raiseMonth: r.raise_month,
    lines: lines.map(l => ({ key: l.category_key, sharePct: { value: l.share_pct, source: sourceOf(l.source_label) } })),
    hires: hireRows?.map(h => ({ id: String(h.id), key: h.category_key, startMonth: h.start_month, annualCents: { value: h.annual_cents, source: 'Typed' }, currency: h.currency })) ?? null,
    milestones: milestones.map(m => ({ id: String(m.id), key: m.category_key, costCents: { value: m.cost_cents, source: sourceOf(m.source_label) }, dueMonth: m.due_on?.slice(0, 7) ?? null })),
  };
  return { ...r, source: inputs.raiseCents.source, lines: lines.map(l => ({ ...l, source: sourceOf(l.source_label) })),
    milestones: milestones.map(m => ({ ...m, source: sourceOf(m.source_label), cost_state: m.cost_cents === null ? 'not_costed' : 'recorded' })),
    hires: hireRows === null ? { state: 'unreadable', reason: 'Hires are Unreadable. Try again.', items: null } : { state: 'ok', items: hireRows }, model: plan(inputs) };
}

const legacyBucket = { product: 'eng', 'go-to-market': 'gtm', infrastructure: 'infra', operations: 'ops', reserve: 'hiring' };
const hasCompleteSplit=(lines:any[])=>lines.length===5&&SECTION_KEYS.every(k=>lines.some(l=>l.category_key===k&&Number.isSafeInteger(l.share_pct)&&l.share_pct>=0&&l.share_pct<=100))&&lines.reduce((sum,l)=>sum+l.share_pct,0)===100;
const incompleteBase=()=>new PlanError(409,'base_split_required','Record a complete split totalling 100% before making this scenario the Base or replacing its split.');
function recordedSplit(raw:string|null) {
  let rows:any;try { rows=json(raw); } catch { throw legacyRepair(); }
  if(rows===null) return null;
  if(!Array.isArray(rows)||rows.some(l=>!SECTION_KEYS.some(k=>l?.key===k||l?.label===SECTION_LABELS[k]))) throw legacyRepair();
  return JSON.stringify(SECTION_KEYS.map(k=>rows.find(l=>l?.key===k||l?.label===SECTION_LABELS[k])?.pct??0));
}
function milestoneProjection(milestones:any[]) {
  const projected:Record<string,Record<string,any>>={milestones:{},milestone_costs:{}};
  for (const m of milestones) {
    if (m.okr_id != null) projected.milestone_costs[String(m.okr_id)]={cost:m.cost_cents===null?null:m.cost_cents/100,bucket:m.category_key?legacyBucket[m.category_key as SectionKey]:null};
    else if(m.category_key&&!projected.milestones[m.category_key]) projected.milestones[m.category_key]={label:m.label,by:m.due_on};
  }
  return projected;
}
function sameMilestoneEntry(a:any,b:any,cost:boolean) {
  if (!obj(a)||!obj(b)) return false;
  if (!cost) return a.label===b.label&&(a.by||null)===(b.by||null);
  const amount=(v:any)=>v==null||(typeof v==='string'&&!v.trim())?null:Math.round(Number(v)*100);
  const bucket=(v:any)=>v==null||v===''?null:legacyBucket[v as SectionKey]??v;
  return amount(a.cost)===amount(b.cost)&&bucket(a.bucket)===bucket(b.bucket);
}
/** Replace only the old Base's projection; other legacy writers' entries survive. */
async function legacyStatements(env: Env, s: Scope, r: any, lines: any[], milestones: any[]) {
  const project = await env.DB.prepare('SELECT use_of_funds_meta,use_of_funds,funding_needed FROM projects WHERE id = ?').bind(s.projectId).first<any>();
  let meta:any;
  try { meta=json(project?.use_of_funds_meta,{}); } catch { throw legacyRepair(); }
  if (!obj(meta)) throw legacyRepair();
  const complete = hasCompleteSplit(lines);
  const split = complete ? SECTION_KEYS.map(k => ({ label: SECTION_LABELS[k], pct: lines.find(l => l.category_key === k).share_pct })) : null;
  const recordedTarget=meta.runway_months??null;
  meta.deck_synced_at = null;
  if (r.target_runway_months === null) delete meta.runway_months; else meta.runway_months = r.target_runway_months;
  const previous=await env.DB.prepare('SELECT * FROM uof_scenarios WHERE project_id=? AND is_base=1').bind(s.projectId).first<any>();
  const previousParts=previous?await scenarioParts(env,previous.id):{lines:[],milestones:[]};
  if(previous) {
    const storedAmount=project.funding_needed;
    const recordedAmount=storedAmount==null||(typeof storedAmount==='string'&&!storedAmount.trim())?null:Math.round(Number(storedAmount)*100);
    if(recordedAmount!==previous.amount_to_raise_cents&&recordedAmount!==r.amount_to_raise_cents) throw legacyRepair(true);
    if(recordedTarget!==previous.target_runway_months&&recordedTarget!==r.target_runway_months) throw legacyRepair(true);
    if(complete&&hasCompleteSplit(previousParts.lines)) {
      const current=recordedSplit(project.use_of_funds);
      const prior=JSON.stringify(SECTION_KEYS.map(k=>previousParts.lines.find(l=>l.category_key===k).share_pct));
      const next=JSON.stringify(SECTION_KEYS.map(k=>lines.find(l=>l.category_key===k).share_pct));
      if(current!==prior&&current!==next) throw legacyRepair(true);
    }
  }
  const before=milestoneProjection(previousParts.milestones);
  const after=milestoneProjection(milestones);
  for (const field of ['milestones','milestone_costs']) {
    const current=meta[field]??{};
    if (!obj(current)) throw legacyRepair();
    const merged={...current};
    for (const [k,value] of Object.entries(before[field])) if (sameMilestoneEntry(merged[k],value,field==='milestone_costs')) delete merged[k];
    for (const [k,value] of Object.entries(after[field])) {
      if (has(merged,k)&&!sameMilestoneEntry(merged[k],value,field==='milestone_costs')) throw legacyRepair(true);
      merged[k]={...(obj(current[k])?current[k]:{}),...value};
    }
    meta[field]=merged;
  }
  return [
    // CASE is lazy in SQLite. A changed snapshot evaluates fixed invalid JSON,
    // aborting and rolling back the WHOLE D1 batch, including earlier statements.
    // No project content is parsed or placed in the database error.
    env.DB.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM projects WHERE id=? AND deleted_at IS NULL AND use_of_funds_meta IS ? AND use_of_funds IS ? AND funding_needed IS ?) THEN 'true' ELSE '' END)")
      .bind(s.projectId,project?.use_of_funds_meta??null,project?.use_of_funds??null,project?.funding_needed??null),
    env.DB.prepare(`UPDATE projects SET use_of_funds = CASE WHEN ?=1 THEN ? ELSE use_of_funds END, funding_needed = ?, use_of_funds_meta = ?, updated_at = datetime('now') WHERE id = ?
    AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=1)`)
    .bind(complete?1:0,split === null ? null : JSON.stringify(split), r.amount_to_raise_cents === null ? null : r.amount_to_raise_cents / 100, JSON.stringify(meta), s.projectId,r.id,s.projectId)];
}
function readLines(b: unknown) {
  if (!Array.isArray(b) || b.length !== 5) throw bad();
  const lines = b.map(l => {
    if (!obj(l)) throw bad();
    fields(l, ['key', 'share_pct', 'sublabel']);
    const k = key(l.key); if (k === null) throw bad();
    const share = number(l.share_pct, 100);
    const sublabel = l.sublabel == null ? null : text(l.sublabel);
    return { category_key: k, share_pct: share, sublabel, source_label: 'typed' };
  });
  if (new Set(lines.map(l => l.category_key)).size !== 5) throw bad();
  if (lines.some(l => l.share_pct !== null) && (lines.some(l => l.share_pct === null) || lines.reduce((n, l) => n + l.share_pct!, 0) !== 100)) throw new PlanError(400,'invalid_plan','Use of Funds must total exactly 100%.');
  return lines;
}
const scenarioFields = ['name', 'amount_to_raise_cents', 'target_runway_months', 'currency', 'start_month', 'raise_month', 'cash_cents', 'lines'];
function mergeScenario(old: any, b: Record<string, unknown>) {
  fields(b, scenarioFields);
  const r = { ...old };
  if (has(b, 'name')) r.name = text(b.name);
  if (has(b, 'amount_to_raise_cents')) { r.amount_to_raise_cents = number(b.amount_to_raise_cents); r.legacy_copied_at = null; }
  if (has(b, 'target_runway_months')) r.target_runway_months = number(b.target_runway_months, 120, 1);
  if (has(b, 'cash_cents')) r.cash_cents = number(b.cash_cents, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
  if (has(b, 'start_month')) r.start_month = month(b.start_month);
  if (has(b, 'raise_month')) r.raise_month = month(b.raise_month);
  if (has(b, 'currency')) r.currency = currency(b.currency);
  // The legacy project amount is dollar-denominated. A Base in another currency cannot be projected truthfully.
  if (r.is_base && r.currency !== 'usd') throw new PlanError(409, 'base_currency', 'The Base uses USD because its legacy readers record dollars.');
  return r;
}
export async function saveScenario(env: Env, s: Scope, id: number | null, b: Record<string, unknown>) {
  await base(env, s);
  const from = b.from_id == null ? null : await scenario(env, s, idOf(b.from_id));
  if (id !== null && has(b, 'from_id')) throw bad();
  const input = { ...b }; delete input.from_id;
  const old = id === null ? { name: '', currency: 'usd', amount_to_raise_cents: null, target_runway_months: null, start_month: null, raise_month: null, cash_cents: null, legacy_copied_at: null, ...from, id: undefined, uid: crypto.randomUUID(), is_base: 0 } : await scenario(env, s, id);
  const r = mergeScenario(old, input); if (!r.name) throw bad();
  const parts = id !== null || from ? await scenarioParts(env, id ?? from.id) : { lines: SECTION_KEYS.map(category_key => ({ category_key, share_pct: null, sublabel: null, source_label: null })), milestones: [] };
  const lines = has(input, 'lines') ? readLines(input.lines) : parts.lines;
  if(r.is_base&&has(input,'lines')&&!hasCompleteSplit(lines)) throw incompleteBase();
  const uid = r.uid;
  const stmts = id === null
    ? [env.DB.prepare(`INSERT INTO uof_scenarios(uid,project_id,name,is_base,currency,amount_to_raise_cents,target_runway_months,start_month,raise_month,cash_cents,legacy_copied_at,created_by,updated_by)
        SELECT ?,?,?,0,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=?)`).bind(uid, s.projectId, r.name, r.currency, r.amount_to_raise_cents, r.target_runway_months, r.start_month, r.raise_month, r.cash_cents, r.legacy_copied_at, s.user.id, s.user.id,from?.id??null,from?.id??null,s.projectId)]
    : [env.DB.prepare(`UPDATE uof_scenarios SET name=?,currency=?,amount_to_raise_cents=?,target_runway_months=?,start_month=?,raise_month=?,cash_cents=?,legacy_copied_at=?,updated_by=?,updated_at=datetime('now') WHERE id=? AND project_id=? AND is_base=?`)
      .bind(r.name, r.currency, r.amount_to_raise_cents, r.target_runway_months, r.start_month, r.raise_month, r.cash_cents, r.legacy_copied_at, s.user.id, id, s.projectId,r.is_base)];
  if (id===null) for (const l of lines) stmts.push(env.DB.prepare(`INSERT INTO uof_scenario_lines(scenario_id,category_key,share_pct,sublabel,source_label,source_kind,source_ref,updated_by)
    SELECT id,?,?,?,?,?,?,? FROM uof_scenarios WHERE uid=? AND project_id=? AND is_base=0`)
    .bind(l.category_key,l.share_pct,l.sublabel,l.source_label,l.source_kind??null,l.source_ref??null,s.user.id,uid,s.projectId));
  else if (has(input,'lines')) for (const l of lines) stmts.push(env.DB.prepare(`UPDATE uof_scenario_lines SET prior_value=CAST(share_pct AS TEXT),share_pct=?,sublabel=?,
    source_kind=NULL,source_ref=NULL,source_label='typed',updated_by=?,updated_at=datetime('now')
    WHERE scenario_id=? AND category_key=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=?)`)
    .bind(l.share_pct,l.sublabel,s.user.id,id,l.category_key,id,s.projectId,r.is_base));
  if (id === null) for (const m of parts.milestones) stmts.push(env.DB.prepare(`INSERT INTO uof_milestones(scenario_id,category_key,label,due_on,cost_cents,okr_id,source_label,source_kind,source_ref,updated_by)
    SELECT id,?,?,?,?,?,?,?,?,? FROM uof_scenarios WHERE uid=? AND project_id=?`).bind(m.category_key,m.label,m.due_on,m.cost_cents,m.okr_id,m.source_label,m.source_kind,m.source_ref,s.user.id,uid,s.projectId));
  if (r.is_base) stmts.push(...await legacyStatements(env, s, r, lines, parts.milestones));
  stmts.push(scenarioAudit(env, s, id === null ? 'uof_scenario_created' : 'uof_scenario_updated',uid,r.is_base));
  const written=await planBatch(env,stmts);
  if (!written[0].meta.changes) throw new PlanError(409,'scenario_changed','The scenario changed. Read it again.');
  const saved = await env.DB.prepare('SELECT * FROM uof_scenarios WHERE uid=? AND project_id=?').bind(uid,s.projectId).first<any>();
  return view(env, s, saved);
}
export async function makeBase(env: Env, s: Scope, id: number) {
  const r = await scenario(env, s, id); const parts = await scenarioParts(env, id);
  if(!hasCompleteSplit(parts.lines)) throw incompleteBase();
  if (r.currency !== 'usd') throw new PlanError(409, 'base_currency', 'The Base uses USD because its legacy readers record dollars.');
  // Clearing and assigning the unique Base happen in the same transaction.
  const written=await planBatch(env,[
    env.DB.prepare('UPDATE uof_scenarios SET is_base=0 WHERE project_id=? AND is_base=1 AND EXISTS(SELECT 1 FROM uof_scenarios target WHERE target.id=? AND target.project_id=?)').bind(s.projectId,id,s.projectId),
    env.DB.prepare("UPDATE uof_scenarios SET is_base=1,updated_by=?,updated_at=datetime('now') WHERE id=? AND project_id=?").bind(s.user.id,id,s.projectId),
    ...await legacyStatements(env,s,r,parts.lines,parts.milestones), scenarioAudit(env,s,'uof_scenario_made_base',r.uid,1),
  ]);
  if (!written[1].meta.changes) throw new PlanError(409,'scenario_changed','The scenario changed. Read it again.');
  return view(env,s,{...r,is_base:1});
}
export async function deleteScenario(env: Env, s: Scope, id: number) {
  const r = await scenario(env,s,id);
  if (r.is_base) throw new PlanError(409,'base_required','Make another scenario the Base before deleting this one.');
  const out=await env.DB.batch([
    // A concurrent promotion must keep the Base and its children, without a false deletion audit.
    env.DB.prepare(`INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor)
      SELECT ?,?,'raise.use-of-funds',?,'uof_scenario_deleted',?,? FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=0`)
      .bind(s.projectId,s.user.id,r.uid,s.user.role==='admin'?'Studio admin: uof scenario deleted.':'uof scenario deleted.',`user:${s.user.id}`,id,s.projectId),
    env.DB.prepare('DELETE FROM uof_milestones WHERE scenario_id=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=0)').bind(id,id,s.projectId),
    env.DB.prepare('DELETE FROM uof_scenario_lines WHERE scenario_id=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=0)').bind(id,id,s.projectId),
    env.DB.prepare('DELETE FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=0').bind(id,s.projectId),
  ]);
  if (!out[3].meta.changes) throw new PlanError(409,'base_changed','The scenario changed while this action was open. Read it again.');
  return { ok:true };
}
export async function milestone(env: Env,s:Scope,id:number) {
  const r = await env.DB.prepare('SELECT m.* FROM uof_milestones m JOIN uof_scenarios s ON s.id=m.scenario_id WHERE m.id=? AND s.project_id=?').bind(id,s.projectId).first<any>();
  if (!r) throw new PlanError(404,'not_found','Milestone not found.'); return r;
}
export async function saveMilestone(env:Env,s:Scope,id:number|null,b:Record<string,unknown>,remove=false) {
  fields(b,['scenario_id','category_key','label','due_on','cost_cents','okr_id']);
  const old = id === null ? { uid:crypto.randomUUID(),scenario_id: idOf(b.scenario_id ?? await base(env,s)),category_key:null,label:'',due_on:null,cost_cents:null,okr_id:null } : await milestone(env,s,id);
  if (id !== null && has(b,'scenario_id') && b.scenario_id !== old.scenario_id) throw bad();
  const sc = await scenario(env,s,old.scenario_id); const r = {...old};
  if (has(b,'category_key')) r.category_key=key(b.category_key);
  if (has(b,'label')) r.label=text(b.label);
  if (has(b,'due_on')) r.due_on=due(b.due_on);
  if (has(b,'cost_cents')) r.cost_cents=number(b.cost_cents);
  if (has(b,'okr_id')) r.okr_id=b.okr_id===null?null:idOf(b.okr_id);
  if (!r.label) throw bad();
  if (!remove && r.okr_id !== null && !await env.DB.prepare('SELECT id FROM roadmap_okrs WHERE id=? AND project_id=?').bind(r.okr_id,s.projectId).first()) throw new PlanError(404,'not_found','Roadmap item not found.');
  if (!remove && r.okr_id !== null && await env.DB.prepare('SELECT id FROM uof_milestones WHERE scenario_id=? AND okr_id=? AND id<>?').bind(sc.id,r.okr_id,id??-1).first()) throw new PlanError(409,'duplicate_okr','This roadmap item is already in the scenario.');
  const stmts = remove ? [env.DB.prepare('DELETE FROM uof_milestones WHERE id=? AND scenario_id=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=?)').bind(id,sc.id,sc.id,s.projectId,sc.is_base)] : id === null
    ? [env.DB.prepare("INSERT INTO uof_milestones(uid,scenario_id,category_key,label,due_on,cost_cents,okr_id,source_label,updated_by) SELECT ?,id,?,?,?,?,?,'typed',? FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=?").bind(r.uid,r.category_key,r.label,r.due_on,r.cost_cents,r.okr_id,s.user.id,sc.id,s.projectId,sc.is_base)]
    : [env.DB.prepare("UPDATE uof_milestones SET category_key=?,label=?,due_on=?,cost_cents=?,okr_id=?,prior_value=CAST(cost_cents AS TEXT),source_kind=NULL,source_ref=NULL,source_label='typed',updated_by=?,updated_at=datetime('now') WHERE id=? AND scenario_id=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=?)").bind(r.category_key,r.label,r.due_on,r.cost_cents,r.okr_id,s.user.id,id,sc.id,sc.id,s.projectId,sc.is_base)];
  if (sc.is_base) {
    const parts=await scenarioParts(env,sc.id); const ms=parts.milestones.filter(m=>m.id!==id);
    if (!remove) ms.push(r);
    stmts.push(...await legacyStatements(env,s,sc,parts.lines,ms));
  }
  stmts.push(scenarioAudit(env,s,remove?'uof_milestone_deleted':id===null?'uof_milestone_created':'uof_milestone_updated',sc.uid,sc.is_base,r.uid));
  const written=await planBatch(env,stmts);
  if (!written[0].meta.changes) throw new PlanError(409,'scenario_changed','The scenario changed. Read it again.');
  if (remove) return {ok:true};
  const saved=await env.DB.prepare('SELECT * FROM uof_milestones WHERE uid=? AND scenario_id=?').bind(r.uid,sc.id).first<any>();
  return {...saved,source:'Typed',cost_state:saved.cost_cents===null?'not_costed':'recorded'};
}
export async function saveHire(env:Env,s:Scope,id:number,b:Record<string,unknown>,remove=false) {
  fields(b,['category_key','role','start_month','annual_cents','currency']);
  const old=await env.DB.prepare('SELECT * FROM use_of_funds_hires WHERE id=? AND project_id=?').bind(id,s.projectId).first<any>();
  if (!old) throw new PlanError(404,'not_found','Hire not found.'); const r={...old};
  if (has(b,'category_key')) { r.category_key=key(b.category_key); if (!r.category_key) throw bad(); }
  if (has(b,'role')) r.role=text(b.role);
  if (has(b,'start_month')) r.start_month=month(b.start_month);
  if (has(b,'annual_cents')) r.annual_cents=number(b.annual_cents);
  if (has(b,'currency')) r.currency=currency(b.currency);
  const written=await env.DB.batch([
    env.DB.prepare(`INSERT INTO activity_logs(project_id,user_id,entity_type,entity_id,action,details,actor)
      SELECT ?,?,'raise.use-of-funds',uid,?,?,? FROM use_of_funds_hires WHERE id=? AND project_id=?`)
      .bind(s.projectId,s.user.id,remove?'uof_hire_deleted':'uof_hire_updated',`${s.user.role==='admin'?'Studio admin: ':''}${remove?'uof hire deleted.':'uof hire updated.'}`,`user:${s.user.id}`,id,s.projectId),
    remove ? env.DB.prepare('DELETE FROM use_of_funds_hires WHERE id=? AND project_id=?').bind(id,s.projectId)
      : env.DB.prepare("UPDATE use_of_funds_hires SET category_key=?,role=?,start_month=?,annual_cents=?,currency=?,updated_at=datetime('now') WHERE id=? AND project_id=?").bind(r.category_key,r.role,r.start_month,r.annual_cents,r.currency,id,s.projectId),
  ]);
  if (!written[1].meta.changes) throw new PlanError(409,'hire_changed','The hire changed. Read it again.');
  return remove?{ok:true}:{...r,source:'Typed'};
}

/** Compatibility PUT: five shares, target and section milestones change together. */
export async function saveSplit(env:Env,s:Scope,b:Record<string,unknown>) {
  fields(b,['amount_to_raise_cents','runway_months','sections']);
  if (!Array.isArray(b.sections)||!b.sections.length) throw bad();
  const seen=new Set<string>();
  const sections:Record<string,any>[]=b.sections.map(x=>{
    if (!obj(x)) throw bad(); fields(x,['key','pct','milestone_label','milestone_by']);
    const k=key(x.key); if (!k||seen.has(k)) throw bad(); seen.add(k);
    const pct=number(x.pct,100); if (pct===null) throw bad();
    if (has(x,'milestone_by')) due(x.milestone_by===''?null:x.milestone_by);
    if (has(x,'milestone_label')&&x.milestone_label!==null&&x.milestone_label!=='') text(x.milestone_label);
    return {...x,key:k,pct};
  });
  const lines=readLines(SECTION_KEYS.map(k=>({key:k,share_pct:sections.find(x=>x.key===k)?.pct??0})));
  const sc=await scenario(env,s,await base(env,s));
  const input:Record<string,unknown>={};
  if (has(b,'amount_to_raise_cents')) input.amount_to_raise_cents=b.amount_to_raise_cents;
  if (has(b,'runway_months')) input.target_runway_months=b.runway_months;
  const r=mergeScenario(sc,input); const parts=await scenarioParts(env,sc.id);
  const ms=parts.milestones.slice();
  const stmts=[env.DB.prepare("UPDATE uof_scenarios SET amount_to_raise_cents=?,target_runway_months=?,legacy_copied_at=?,updated_by=?,updated_at=datetime('now') WHERE id=? AND project_id=? AND is_base=1")
    .bind(r.amount_to_raise_cents,r.target_runway_months,r.legacy_copied_at,s.user.id,sc.id,s.projectId)];
  for (const l of lines) stmts.push(env.DB.prepare("UPDATE uof_scenario_lines SET share_pct=?,source_kind=NULL,source_ref=NULL,source_label='typed',prior_value=CAST(share_pct AS TEXT),updated_by=?,updated_at=datetime('now') WHERE scenario_id=? AND category_key=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=1)").bind(l.share_pct,s.user.id,sc.id,l.category_key,sc.id,s.projectId));
  for (const section of sections) if (has(section,'milestone_label')) {
    const idx=ms.findIndex(m=>m.category_key===section.key&&m.okr_id===null);
    const existing=idx<0?null:ms[idx]; if (idx>=0) ms.splice(idx,1);
    if (existing) stmts.push(env.DB.prepare('DELETE FROM uof_milestones WHERE id=? AND scenario_id=? AND EXISTS(SELECT 1 FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=1)').bind(existing.id,sc.id,sc.id,s.projectId));
    if (section.milestone_label!=null&&section.milestone_label!=='') {
      const m={category_key:section.key,label:text(section.milestone_label),due_on:section.milestone_by||null,cost_cents:existing?.cost_cents??null,okr_id:null};
      ms.push(m);
      stmts.push(env.DB.prepare("INSERT INTO uof_milestones(scenario_id,category_key,label,due_on,cost_cents,source_label,updated_by) SELECT id,?,?,?,?,'typed',? FROM uof_scenarios WHERE id=? AND project_id=? AND is_base=1").bind(m.category_key,m.label,m.due_on,m.cost_cents,s.user.id,sc.id,s.projectId));
    }
  }
  stmts.push(...await legacyStatements(env,s,r,lines,ms));
  for (const section of sections) stmts.push(scenarioAudit(env,s,'split_saved',sc.uid,1,section.key));
  const written=await planBatch(env,stmts);
  if (!written[0].meta.changes) throw new PlanError(409,'scenario_changed','The scenario changed. Read it again.');
  return {ok:true,use_of_funds:SECTION_KEYS.map(k=>({label:SECTION_LABELS[k],pct:lines.find(l=>l.category_key===k)!.share_pct})),runway_months:r.target_runway_months};
}
