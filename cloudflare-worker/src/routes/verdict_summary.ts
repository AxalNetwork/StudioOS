/**
 * D6862 (#6862, D6021 V17/V18) — Eadwyn reads the evidence offered for one
 * decision on Record a decision. #5130's rail task system is not on `main`,
 * so this is the Worker endpoint the page's task card calls.
 *
 *   POST /api/cycles/validate/decision-summary/quote?project=:pid
 *        { for: 'venture'|'h-<id>', evidence: [key…] }
 *        → { ai: true, hold_microusd, model } | { ai: false, reason, message }
 *   POST /api/cycles/validate/decision-summary?project=:pid
 *        { for, evidence }
 *        → { rows: [{ key, group, text, reason, from_label }], keys, coverage, change, usage }
 *
 * The founder's own, in person (`ownsVenture`, no support session): an admin
 * may record a decision but runs no model on the founder's allowance. The
 * rows, their groups and what would change the decision are the server's
 * (`services/verdictSummary.ts`); the model writes one line per row and never
 * a choice. Nothing is stored.
 *
 * Refusals: 401; 400 bad `project` or body; 404 venture, hypothesis or
 * evidence; 403 not the founder or a support session; 409 `no_evidence`;
 * 403 `assist_off`, 402 a budget stop and 422/503 the guard, each in its own
 * words (`refuseRun`); 503 when the model could not be reached or its reply
 * could not be matched, with nothing charged on the first.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { ownsVenture, type ProjectRef } from './_founder_validate_helpers';
import { VerdictError, type EvidenceSource, type Scope } from '../services/verdict';
import { parseSummary, summaryBody, summaryFacts, summaryPrompt, summarySystem, SUMMARY_OPTION, SUMMARY_PAGE, type SummaryFacts } from '../services/verdictSummary';
import { run as aiRun, quoteRun, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { railFor, refuseRun, runRefusalView } from '../util/railContext';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';

type Runner = typeof aiRun;
type Quoter = typeof quoteRun;

function scopeOf(v: unknown): Scope | null {
  if (v === 'venture') return 'venture';
  const m = /^h-([1-9][0-9]{0,9})$/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
}

/** The founder, the venture and the checked rows counted, or the refusal. */
async function inputs(c: Context<{ Bindings: Env }>, evidenceSource?: EvidenceSource): Promise<{ user: User; facts: SummaryFacts } | Response> {
  let user: User;
  try { user = (await requireAuth(c)) as User; } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to continue.' }); }
  const raw = String(c.req.query('project') ?? '');
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return refuse(c, 400, { code: 'project_required', message: 'Choose a venture first.' });
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(Number(raw)).first<ProjectRef>();
  if (!project) return refuse(c, 404, { code: 'project_not_found', message: 'Venture not found.' });
  if (!ownsVenture(project, user)) return refuse(c, 403, { code: 'forbidden', message: 'Eadwyn reads a decision’s evidence for the venture’s founder.' });
  if ((await selectJwt(c))?.payload.impersonated_by) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'Eadwyn does not run inside a support session. Nothing was run.' });
  }
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return refuse(c, 400, { code: 'body_invalid', message: 'The body must be a JSON object.' });
  const scope = scopeOf(b.for);
  if (scope === null) return refuse(c, 400, { code: 'for_invalid', message: "for must be 'venture' or 'h-<id>'." });
  try {
    return { user, facts: await summaryFacts(c.env, project.id, scope, b.evidence, { evidenceSource }) };
  } catch (e) {
    if (e instanceof VerdictError) return refuse(c, e.status, { code: e.code ?? 'refused', message: e.sentence });
    return refuse(c, 503, { code: 'evidence_unreadable', message: 'The evidence could not be read. Nothing was run, and nothing was charged.', raw: e });
  }
}

function runOptions(c: Context<{ Bindings: Env }>, user: User, facts: SummaryFacts): RunOptions {
  return {
    task: 'workspace_explain',
    userId: Number(user.id),
    systemPrompt: summarySystem(),
    messages: [{ role: 'user', content: summaryPrompt(facts) }],
    maxTokens: 900,
    temperature: 0.1,
    surface: AI_SURFACE.validateVerdict,
    rail: railFor(c, { page: SUMMARY_PAGE, option: SUMMARY_OPTION }),
  };
}

type Deps = { runner: Runner; quoter: Quoter; evidenceSource?: EvidenceSource };
const LIVE: Deps = { runner: aiRun, quoter: quoteRun };

/** The quoted hold before Send (V18 A): the same inputs and builder as the run; runs, holds and writes nothing. */
async function quote(c: Context<{ Bindings: Env }>, deps: Deps): Promise<Response> {
  const s = await inputs(c, deps.evidenceSource);
  if (s instanceof Response) return s;
  const q = await deps.quoter(c.env, runOptions(c, s.user, s.facts));
  if (!q.ok) {
    const view = runRefusalView(q);
    return c.json({ ai: false, reason: view?.code ?? q.refusal, message: view?.message ?? 'The hold for this read could not be worked out. Nothing was run.' });
  }
  return c.json({ ai: true, hold_microusd: q.hold_microusd, model: q.model });
}

/** The read: rows citing one checked evidence key each, grouped by the server. */
async function summarise(c: Context<{ Bindings: Env }>, deps: Deps): Promise<Response> {
  const s = await inputs(c, deps.evidenceSource);
  if (s instanceof Response) return s;
  const opts = runOptions(c, s.user, s.facts);
  const r = await deps.runner(c.env, { ...opts, task: opts.task, surface: opts.surface, rail: opts.rail });
  const refused = refuseRun(c, r);
  if (refused) return refused;
  if (!r.ok) return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not be reached. Nothing was run, and nothing was charged.', raw: r.error });
  const rows = parseSummary(r.output, s.facts);
  if (!rows) return refuse(c, 503, { code: 'summary_unmatched', message: 'Eadwyn\u2019s reading could not be matched to the evidence. Try again.' });
  return c.json({ ...summaryBody(rows, s.facts), usage: { model: r.usage.model, est_cost_usd: r.usage.est_cost_usd } });
}

/** The same routes over a stub model and evidence reader, for tests. */
export function createVerdictSummaryRouter(deps: Partial<Deps> = {}) {
  const d: Deps = { ...LIVE, ...deps };
  const router = new Hono<{ Bindings: Env }>();
  router.post('/quote', (c) => quote(c, d));
  router.post('/', (c) => summarise(c, d));
  return router;
}

// Explicit routes on the mounted router, so the auth inventory and the API drift scanner read them.
const verdictSummary = new Hono<{ Bindings: Env }>();
verdictSummary.post('/quote', (c) => quote(c, LIVE));
verdictSummary.post('/', (c) => summarise(c, LIVE));
export default verdictSummary;

export const mount: RouteMount = { path: '/api/cycles/validate/decision-summary', router: verdictSummary };
