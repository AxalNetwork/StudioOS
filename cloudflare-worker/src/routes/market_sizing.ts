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
 *   GET  /projects/:projectId/versions/:uid/sensitivity   D7725: each input moved between low and high
 *   GET  /projects/:projectId/superseded       D7725: inputs whose observation a later vintage superseded
 *
 * D7725 (#7725) adds the labelled shape to the two POSTs: `scenarios` (base
 * alone, or low, base and high), a source on every input, a TAM override per
 * scenario and an optional `top_down` check (`services/marketSizing.ts` has
 * the rules). A save in #7704's shape is still accepted, and reads its inputs
 * as `not_labelled`. Low and high never write the project's figures.
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
  SIZING_INPUT_KEYS, SIZING_LIMITATION, SizingInputError, TOP_DOWN_KEY, isLabelledShape, observationIdsOf, observationSupersession,
  orderFlags, recomputesToStored, resolveLabelledSave, scenarioRaw, sensitivity, sizeMarket, supersededSizingEvidence,
  type LabelledPlan, type ResolvedEstimate, type Scenario, type SizingInputKey, type SizingResult, type StoredInput, type StoredVersion,
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

async function readBody(c: Ctx): Promise<Record<string, any>> {
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

/** A refused input, with its field, every field it names and (D7725) the scenario it is in. */
const inputRefusal = (c: Ctx, e: SizingInputError) => refuse(c, 400, {
  code: e.code, message: e.sentence,
  extra: { field: e.field, fields: e.fields, scenario: (e as SizingInputError & { scenario?: string | null }).scenario ?? null },
});

/** D7725: a save in the labelled shape, resolved against the stores its sources name. Nothing is written. */
async function readLabelled(c: Ctx, projectId: number, body: Record<string, any>): Promise<{ plan: LabelledPlan } | { error: Response }> {
  if (body.assumptions != null) {
    const { rejected } = sanitizeAssumptions(body.assumptions);
    if (typeof body.assumptions !== 'object' || Array.isArray(body.assumptions) || rejected.length) {
      return { error: refuse(c, 400, { code: 'unknown_market_assumption_fields', message: 'Some fields are not market sizing inputs.', extra: { rejected, keys: ASSUMPTION_KEYS } }) };
    }
  }
  try {
    return { plan: await resolveLabelledSave(c.env, projectId, body) };
  } catch (e) {
    if (e instanceof SizingInputError) return { error: inputRefusal(c, e) };
    throw e;
  }
}

const planReply = (plan: LabelledPlan) => ({
  revenue_basis: plan.revenue_basis,
  scenarios: Object.fromEntries(plan.scenarios.map((p) => [p.scenario, p.result])),
  top_down: plan.top_down ? { tam: plan.top_down.tam, gap: plan.top_down.gap } : null,
  order_flags: plan.order_flags,
});

/** The body's sizing request, checked: unknown assumption fields, inputs and labels are refused by name. */
async function readRequest(c: Ctx, body: Record<string, any>): Promise<{ assumptions: Record<string, unknown>; result: SizingResult; labels: Labels; source: unknown } | { error: Response }> {
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
    // D7725: #7704's shape may say whether revenue is annual or cumulative; when it does not, it reads per year.
    result = sizeMarket(body.revenue_basis == null ? assumptions : { ...assumptions, revenueBasis: body.revenue_basis });
  } catch (e) {
    if (e instanceof SizingInputError) return { error: inputRefusal(c, e) };
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
  const body = await readBody(c);
  if (isLabelledShape(body)) {
    const labelled = await readLabelled(c, found.project.id, body);
    if ('error' in labelled) return labelled.error;
    const base = labelled.plan.scenarios.find((p) => p.scenario === 'base') as LabelledPlan['scenarios'][number];
    return c.json({ result: base.result, ...planReply(labelled.plan), saved: false });
  }
  const req = await readRequest(c, body);
  if ('error' in req) return req.error;
  return c.json({ result: req.result, saved: false });
});

/** D7725: one estimate row. `version_id` and `scenario` select it; the rest is copied from the plan. */
function estimateStatement(db: D1Database, uid: string, scenario: Scenario, e: ResolvedEstimate, estimateNo: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO market_sizing_input_estimates (version_id, scenario, input_key, estimate_no, used, used_reason, value, original_value,
        typed_text, unit, currency, reference_year, source_kind, note, observation_id, market_source_id, fill_provenance_id,
        source_title, source_url, source_name, evidence_json, conversion_json, adjustment_json)
     SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM market_sizing_versions WHERE uid = ?`,
  ).bind(scenario, e.input_key, estimateNo, e.used ? 1 : 0, e.used_reason, e.value, e.original_value, e.typed_text, e.unit, e.currency,
    e.reference_year, e.source_kind, e.note, e.observation_id, e.market_source_id, e.fill_provenance_id, e.source_title, e.source_url,
    e.source_name, e.evidence ? JSON.stringify(e.evidence) : null, e.conversion ? JSON.stringify(e.conversion) : null,
    e.adjustment ? JSON.stringify(e.adjustment) : null, uid);
}

/** D7725: every estimate, low and high, and the top-down total, numbered per input within a scenario. */
function labelledStatements(db: D1Database, uid: string, plan: LabelledPlan): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const number = (scenario: Scenario, estimates: readonly ResolvedEstimate[]) => {
    const seen: Record<string, number> = {};
    for (const e of estimates) {
      seen[e.input_key] = (seen[e.input_key] ?? 0) + 1;
      out.push(estimateStatement(db, uid, scenario, e, seen[e.input_key]));
    }
  };
  for (const p of plan.scenarios) {
    number(p.scenario, p.estimates);
    if (p.scenario === 'base') continue;
    const r = p.result;
    out.push(db.prepare(
      `INSERT INTO market_sizing_scenarios (version_id, scenario, computed_tam, tam_override, tam_override_reason, tam, sam, som, som_limit, horizon_months)
       SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM market_sizing_versions WHERE uid = ?`,
    ).bind(p.scenario, r.computed_tam, r.tam_override, r.tam_override_reason, r.tam, r.sam, r.som, r.som_limit, r.horizon_months, uid));
  }
  if (plan.top_down) number('base', plan.top_down.estimates);
  return out;
}

marketSizing.post('/projects/:projectId/versions', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const { user, project } = found;
  const body = await readBody(c);
  let plan: LabelledPlan | null = null;
  let result: SizingResult;
  let labels: Labels = {};
  let assumptions: Record<string, unknown>;
  if (isLabelledShape(body)) {
    const labelled = await readLabelled(c, project.id, body);
    if ('error' in labelled) return labelled.error;
    plan = labelled.plan;
    result = (plan.scenarios.find((p) => p.scenario === 'base') as LabelledPlan['scenarios'][number]).result;
    assumptions = plan.assumptions;
  } else {
    const req = await readRequest(c, body);
    if ('error' in req) return req.error;
    ({ result, labels, assumptions } = req);
  }
  const source = body.market_figure_source;

  // Where the figures came from, checked before anything is written (D6011).
  let provenance: MarketProvenance;
  try {
    provenance = await resolveMarketProvenance(c.env, project.id, source);
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
          tam_override, tam_override_reason, tam, sam, som, som_limit, currency, reference_year, horizon_months, author_id,
          revenue_basis, top_down_tam, top_down_gap)
       SELECT ?, ?, COALESCE(MAX(version_number), 0) + 1, ?, 'base', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM market_sizing_versions WHERE project_id = ?`,
    ).bind(uid, project.id, result.formula_version, result.computed_tam, result.tam_override, result.tam_override_reason,
      result.tam, result.sam, result.som, result.som_limit, result.currency, result.reference_year, result.horizon_months, userId,
      result.revenue_basis, plan?.top_down?.tam ?? null, plan?.top_down?.gap ?? null, project.id),
    ...result.inputs.map((input) => {
      // D7725: in the labelled shape the base's used estimate gives the label and the copied source.
      const used = plan?.scenarios.find((p) => p.scenario === 'base')?.estimates.find((e) => e.used && e.input_key === input.key);
      return db.prepare(
        `INSERT INTO market_sizing_version_inputs (version_id, input_key, value, typed_text, unit, label, note, source_title, source_url, market_source_id)
         SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM market_sizing_versions WHERE uid = ?`,
      ).bind(input.key, input.value, used ? used.typed_text : input.typed_text, input.unit,
        used ? (used.source_kind === 'assumption' ? 'assumption' : 'entered') : labels[input.key]?.label ?? 'entered',
        used ? used.note : labels[input.key]?.note ?? null,
        used?.source_title ?? null, used?.source_url ?? null, used?.market_source_id ?? null, uid);
    }),
    ...(plan ? labelledStatements(db, uid, plan) : []),
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
  return c.json({ version: saved, result, ...(plan ? planReply(plan) : {}) }, 201);
});

type VersionRow = StoredVersion & {
  id: number; uid: string; version_number: number; formula_version: number; scenario: string; currency: string;
  author_name: string | null; created_at: string; top_down_tam: number | null; top_down_gap: number | null;
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
            v.revenue_basis, v.top_down_tam, v.top_down_gap, u.name AS author_name
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
    const again = sizeMarket(scenarioRaw(rows.map((r) => ({ input_key: r.input_key, value: Number(r.value) })),
      { tamOverrideReason: v.tam_override_reason, targetYear: v.reference_year == null ? null : String(v.reference_year), revenueBasis: v.revenue_basis ?? null }));
    formula = again.formula;
    notes = again.notes;
  }
  const labelled = await readLabelledParts(env, v, recomputes);
  const baseKinds = new Map(labelled.estimates.filter((e) => e.scenario === 'base' && e.used).map((e) => [e.input_key, e.source_kind]));
  return {
    ...shape(v, p ?? project),
    // D7725: an input of a save in #7704's shape has no source kind and reads `not_labelled`, never `assumption`.
    inputs: rows.map((r) => ({ ...r, source_kind: baseKinds.get(r.input_key) ?? 'not_labelled' })),
    unlabelled_inputs: rows.filter((r) => !baseKinds.has(r.input_key)).length,
    recomputes, formula, notes,
    scenarios: labelled.scenarios,
    order_flags: labelled.order_flags,
    sensitivity: labelled.sensitivity,
    top_down: v.top_down_tam == null ? null : {
      tam: Number(v.top_down_tam), bottom_up_tam: Number(v.tam), gap: Number(v.top_down_gap),
      estimates: labelled.estimates.filter((e) => e.scenario === 'base' && e.input_key === TOP_DOWN_KEY),
    },
    limitation: SIZING_LIMITATION,
  };
}

type EstimateRow = {
  scenario: Scenario; input_key: string; estimate_no: number; used: number; used_reason: string | null; value: number; original_value: number;
  typed_text: string | null; unit: string; currency: string | null; reference_year: number | null; source_kind: string; note: string | null;
  observation_id: number | null; market_source_id: number | null; fill_provenance_id: number | null; source_title: string | null;
  source_url: string | null; source_name: string | null; evidence_json: string | null; conversion_json: string | null; adjustment_json: string | null;
};
type ScenarioRow = Omit<StoredVersion, 'reference_year'> & { scenario: 'low' | 'high' };

/** D7725: the version's estimates (with superseded flags), each scenario's figures and whether it recomputes, and sensitivity. */
async function readLabelledParts(env: Env, v: VersionRow, baseRecomputes: boolean) {
  const estRows = (await env.DB.prepare(
    `SELECT scenario, input_key, estimate_no, used, used_reason, value, original_value, typed_text, unit, currency, reference_year,
            source_kind, note, observation_id, market_source_id, fill_provenance_id, source_title, source_url, source_name,
            evidence_json, conversion_json, adjustment_json
       FROM market_sizing_input_estimates WHERE version_id = ? ORDER BY id`,
  ).bind(v.id).all<EstimateRow>()).results ?? [];
  const scenarioRows = (await env.DB.prepare(
    `SELECT scenario, computed_tam, tam_override, tam_override_reason, tam, sam, som, som_limit, horizon_months
       FROM market_sizing_scenarios WHERE version_id = ? ORDER BY id`,
  ).bind(v.id).all<ScenarioRow>()).results ?? [];
  const status = await observationSupersession(env, estRows.flatMap(observationIdsOf));
  const parse = (j: unknown) => { if (j == null) return null; try { return JSON.parse(String(j)); } catch { return null; } };
  const estimates = estRows.map((r) => {
    const flags = observationIdsOf(r).map((id) => status.get(id)).filter((s) => s?.superseded);
    const { evidence_json, conversion_json, adjustment_json, ...rest } = r;
    return { ...rest, used: Number(r.used) === 1, evidence: parse(evidence_json), conversion: parse(conversion_json), adjustment: parse(adjustment_json),
      superseded: flags.length > 0, superseded_by: flags };
  });
  const used = (scenario: Scenario) => estRows.filter((e) => e.scenario === scenario && Number(e.used) === 1 && e.input_key !== TOP_DOWN_KEY)
    .map((e) => ({ input_key: e.input_key, value: Number(e.value) }));
  const figures = (r: { tam: unknown; sam: unknown; som: unknown }) => ({ tam: Number(r.tam), sam: Number(r.sam), som: Number(r.som) });
  const scenarioOut = (scenario: Scenario) => estimates.filter((e) => e.scenario === scenario && e.input_key !== TOP_DOWN_KEY);
  const scenarios: Record<string, unknown> = {
    base: { computed_tam: v.computed_tam, tam_override: v.tam_override, tam_override_reason: v.tam_override_reason, ...figures(v),
      som_limit: v.som_limit, horizon_months: v.horizon_months, writes_project: true,
      // A labelled version's base recomputes from its own estimates; an earlier one from its input rows.
      recomputes: estRows.length ? recomputesToStored(v, used('base')) : baseRecomputes,
      estimates: scenarioOut('base') },
  };
  for (const r of scenarioRows) {
    scenarios[r.scenario] = { ...r, writes_project: false,
      recomputes: recomputesToStored({ ...r, reference_year: v.reference_year, revenue_basis: v.revenue_basis ?? null }, used(r.scenario)),
      estimates: scenarioOut(r.scenario) };
  }
  const low = scenarioRows.find((r) => r.scenario === 'low');
  const high = scenarioRows.find((r) => r.scenario === 'high');
  const extra = { targetYear: v.reference_year == null ? null : String(v.reference_year), revenueBasis: v.revenue_basis ?? null };
  return {
    estimates,
    scenarios,
    order_flags: orderFlags({ base: figures(v), ...(low ? { low: figures(low) } : {}), ...(high ? { high: figures(high) } : {}) }),
    sensitivity: sensitivity({
      base: { inputs: used('base'), tamOverrideReason: v.tam_override_reason },
      ...(low ? { low: { inputs: used('low'), tamOverrideReason: low.tam_override_reason } } : {}),
      ...(high ? { high: { inputs: used('high'), tamOverrideReason: high.tam_override_reason } } : {}),
    }, extra),
  };
}

marketSizing.get('/projects/:projectId/versions', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const rows = await c.env.DB.prepare(
    `SELECT v.id, v.uid, v.version_number, v.formula_version, v.scenario, v.computed_tam, v.tam_override,
            v.tam_override_reason, v.tam, v.sam, v.som, v.som_limit, v.currency, v.reference_year, v.horizon_months, v.created_at,
            v.revenue_basis, v.top_down_tam, v.top_down_gap, u.name AS author_name
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

marketSizing.get('/projects/:projectId/versions/:uid/sensitivity', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  const version = await readVersion(c.env, found.project, String(c.req.param('uid') ?? ''));
  if (!version) return refuse(c, 404, { code: 'sizing_version_not_found', message: 'That sizing version was not found for this venture.' });
  return c.json({ version_uid: version.uid, sensitivity: version.sensitivity });
});

marketSizing.get('/projects/:projectId/superseded', async (c) => {
  const found = await editableProject(c);
  if ('error' in found) return found.error;
  return c.json({ superseded: await supersededSizingEvidence(c.env, found.project.id) });
});

export default marketSizing;
export const mount: RouteMount = { path: '/api/market-sizing', router: marketSizing };
