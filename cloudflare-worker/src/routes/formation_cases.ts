/** D6703 (#6703): HQ formation intake cases, scoped to the project owner or company editor. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdminWriteBar, requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { canEdit } from '../services/companyAccess';
import { isVentureFounder } from '../services/ventureFounder';
import { ensureIncorporationsSchema } from '../services/incorporations';
import { currentVersion, catalogueForm } from '../services/formationCatalogue';
import { formationRules, type FormationAnswers, type ComparisonRule } from '../services/formationRules';
import { transition } from '../services/formationCase';
import { jurisdictionIsCountry } from '../services/formationGates';
import { logAdminAction } from '../services/adminAudit';
import { formationCountry, formationPrefill, type FormationPrefill, type IntakeFounder } from '../services/formationPrefill';

const formationCases = new Hono<{ Bindings: Env }>();
type Case = { id: number; uid: string; project_id: number | null; company_id: number | null; stage: string; revision: number; waiting_on: string; hold_reason: string | null; closed_at: string | null; track: string };
const columns = 'id, uid, project_id, company_id, stage, revision, waiting_on, hold_reason, closed_at, track';

async function ownsCase(env: Env, user: User, subject: { project_id: number | null; company_id: number | null }): Promise<boolean> {
  if (subject.project_id != null) return await isVentureFounder(env, user, subject.project_id) &&
    !!await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(subject.project_id).first();
  return subject.company_id != null && canEdit(env, { id: subject.company_id }, user);
}

async function view(env: Env, row: Case, prefill?: FormationPrefill) {
  const answers = await env.DB.prepare(
    'SELECT uid, answers_json, prefill_json, created_at FROM formation_case_answers WHERE case_id = ? ORDER BY id DESC LIMIT 1',
  ).bind(row.id).first<{ uid: string; answers_json: string; prefill_json: string; created_at: string }>();
  const held = row.hold_reason != null;
  return { case: { uid: row.uid, project_id: row.project_id, company_id: row.company_id, stage: row.stage, revision: row.revision,
    waiting_on: row.waiting_on, held, message: held ? 'We are checking your details' : null },
    answers: answers ? { uid: answers.uid, values: JSON.parse(answers.answers_json), prefill: JSON.parse(answers.prefill_json), created_at: answers.created_at } : null,
    prefill: prefill ?? await formationPrefill(env, row), options: [] };
}

formationCases.use('*', async (c, next) => {
  await requireAuth(c);
  c.header('Cache-Control', 'private, no-store');
  if (branchOf(c.env)) return refuse(c, 403, { code: 'formation_hq_only', message: 'This formation flow is available at Axal VC HQ.' });
  await ensureIncorporationsSchema(c.env);
  return next();
});

formationCases.post('/', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null);
  if (!body || (body.project_id == null) === (body.company_uid == null)) return refuse(c, 400, { code: 'formation_subject_required', message: 'Choose one venture or company.' });
  let projectId: number | null = null;
  let companyId: number | null = null;
  if (body.project_id != null) {
    projectId = Number(body.project_id);
    if (!Number.isSafeInteger(projectId) || projectId < 1) return refuse(c, 400, { code: 'formation_subject_invalid', message: 'Choose a valid venture.' });
  } else {
    const company = await c.env.DB.prepare('SELECT id FROM company_profiles WHERE uid = ? AND archived_at IS NULL')
      .bind(String(body.company_uid)).first<{ id: number }>();
    if (!company) return refuse(c, 404, { code: 'formation_subject_not_found', message: 'That company is not available.' });
    companyId = company.id;
  }
  const subject = { project_id: projectId, company_id: companyId };
  if (!await ownsCase(c.env, user, subject)) return refuse(c, 404, { code: 'formation_subject_not_found', message: 'That formation subject is not available to you.' });
  const intent = projectId == null ? 'incorporate_company' : body.intent === 'new_company' ? 'new_company' : 'convert_project';
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO formation_cases (uid, user_id, intent, project_id, company_id, track, stage, waiting_on)
      VALUES (?, ?, ?, ?, ?, 'v2', 'draft', 'founder')`,
  ).bind(`fc_${crypto.randomUUID()}`, user.id, intent, projectId, companyId).run();
  const row = await c.env.DB.prepare('SELECT ' + columns + ` FROM formation_cases WHERE track = 'v2' AND closed_at IS NULL
    AND ((project_id = ? AND ? IS NOT NULL) OR (company_id = ? AND ? IS NOT NULL))`)
    .bind(projectId, projectId, companyId, companyId).first<Case>();
  if (!row) return refuse(c, 409, { code: 'formation_case_unavailable', message: 'The formation case could not be opened. Try again.' });
  return c.json(await view(c.env, row));
});

formationCases.get('/:uid', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare('SELECT ' + columns + ' FROM formation_cases WHERE uid = ? AND track = ?').bind(c.req.param('uid'), 'v2').first<Case>();
  if (!row || !await ownsCase(c.env, user, row)) return refuse(c, 404, { code: 'formation_case_not_found', message: 'That formation case is not available to you.' });
  return c.json(await view(c.env, row));
});

formationCases.post('/:uid/answers', async (c) => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare('SELECT ' + columns + ' FROM formation_cases WHERE uid = ? AND track = ?').bind(c.req.param('uid'), 'v2').first<Case>();
  if (!row || !await ownsCase(c.env, user, row)) return refuse(c, 404, { code: 'formation_case_not_found', message: 'That formation case is not available to you.' });
  if (row.closed_at || !['draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted'].includes(row.stage)) return refuse(c, 409, { code: 'formation_answers_locked', message: 'This case is no longer accepting intake answers.' });
  const body = await c.req.json().catch(() => null);
  if (!body?.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || new TextEncoder().encode(JSON.stringify(body.answers)).byteLength > 32768) return refuse(c, 400, { code: 'formation_answers_invalid', message: 'Provide an answers object of at most 32 KB.' });
  if (body.revision !== row.revision) return refuse(c, 409, { code: 'formation_case_moved', message: 'The case changed. Reload it before saving.' });
  const prefill = await formationPrefill(c.env, row);
  const suppliedFounders = body.answers.founders ?? prefill.values.founders;
  const founders = Array.isArray(suppliedFounders) ? suppliedFounders.map(f => ({
    ...prefill.values.founders.find(p => p.user_id === f?.user_id), ...f,
  })) : suppliedFounders;
  const operating = body.answers.operating_countries ?? prefill.values.operating_countries;
  if (!Array.isArray(founders) || !Array.isArray(operating) || founders.length !== prefill.values.founders.length ||
      new Set(founders.map(f => f?.user_id)).size !== founders.length ||
      founders.some(f => !prefill.values.founders.some(p => p.user_id === f?.user_id)) ||
      founders.some(f => [f.residence_country, f.nationality].some(value => value != null && !formationCountry(value))) ||
      operating.some(value => !formationCountry(value))) return refuse(c, 400, { code: 'formation_countries_invalid', message: 'Check every founder and use recognized countries. Unmapped countries must be supplied.' });
  const normalizedFounders: Pick<IntakeFounder, 'user_id' | 'residence_country' | 'nationality'>[] = founders.map(f => ({
    user_id: f.user_id, residence_country: formationCountry(f.residence_country), nationality: formationCountry(f.nationality),
  }));
  const answers = { ...body.answers, founders: normalizedFounders, operating_countries: operating.map(formationCountry) };
  const places = JSON.stringify([...answers.operating_countries, ...normalizedFounders.flatMap(f => [f.residence_country, f.nationality])].filter(Boolean));
  const answerUid = `fa_${crypto.randomUUID()}`;
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO formation_case_answers (uid, case_id, case_revision, answers_json, prefill_json, created_by)
      SELECT ?, id, revision + 1, ?, ?, ? FROM formation_cases WHERE id = ? AND revision = ? AND stage = ? AND closed_at IS NULL`)
      .bind(answerUid, JSON.stringify(answers), JSON.stringify(prefill), user.id, row.id, row.revision, row.stage),
    c.env.DB.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, to_revision, visibility)
      SELECT id, ?, 'founder', 'answers_saved', revision + 1, 'all' FROM formation_cases
      WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM formation_case_answers WHERE uid = ?)`)
      .bind(user.id, row.id, row.revision, answerUid),
    c.env.DB.prepare(`UPDATE formation_cases SET revision = revision + 1, updated_at = datetime('now'),
      hold_reason = CASE WHEN EXISTS (SELECT 1 FROM formation_restricted_jurisdictions WHERE upper(place) IN (SELECT value FROM json_each(?))) THEN 'restricted_place' ELSE hold_reason END,
      waiting_on = CASE WHEN hold_reason IS NOT NULL OR EXISTS (SELECT 1 FROM formation_restricted_jurisdictions WHERE upper(place) IN (SELECT value FROM json_each(?))) THEN 'hq' ELSE waiting_on END
      WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM formation_case_answers WHERE uid = ?)`)
      .bind(places, places, row.id, row.revision, answerUid),
  ]);
  if (!results[2]?.meta?.changes) return refuse(c, 409, { code: 'formation_case_moved', message: 'The case changed. Reload it before saving.' });
  const updated = await c.env.DB.prepare('SELECT ' + columns + ' FROM formation_cases WHERE id = ?').bind(row.id).first<Case>();
  return c.json(await view(c.env, updated!, prefill));
});

/** D6704: explicit global opt-in only, fail closed; no cached default-on flag. */
async function optionsOn(env: Env) {
  const flag = await env.DB.prepare("SELECT enabled FROM feature_flags WHERE key = 'formation_options' AND scope = 'global' AND scope_id = ''").first<{ enabled: number }>();
  return Number(flag?.enabled) === 1;
}
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2,'0')).join('');
}
type WaiverNotice = { template_key: string; text: string; sha256: string; source_id: number; checked_on: string };
type ComparisonOutput = ReturnType<typeof formationRules> & { waiver_notices: Record<string, WaiverNotice> };
/** Only the exact currently approved template body can be shown or accepted as a waiver. */
async function approvedWaiver(env: Env, versionId: number, formKey: string): Promise<WaiverNotice | null> {
  const row = await env.DB.prepare(`SELECT f.value AS template_key, f.source_id, f.checked_on, j.country, t.body_md
    FROM formation_form_facts f JOIN formation_entity_forms e ON e.id = f.form_id
    JOIN formation_jurisdictions j ON j.id = e.jurisdiction_id JOIN formation_sources s ON s.id = f.source_id
    JOIN legal_templates t ON t.slug = f.value AND t.is_active = 1 AND t.is_stub = 0
    WHERE e.version_id = ? AND e.form_key = ? AND f.fact_key = 'structure_waiver_template'
      AND f.status = 'recorded' AND s.kind = 'counsel'`).bind(versionId,formKey)
    .first<{template_key:string;source_id:number;checked_on:string;country:string;body_md:string}>();
  if (!row?.body_md?.trim() || row.body_md.length > 20000) return null;
  const hash = await digest(row.body_md);
  const reviews = await env.DB.prepare("SELECT jurisdiction FROM legal_reviews WHERE object_kind = 'template' AND object_ref = ? AND version_sha256 = ? AND decision = 'approved'")
    .bind(row.template_key,hash).all<{jurisdiction:string}>();
  return reviews.results.some(r => jurisdictionIsCountry(r.jurisdiction,row.country))
    ? {template_key:row.template_key,text:row.body_md,sha256:hash,source_id:row.source_id,checked_on:row.checked_on} : null;
}
const editable = (row: Case) => !row.closed_at && !row.hold_reason && ['draft','options_shown','chosen','structure_review'].includes(row.stage);

formationCases.get('/:uid/options', async c => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare('SELECT ' + columns + " FROM formation_cases WHERE uid = ? AND track = 'v2'").bind(c.req.param('uid')).first<Case>();
  if (!row || !await ownsCase(c.env,user,row)) return refuse(c,404,{code:'formation_case_not_found',message:'That formation case is not available to you.'});
  if (!await optionsOn(c.env)) return refuse(c,403,{code:'options_off',message:'Options are not switched on.'});
  if (!editable(row)) return refuse(c,409,{code:'formation_case_locked',message:'This case cannot compare options now.'});
  const answers = await c.env.DB.prepare('SELECT uid, answers_json FROM formation_case_answers WHERE case_id = ? ORDER BY id DESC LIMIT 1').bind(row.id).first<{uid:string;answers_json:string}>();
  const version = await currentVersion(c.env);
  if (!answers || !version) return refuse(c,409,{code:'comparison_not_recorded',message:'An answers set and a published catalogue are required.'});
  const keys = (await c.env.DB.prepare('SELECT form_key FROM formation_entity_forms WHERE version_id = ? ORDER BY form_key LIMIT 101').bind(version.id).all<{form_key:string}>()).results;
  const rules = (await c.env.DB.prepare("SELECT rule_json FROM formation_rules WHERE version_id = ? AND kind = 'recommend' ORDER BY position, rule_key LIMIT 501").bind(version.id).all<{rule_json:string}>()).results;
  if (keys.length > 100 || rules.length > 500) return refuse(c,409,{code:'catalogue_limit',message:'The comparison catalogue exceeds its supported size.'});
  const forms = await Promise.all(keys.map(k => catalogueForm(c.env,k.form_key,{version})));
  let output: ComparisonOutput;
  try { output = {...formationRules(JSON.parse(answers.answers_json) as FormationAnswers, {version:version.version,status:version.status,forms:forms.filter(f => f !== null),rules:rules.map(r => JSON.parse(r.rule_json) as ComparisonRule)}, c.req.query('open') || null), waiver_notices:Object.create(null)}; }
  catch { return refuse(c,409,{code:'comparison_not_recorded',message:'The published comparison rules do not cover these recorded answers.'}); }
  for (const option of output.options) if (option.path === 'specialist' && option.waiver_eligible) {
    const notice = await approvedWaiver(c.env,version.id,option.form_key);
    if (notice) output.waiver_notices[option.form_key] = notice;
  }
  const uid = `fs_${crypto.randomUUID()}`;
  const noticeHash = await digest(JSON.stringify({notice:output.notice,waiver_notices:output.waiver_notices}));
  const saved = await c.env.DB.prepare(`INSERT INTO formation_case_suggestions(uid,case_id,answers_uid,catalogue_version_id,output_json,notice_key,notice_version,notice_hash,created_by)
    SELECT ?,id,?,?,?,?,?,?,? FROM formation_cases WHERE id = ? AND revision = ? AND closed_at IS NULL AND hold_reason IS NULL
    AND ? = (SELECT uid FROM formation_case_answers WHERE case_id = ? ORDER BY id DESC LIMIT 1)`)
    .bind(uid,answers.uid,version.id,JSON.stringify(output),output.notice.key,output.notice.version,noticeHash,user.id,row.id,row.revision,answers.uid,row.id).run();
  if (!saved.meta.changes) return refuse(c,409,{code:'formation_case_moved',message:'The case changed. Reload before comparing.'});
  return c.json({suggestion_uid:uid,answers_uid:answers.uid,revision:row.revision,notice_hash:noticeHash,...output});
});

formationCases.use('/:uid/memos', bodyLimit({maxSize:32768}));
formationCases.use('/:uid/choice', bodyLimit({maxSize:8192}));

formationCases.post('/:uid/memos', async c => {
  // Owner decision 4A: HQ records the accepting partner's acknowledgement; founders cannot self-acknowledge.
  const user = await requireSuperAdminWriteBar(c);
  const row = await c.env.DB.prepare("SELECT id, partner_id FROM formation_cases WHERE uid = ? AND track = 'v2' AND closed_at IS NULL").bind(c.req.param('uid')).first<{id:number;partner_id:number|null}>();
  if (!row) return refuse(c,404,{code:'formation_case_not_found',message:'That formation case is not available.'});
  if (!await optionsOn(c.env)) return refuse(c,403,{code:'options_off',message:'Options are not switched on.'});
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b.answers_uid !== 'string' || b.answers_uid.length > 100 || b.partner_acknowledged !== true || !['document','author_name','firm','licensing_body','country','memo_date','partner_acknowledgement'].every(k => typeof b[k] === 'string' && b[k].trim() && b[k].length <= (k === 'document' ? 20000 : k === 'partner_acknowledgement' ? 2000 : 200)) || !/^[A-Z]{2}$/.test(b.country) || !/^\d{4}-\d{2}-\d{2}$/.test(b.memo_date) || Number.isNaN(Date.parse(b.memo_date)) || new Date(b.memo_date).toISOString().slice(0,10) !== b.memo_date || !row.partner_id || b.partner_id !== row.partner_id)
    return refuse(c,400,{code:'structure_memo_invalid',message:'Record the document, professional credentials, date and accepting partner acknowledgement.'});
  const uid = `fm_${crypto.randomUUID()}`;
  const saved = await c.env.DB.prepare(`INSERT INTO formation_case_memos(uid,case_id,answers_uid,document,author_name,firm,licensing_body,country,memo_date,partner_id,acknowledged_by,partner_acknowledgement)
    SELECT ?,id,?,?,?,?,?,?,?,?,?,? FROM formation_cases WHERE id = ? AND partner_id = ? AND closed_at IS NULL AND ? = (SELECT uid FROM formation_case_answers WHERE case_id = ? ORDER BY id DESC LIMIT 1)`)
    .bind(uid,b.answers_uid ?? null,b.document,b.author_name,b.firm,b.licensing_body,b.country,b.memo_date,row.partner_id,user.id,b.partner_acknowledgement,row.id,row.partner_id,b.answers_uid ?? null,row.id).run();
  if (!saved.meta.changes) return refuse(c,409,{code:'formation_case_moved',message:'The case or answers changed. Reload before recording the memo.'});
  await logAdminAction(c.env,user.id,user.email,'formation_structure_memo_recorded',{case_uid:c.req.param('uid'),memo_uid:uid});
  return c.json({memo_uid:uid});
});

formationCases.post('/:uid/choice', async c => {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare('SELECT ' + columns + ", partner_id FROM formation_cases WHERE uid = ? AND track = 'v2'").bind(c.req.param('uid')).first<Case & {partner_id:number|null}>();
  if (!row || !await ownsCase(c.env,user,row)) return refuse(c,404,{code:'formation_case_not_found',message:'That formation case is not available to you.'});
  if (!await optionsOn(c.env)) return refuse(c,403,{code:'options_off',message:'Options are not switched on.'});
  if (!editable(row)) return refuse(c,409,{code:'formation_case_locked',message:'This case cannot record a choice now.'});
  const b = await c.req.json().catch(() => null);
  if (!b || !['suggestion_uid','form_key','notice_hash'].every(k => typeof b[k] === 'string' && b[k].length > 0 && b[k].length <= 100) || !/^[a-f0-9]{64}$/.test(b.notice_hash) || !['self','structure_memo','waiver'].includes(b.confirmation) || (b.confirmation === 'structure_memo' && typeof b.memo_uid !== 'string') || b.revision !== row.revision || typeof b.own_reason !== 'string' || !b.own_reason.trim() || b.own_reason.length > 4000) return refuse(c,400,{code:'choice_invalid',message:'Name the case revision and record your reason.'});
  const shown = await c.env.DB.prepare(`SELECT uid,answers_uid,catalogue_version_id,output_json,notice_hash FROM formation_case_suggestions WHERE uid = ? AND case_id = ?
    AND answers_uid = (SELECT uid FROM formation_case_answers WHERE case_id = ? ORDER BY id DESC LIMIT 1)`).bind(b.suggestion_uid,row.id,row.id).first<{uid:string;answers_uid:string;catalogue_version_id:number;output_json:string;notice_hash:string}>();
  if (!shown || b.notice_hash !== shown.notice_hash) return refuse(c,409,{code:'choice_evidence_changed',message:'Compare the current answers and confirm the notice shown.'});
  const output = JSON.parse(shown.output_json) as ComparisonOutput;
  const option = output.options.find(o => o.form_key === b.form_key);
  if (!option) return refuse(c,400,{code:'form_not_shown',message:'Open the form to compare it before choosing it.'});
  if (option.path === 'specialist') {
    if (b.confirmation === 'structure_memo') {
      const memo = await c.env.DB.prepare('SELECT uid FROM formation_case_memos WHERE uid = ? AND case_id = ? AND partner_id = ? AND answers_uid = ?').bind(b.memo_uid ?? null,row.id,row.partner_id,shown.answers_uid).first();
      if (!memo) return refuse(c,409,{code:'structure_memo_required',message:'An acknowledged structure memo from the accepting partner is required.'});
    } else if (b.confirmation === 'waiver') {
      if (!option.waiver_eligible || ![4,5,10,11,13].includes(option.scenario)) return refuse(c,409,{code:'waiver_not_available',message:'This case requires a structure memo.'});
      const shownNotice = output.waiver_notices?.[option.form_key];
      const current = await approvedWaiver(c.env,shown.catalogue_version_id,option.form_key);
      if (!shownNotice || !current || current.sha256 !== shownNotice.sha256 || b.waiver_notice_hash !== shownNotice.sha256)
        return refuse(c,409,{code:'waiver_not_available',message:'Compare and confirm the exact counsel-approved waiver before choosing.'});
    } else return refuse(c,409,{code:'structure_memo_required',message:'An acknowledged structure memo is required.'});
  } else if (b.confirmation !== 'self') return refuse(c,400,{code:'choice_confirmation_invalid',message:'Record your own choice.'});
  const uid = `fc_choice_${crypto.randomUUID()}`;
  const next = row.revision + 1;
  const extra = [c.env.DB.prepare(`INSERT INTO formation_case_choices(uid,case_id,suggestion_uid,form_key,was_among_options,own_reason,confirmation,memo_uid,notice_hash,created_by)
    SELECT ?,id,?,?,1,?,?,CASE WHEN ? = 'structure_memo' THEN (SELECT uid FROM formation_case_memos WHERE uid = ? AND case_id = formation_cases.id AND partner_id = formation_cases.partner_id AND answers_uid = ?) ELSE NULL END,?,? FROM formation_cases WHERE id = ? AND revision = ? AND stage = 'chosen' AND EXISTS (SELECT 1 FROM formation_case_events WHERE case_id = ? AND to_revision = ? AND json_extract(detail_json, '$.choice_uid') = ?)` )
    .bind(uid,shown.uid,option.form_key,b.own_reason.trim(),b.confirmation,b.confirmation,b.memo_uid ?? null,shown.answers_uid,shown.notice_hash,user.id,row.id,next,row.id,next,uid),
    c.env.DB.prepare(`UPDATE formation_cases SET form_key = ?, path = ?, structure_gate = ?, catalogue_version_id = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM formation_case_choices WHERE uid = ?)`)
    .bind(option.form_key,option.path,option.structure_gate,shown.catalogue_version_id,row.id,next,uid)];
  if (row.stage === 'chosen') {
    const result = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO formation_case_events(case_id,actor_user_id,party,kind,from_stage,to_stage,to_revision,visibility,detail_json) SELECT id,?,'founder','choice_recorded','chosen','chosen',?,'all',? FROM formation_cases WHERE id = ? AND revision = ? AND stage = 'chosen' AND closed_at IS NULL AND hold_reason IS NULL")
        .bind(user.id,next,JSON.stringify({choice_uid:uid}),row.id,row.revision),
      c.env.DB.prepare("UPDATE formation_cases SET revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ? AND stage = 'chosen' AND closed_at IS NULL AND hold_reason IS NULL AND EXISTS(SELECT 1 FROM formation_case_events WHERE case_id = ? AND to_revision = ? AND json_extract(detail_json, '$.choice_uid') = ?)")
        .bind(row.id,row.revision,row.id,next,uid), ...extra]);
    if (!result[1].meta.changes) return refuse(c,409,{code:'formation_case_moved',message:'The case changed. Reload before choosing.'});
  } else {
    const moved = await transition(c.env,row.id,'chosen',{party:'founder',userId:user.id},{expectRevision:row.revision,extra,detail:{choice_uid:uid},visibility:'all'});
    if (!moved.ok) return refuse(c,409,{code:'formation_case_moved',message:'The case changed. Reload before choosing.'});
  }
  return c.json({choice_uid:uid,stage:'chosen',revision:next});
});

export const mount: RouteMount = { path: '/api/formation/cases', router: formationCases };
export default formationCases;
