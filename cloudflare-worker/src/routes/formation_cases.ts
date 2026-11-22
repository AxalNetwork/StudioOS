/** D6703 (#6703): HQ formation intake cases, scoped to the project owner or company editor. */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { canEdit } from '../services/companyAccess';
import { isVentureFounder } from '../services/ventureFounder';
import { ensureIncorporationsSchema } from '../services/incorporations';
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
  if (!body?.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || JSON.stringify(body.answers).length > 32768) return refuse(c, 400, { code: 'formation_answers_invalid', message: 'Provide an answers object of at most 32 KB.' });
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

export const mount: RouteMount = { path: '/api/formation/cases', router: formationCases };
export default formationCases;
