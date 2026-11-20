/**
 * D7704 (#7704) — market sizing versions at `/api/market-sizing`: the Worker
 * computes TAM, SAM and SOM (formula version 2, `services/marketSizing.ts`)
 * and saves the inputs, the figures and their history as one version, in one
 * all-or-nothing `DB.batch`.
 *
 *   POST /projects/:projectId/preview          compute, store nothing
 *   POST /projects/:projectId/versions         compute and save one version
 *   GET  /projects/:projectId/versions         every version, newest first
 *   GET  /projects/:projectId/versions/:uid    one version, its inputs, and whether it recomputes
 *
 * THE GATE is `canEditProjectData` from `routes/projects.ts`, the rule the
 * market-assumption routes use, imported so there is one rule and no copy:
 * an admin, the owning founder, an accepted co-founder or owner member. Every
 * route checks it before reading or writing anything about the venture. A
 * version uid of another project reads as not found.
 *
 * ONE WRITE. A save writes, in one batch: the version, its input rows,
 * `projects.tam/.sam/.som`, one `market_figures` row per figure naming the
 * version (on every save, so all three current rows name one version) and the
 * assumptions row. A failure of any one statement leaves all of them as they
 * were. This reverses the page's two-request save and D6011's "figures saved
 * even when their rows are not". `market_figure_source` is read as
 * `PUT /api/projects/:id` reads it and checked before anything is written.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import { canEditProjectData } from './projects';
import { getProjectMembershipRole } from '../services/projectAccess';
import { logAdminAction } from '../services/adminAudit';
import {
  ASSUMPTION_KEYS, assumptionStatements, ensureMarketAssumptionsSchema, sanitizeAssumptions,
} from '../services/marketAssumptions';
import {
  MARKET_FIGURES, MARKET_PROVENANCE_REFUSALS, MarketProvenanceError, marketFigureStatement, resolveMarketProvenance,
  type MarketProvenance,
} from '../services/marketFigures';
import {
  SIZING_INPUT_KEYS, SizingInputError, recomputesToStored, sizeMarket,
  type SizingInputKey, type SizingResult, type StoredInput, type StoredVersion,
} from '../services/marketSizing';

const marketSizing = new Hono<{ Bindings: Env }>();

type Project = { id: number; founder_id: number | null; tam: unknown; sam: unknown; som: unknown };
type Ctx = Context<{ Bindings: Env }>;

const MAX_NOTE = 200;

/** The project and the caller, or the refusal to send. Nothing is read about the venture before the gate. */
async function editableProject(c: Ctx): Promise<{ user: User; project: Project } | { error: Response }> {
  const user = await requireAuth(c);
  const id = Number(c.req.param('projectId'));
  if (!Number.isSafeInteger(id) || id <= 0) return { error: refuse(c, 400, { code: 'invalid_project_id', message: 'That is not a venture id.' }) };
  const project = await c.env.DB.prepare('SELECT id, founder_id, tam, sam, som FROM projects WHERE id = ?').bind(id).first<Project>();
  if (!project) return { error: refuse(c, 404, { code: 'project_not_found', message: 'That venture was not found.' }) };
  if (!(await canEditProjectData(c.env, project, user))) {
    return { error: refuse(c, 403, { code: 'not_project_editor', message: 'Only the venture’s founders and admins can size its market.' }) };
  }
  return { user, project };
}

type Labels = Partial<Record<SizingInputKey, { label: 'entered' | 'assumption'; note: string | null }>>;

/** The body's sizing request, checked: unknown assumption fields, inputs and labels are refused by name. */
async function readRequest(c: Ctx): Promise<{ assumptions: Record<string, unknown>; result: SizingResult; labels: Labels; source: unknown } | { error: Response }> {
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const assumptions = body?.assumptions;
  if (!assumptions || typeof assumptions !== 'object' || Array.isArray(assumptions)) {
    return { error: refuse(c, 400, { code: 'missing_assumptions', message: 'Send the sizing inputs as `assumptions`.', extra: { keys: ASSUMPTION_KEYS } }) };
  }
  const { rejected } = sanitizeAssumptions(assumptions);
  if (rejected.length) {
    return { error: refuse(c, 400, { code: 'unknown_market_assumption_fields', message: 'Some fields are not market sizing inputs.', extra: { rejected, keys: ASSUMPTION_KEYS } }) };
  }
  let result: SizingResult;
  try {
    result = sizeMarket(assumptions);
  } catch (e) {
    if (e instanceof SizingInputError) return { error: refuse(c, 400, { code: e.code, message: e.sentence, extra: { field: e.field, fields: e.fields } }) };
    throw e;
  }
  const labels: Labels = {};
  const rawLabels = body?.input_labels;
  if (rawLabels != null) {
    if (typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
      return { error: refuse(c, 400, { code: 'invalid_input_labels', message: 'Input labels must name an input and say entered or assumption.' }) };
    }
    for (const [key, v] of Object.entries(rawLabels as Record<string, any>)) {
      const label = v?.label;
      if (!(SIZING_INPUT_KEYS as string[]).includes(key) || (label !== 'entered' && label !== 'assumption')) {
        return { error: refuse(c, 400, { code: 'invalid_input_labels', message: 'Input labels must name an input and say entered or assumption.', extra: { field: key } }) };
      }
      const note = v?.note == null ? '' : String(v.note).trim();
      if (note.length > MAX_NOTE) {
        return { error: refuse(c, 400, { code: 'input_note_too_long', message: `A note on an input is at most ${MAX_NOTE} characters.`, extra: { field: key } }) };
      }
      labels[key as SizingInputKey] = { label, note: note || null };
    }
  }
  return { assumptions, result, labels, source: body?.market_figure_source };
}

marketSizing.post('/projects/:projectId/preview', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const req = await readRequest(c);
  if ('error' in req) return req.error;
  return c.json({ result: req.result, saved: false });
});

marketSizing.post('/projects/:projectId/versions', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const { user, project } = found;
  const req = await readRequest(c);
  if ('error' in req) return req.error;
  const { result, labels, assumptions } = req;

  // Where the figures came from, checked before anything is written (D6011).
  let provenance: MarketProvenance;
  try {
    provenance = await resolveMarketProvenance(c.env, project.id, req.source);
  } catch (e) {
    if (e instanceof MarketProvenanceError) return refuse(c, 400, { code: e.code, message: MARKET_PROVENANCE_REFUSALS[e.code] });
    throw e;
  }
  // A save that names no method: these figures were computed, not typed, unless TAM was overridden.
  if (!provenance.stated) provenance = { ...provenance, method: result.tam_override != null ? 'typed' : 'bottom_up' };

  await ensureMarketAssumptionsSchema(c.env);
  const uid = crypto.randomUUID();
  const userId = Number(user.id) || null;
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO market_sizing_versions (uid, project_id, version_number, formula_version, scenario, computed_tam,
          tam_override, tam_override_reason, tam, sam, som, som_limit, currency, reference_year, horizon_months, author_id)
       SELECT ?, ?, COALESCE(MAX(version_number), 0) + 1, ?, 'base', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM market_sizing_versions WHERE project_id = ?`,
    ).bind(uid, project.id, result.formula_version, result.computed_tam, result.tam_override, result.tam_override_reason,
      result.tam, result.sam, result.som, result.som_limit, result.currency, result.reference_year, result.horizon_months, userId, project.id),
    ...result.inputs.map((input) => db.prepare(
      `INSERT INTO market_sizing_version_inputs (version_id, input_key, value, typed_text, unit, label, note)
       SELECT id, ?, ?, ?, ?, ?, ? FROM market_sizing_versions WHERE uid = ?`,
    ).bind(input.key, input.value, input.typed_text, input.unit, labels[input.key]?.label ?? 'entered', labels[input.key]?.note ?? null, uid)),
    db.prepare('UPDATE projects SET tam = ?, sam = ?, som = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(result.tam, result.sam, result.som, project.id),
    ...MARKET_FIGURES.map((figure) => marketFigureStatement(c.env, {
      projectId: project.id, figure, value: result[figure], provenance, setBy: userId, sizingVersionUid: uid,
    })),
    ...assumptionStatements(c.env, project.id, assumptions, userId).statements,
  ];
  try {
    await db.batch(statements);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message ?? ''))) {
      return refuse(c, 409, { code: 'sizing_version_conflict', message: 'Another save of this venture’s sizing landed at the same moment. Save again.', raw: e });
    }
    return refuse(c, 500, { code: 'sizing_not_saved', message: 'The sizing was not saved, and nothing about the venture changed. Try again.', raw: e });
  }

  // An admin's save on another person's venture is in the admin log, as PUT /api/projects/:id records it.
  if (user.role === 'admin' && !(user.founder_id && project.founder_id === user.founder_id)) {
    const member = await getProjectMembershipRole(c.env, project.id, user.id);
    if (member !== 'owner' && member !== 'cofounder') {
      await logAdminAction(c.env, Number(user.id), String(user.email || ''), 'market_figures_set', {
        project_id: project.id, figures: [...MARKET_FIGURES], sizing_version: uid,
      });
    }
  }
  const saved = await readVersion(c.env, project, uid);
  return c.json({ version: saved, result }, 201);
});

type VersionRow = StoredVersion & {
  id: number; uid: string; version_number: number; formula_version: number; scenario: string; currency: string;
  author_name: string | null; created_at: string;
};

const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
/** Whether the version's three figures are still the venture's own. */
const isCurrent = (v: VersionRow, p: Project) => n(p.tam) === Number(v.tam) && n(p.sam) === Number(v.sam) && n(p.som) === Number(v.som);

function shape(v: VersionRow, p: Project) {
  const { id: _id, ...rest } = v;
  return { ...rest, current: isCurrent(v, p) };
}

async function readVersion(env: Env, project: Project, uid: string) {
  const v = await env.DB.prepare(
    `SELECT v.id, v.uid, v.version_number, v.formula_version, v.scenario, v.computed_tam, v.tam_override,
            v.tam_override_reason, v.tam, v.sam, v.som, v.som_limit, v.currency, v.reference_year, v.horizon_months, v.created_at,
            u.name AS author_name
       FROM market_sizing_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.uid = ? AND v.project_id = ?`,
  ).bind(uid, project.id).first<VersionRow>();
  if (!v) return null;
  const p = await env.DB.prepare('SELECT id, founder_id, tam, sam, som FROM projects WHERE id = ?').bind(project.id).first<Project>();
  const inputs = await env.DB.prepare(
    `SELECT input_key, value, typed_text, unit, label, note, source_title, source_url
       FROM market_sizing_version_inputs WHERE version_id = ? ORDER BY id`,
  ).bind(v.id).all<StoredInput & Record<string, unknown>>();
  const rows = inputs.results || [];
  let formula: string[] | null = null;
  let notes: string[] = [];
  const recomputes = recomputesToStored(v, rows);
  if (recomputes) {
    const raw: Record<string, unknown> = { tamOverrideReason: v.tam_override_reason, targetYear: v.reference_year == null ? null : String(v.reference_year) };
    for (const r of rows) raw[r.input_key] = Number(r.value);
    const again = sizeMarket(raw);
    formula = again.formula;
    notes = again.notes;
  }
  return { ...shape(v, p ?? project), inputs: rows, recomputes, formula, notes };
}

marketSizing.get('/projects/:projectId/versions', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const rows = await c.env.DB.prepare(
    `SELECT v.id, v.uid, v.version_number, v.formula_version, v.scenario, v.computed_tam, v.tam_override,
            v.tam_override_reason, v.tam, v.sam, v.som, v.som_limit, v.currency, v.reference_year, v.horizon_months, v.created_at,
            u.name AS author_name
       FROM market_sizing_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.project_id = ? ORDER BY v.version_number DESC`,
  )
    .bind(found.project.id).all<VersionRow>();
  return c.json({ versions: (rows.results || []).map((v) => shape(v, found.project)) });
});

marketSizing.get('/projects/:projectId/versions/:uid', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const version = await readVersion(c.env, found.project, String(c.req.param('uid') ?? ''));
  if (!version) return refuse(c, 404, { code: 'sizing_version_not_found', message: 'That sizing version was not found for this venture.' });
  return c.json({ version });
});

export default marketSizing;
export const mount: RouteMount = { path: '/api/market-sizing', router: marketSizing };
