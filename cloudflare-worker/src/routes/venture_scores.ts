/**
 * D1256 (#3279, part 3 of #2428) — the venture scorecard's routes.
 *
 *   GET  /api/venture-scores/models                      → model v1 and the stored versions (any signed-in member)
 *   GET  /api/venture-scores/weights                     → the caller's "Your weighting" (investor, Operating Partner, Admin)
 *   PUT  /api/venture-scores/weights                     → set it, or `null` for equal
 *   POST /api/venture-scores/batch                       → the deal list's strip: state, band and confidence per scope
 *   GET  /api/venture-scores/fairness                    → the latest quarterly fairness check (Super Admin)
 *   GET  /api/venture-scores/deal/:dealId                → an investor's read, by the visibility rule, logged
 *   GET  /api/venture-scores/:projectId                  → founder, Operating Partner, Admin, a shared advisor
 *   POST /api/venture-scores/:projectId/recompute        → founder, Operating Partner, Admin
 *   PUT  /api/venture-scores/:projectId/scopes/:scope/review → Operating Partner, Admin: a note, or ±15 points with a reason
 *   POST /api/venture-scores/:projectId/corrections      → the founder's "Ask to correct"
 *   GET  /api/venture-scores/:projectId/sharing          → the founder's switch and advisors
 *   PUT  /api/venture-scores/:projectId/sharing          → change them
 *   GET  /api/venture-scores/:projectId/trajectory       → D1258: each scope's stored rows by model version (founder, Operating Partner, Admin)
 *
 * The rule of who reads what is `services/ventureScoring/access.ts`; the
 * scores are `services/ventureScoring/store.ts`'s (D1255). No route accepts a
 * value, band, confidence or grade, and none sets a deal or venture status.
 * Publishing a model version (`POST /models/:id/publish`) waits for HQ's
 * page (part 6): model v1 is code, frozen per scope on its first stored row.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { userReadableDealIds } from './deals';
import { PMF_MODEL_V1 } from '../services/scoring/pmf';
import { SCOPE_ORDER, VENTURE_MODEL_V1 } from '../services/ventureScoring/model';
import { liveModel, scoreVenture, storedScorecard, type StoredScope } from '../services/ventureScoring/store';
import { riskLayers, withRiskLayers } from '../services/ventureScoring/riskLayers';
import { latestFairness } from '../services/ventureScoring/jobs';
import {
  BATCH_MAX, ScoreError, askCorrection, dealProject, hasNda, investorOnDeal, investorView, investorsMaySee, isFounderOf, isScope,
  isStaff, latestReviews, listCorrections, logScorecard, parseReview, parseWeights, readSharing, readTrajectory, readWeights, saveReview, stripView,
  ventureRow, viewerOf, writeSharing, writeWeights, type Viewer,
} from '../services/ventureScoring/access';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);
const roleOf = (u: User) => String(u.role || '').toLowerCase();
const LOCKED_REASON = 'The founder has not shared this scorecard with investors.';

/** A ScoreError is our sentence; anything else is a failed read, never its text. */
function fail(c: C, e: unknown, what = 'The scorecard') {
  if (e instanceof ScoreError) {
    // ScoreError carries only the service's authored refusal sentences.
    const { code, message, status } = e;
    return refuse(c, status, { code, message });
  }
  return refuse(c, 503, { code: 'scorecard_unreadable', message: `${what} could not be read. That is not the same as none. Try again.`, raw: e });
}

function id(v: string | undefined): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : NaN;
}

/** Attaches each scope's latest review to the scope it reviews. */
function withReviews<T extends { scope: string }>(scopes: T[], reviews: Record<string, unknown>) {
  return scopes.map((s) => ({ ...s, review: reviews[s.scope] ?? null }));
}

/** The full read for a founder, Operating Partner, Admin or shared advisor. */
async function fullRead(c: C, user: User, project: { id: number; founder_id: number | null }, viewer: Viewer, dealId: number | null = null) {
  if (viewer === 'advisor') {
    const stored = await storedScorecard(c.env, project.id, { inputs: true });
    const reviews = await latestReviews(c.env, project.id, stored);
    await logScorecard(c.env, { projectId: project.id, userId: user.id, action: 'venture_score_read',
      details: { viewer, scopes: stored.length, deal_id: dealId, masked: false }, role: 'advisor' });
    // D1260: Risk's sub-rows, the ten layers' analyst reviews, without the analysts' notes.
    const layers = await riskLayers(c.env, project.id, { notes: false });
    return c.json({ project_id: project.id, viewer, read_only: true, model: VENTURE_MODEL_V1.version, scopes: withRiskLayers(withReviews(stored, reviews), layers) });
  }
  const result = await scoreVenture(c.env, project.id, { actorId: user.id, trigger: 'read', today: today() });
  const stored = await storedScorecard(c.env, project.id, { inputs: true });
  const reviews = await latestReviews(c.env, project.id, stored);
  // D1260: Risk's sub-rows; the analysts' notes are studio staff's only.
  const layers = await riskLayers(c.env, project.id, { notes: viewer === 'staff' });
  const body: Record<string, unknown> = {
    project_id: project.id, viewer, read_only: false, model: result.model, stage: result.stage,
    scopes: withRiskLayers(withReviews(result.scopes, reviews), layers),
    corrections: await listCorrections(c.env, project.id),
  };
  if (viewer === 'founder') {
    body.sharing = await readSharing(c.env, project.id);
    // "What investors see": the same masking an investor's read gets, before and after an NDA.
    body.investor_preview = { before_nda: investorView(stored, reviews, false), after_nda: withRiskLayers(investorView(stored, reviews, true), layers) };
  } else {
    await logScorecard(c.env, { projectId: project.id, userId: user.id, action: 'venture_score_read',
      details: { viewer, scopes: result.scopes.length, deal_id: dealId, masked: false }, role: roleOf(user) });
  }
  return c.json(body);
}

// ── Static paths first ──────────────────────────────────────────────────────

r.get('/models', async (c) => {
  await requireAuth(c);
  try {
    const stored = await c.env.DB.prepare('SELECT scope, version, published_at FROM scoring_model_versions ORDER BY scope, version')
      .all<{ scope: string; version: string; published_at: string }>();
    // D1260: the method is the model in force, with when it was published. v1.0 scored before any publication was recorded.
    const m = await liveModel(c.env);
    const pub = await c.env.DB.prepare('SELECT published_at FROM venture_model_publications WHERE version = ? ORDER BY id DESC LIMIT 1')
      .bind(m.version).first<{ published_at: string | null }>();
    return c.json({
      live: { version: m.version, published_at: pub?.published_at ?? null, default_live: !pub },
      version: m.version, floor: m.floor, confidence: m.confidence, bands: m.bands, freshness_days: m.freshness_days,
      order: SCOPE_ORDER,
      scopes: SCOPE_ORDER.map((k) => (k === 'pmf'
        ? { scope: 'pmf', label: 'Product-market fit', defined_by: 'D1143', inputs: PMF_MODEL_V1.inputs.map((i) => ({ key: i.key, label: i.label, weight: i.weight })) }
        : { scope: k, label: m.scopes[k].label, not_expected_at: m.scopes[k].not_expected_at,
          inputs: m.scopes[k].inputs.map((i) => ({ key: i.key, label: i.label, weight: i.weight, freshness: i.freshness, reads: i.reads,
            source: i.source, personal: Boolean(i.personal) })) })),
      stored: stored.results || [],
      publish: 'Model versions are published from HQ › Scoring (part 6). Model v1 is frozen per scope on its first stored row.',
    });
  } catch (e) { return fail(c, e, 'The scoring model'); }
});

const WEIGHT_ROLES = new Set(['investor', 'admin', 'partner']);

r.get('/weights', async (c) => {
  const user = await requireAuth(c);
  if (!WEIGHT_ROLES.has(roleOf(user))) return refuse(c, 403, { code: 'no_weighting', message: 'Your weighting is for investors and studio staff.' });
  try { return c.json(await readWeights(c.env, user.id)); } catch (e) { return fail(c, e, 'Your weighting'); }
});

r.put('/weights', async (c) => {
  const user = await requireAuth(c);
  if (!WEIGHT_ROLES.has(roleOf(user))) return refuse(c, 403, { code: 'no_weighting', message: 'Your weighting is for investors and studio staff.' });
  const body = await c.req.json().catch(() => ({}));
  try {
    const weights = parseWeights(body);
    const out = await writeWeights(c.env, user.id, weights);
    return c.json({ ...out, note: 'Your weighting changes your sort only. It never changes a venture’s score.' });
  } catch (e) { return fail(c, e, 'Your weighting'); }
});

r.post('/batch', async (c) => {
  const user = await requireAuth(c);
  const role = roleOf(user);
  if (role !== 'investor' && !isStaff(user)) return refuse(c, 403, { code: 'no_access', message: 'The deal list’s scorecards are for investors and studio staff.' });
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body?.deal_ids) ? [...new Set(body.deal_ids.map(Number))] as number[] : null;
  if (!ids || ids.length > BATCH_MAX || ids.some((n) => !Number.isSafeInteger(n) || n < 1)) {
    return refuse(c, 400, { code: 'bad_deals', message: `Send up to ${BATCH_MAX} deal ids.` });
  }
  try {
    const readable = await userReadableDealIds(c.env, user, ids);
    const items = [];
    for (const dealId of ids) {
      if (!readable.has(dealId)) continue;
      const projectId = await dealProject(c.env, dealId);
      if (projectId == null) continue;
      if (role === 'investor' && !(await investorsMaySee(c.env, projectId)).on) {
        items.push({ deal_id: dealId, project_id: projectId, locked: true, reason: LOCKED_REASON });
        continue;
      }
      try {
        const stored = await storedScorecard(c.env, projectId);
        items.push({ deal_id: dealId, project_id: projectId, locked: false, scopes: stripView(stored) });
        await logScorecard(c.env, { projectId, userId: user.id, action: 'venture_score_read',
          details: { viewer: role === 'investor' ? 'investor' : 'staff', scopes: stored.length, deal_id: dealId, masked: true, batch: true }, role });
      } catch {
        items.push({ deal_id: dealId, project_id: projectId, locked: false, unreadable: true });
      }
    }
    return c.json({ items, not_readable: ids.filter((n) => !readable.has(n)).length });
  } catch (e) { return fail(c, e, 'The deal list’s scorecards'); }
});

r.get('/fairness', async (c) => {
  await requireSuperAdmin(c);
  try {
    const run = await latestFairness(c.env);
    return c.json(run ? { run } : { run: null, reason: 'The first quarterly fairness check has not run yet. It runs on the first day of each quarter.' });
  } catch (e) { return fail(c, e, 'The fairness check'); }
});

r.get('/deal/:dealId', async (c) => {
  const user = await requireAuth(c);
  const dealId = id(c.req.param('dealId'));
  try {
    const projectId = Number.isNaN(dealId) ? null : await dealProject(c.env, dealId);
    if (projectId == null) return refuse(c, 404, { code: 'not_found', message: 'No such deal.' });
    const project = await ventureRow(c.env, projectId);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (roleOf(user) !== 'investor') {
      const viewer = await viewerOf(c.env, user, project);
      if (!viewer) return refuse(c, 403, { code: 'no_access', message: 'You cannot read this scorecard.' });
      return await fullRead(c, user, project, viewer, dealId);
    }
    // Owner question 1 A: an investor off the deal reads nothing.
    if (!(await investorOnDeal(c.env, user.id, dealId))) {
      return refuse(c, 403, { code: 'not_on_deal', message: 'The scorecard opens once you are invited to this deal or committed on it.' });
    }
    if (!(await investorsMaySee(c.env, projectId)).on) {
      await logScorecard(c.env, { projectId, userId: user.id, action: 'venture_score_read',
        details: { viewer: 'investor', scopes: 0, deal_id: dealId, masked: true, locked: true }, role: 'investor' });
      return c.json({ project_id: projectId, deal_id: dealId, locked: true, reason: LOCKED_REASON });
    }
    const nda = await hasNda(c.env, projectId, user.id);
    const stored: StoredScope[] = await storedScorecard(c.env, projectId, { inputs: nda });
    const reviews = await latestReviews(c.env, projectId, stored);
    await logScorecard(c.env, { projectId, userId: user.id, action: 'venture_score_read',
      details: { viewer: 'investor', scopes: stored.length, deal_id: dealId, masked: !nda }, role: 'investor' });
    return c.json({
      project_id: projectId, deal_id: dealId, locked: false, nda, model: VENTURE_MODEL_V1.version,
      masked_reason: nda ? null : 'Sign the NDA with this venture to see its inputs.',
      // D1260: after the NDA, Risk carries the ten layers' analyst reviews, never a note; before it, none.
      scopes: withRiskLayers(investorView(stored, reviews, nda), nda ? await riskLayers(c.env, projectId, { notes: false }) : null),
    });
  } catch (e) { return fail(c, e); }
});

// ── One venture ─────────────────────────────────────────────────────────────

async function venture(c: C) {
  const projectId = id(c.req.param('projectId'));
  return Number.isNaN(projectId) ? null : ventureRow(c.env, projectId);
}

r.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (roleOf(user) === 'investor') return refuse(c, 403, { code: 'read_through_deal', message: 'Investors read a scorecard through a deal they are on.' });
    const viewer = await viewerOf(c.env, user, project);
    if (!viewer) return refuse(c, 403, { code: 'no_access', message: 'You cannot read this scorecard.' });
    return await fullRead(c, user, project, viewer);
  } catch (e) { return fail(c, e); }
});

r.post('/:projectId/recompute', async (c) => {
  const user = await requireAuth(c);
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (!isStaff(user) && !(await isFounderOf(c.env, user, project))) {
      return refuse(c, 403, { code: 'no_access', message: 'Only the founder or studio staff can re-score a venture.' });
    }
    const result = await scoreVenture(c.env, project.id, { actorId: user.id, trigger: 'rescore', today: today() });
    return c.json({ project_id: project.id, ...result, changed: result.scopes.filter((s) => s.changed).length });
  } catch (e) { return fail(c, e); }
});

r.put('/:projectId/scopes/:scope/review', async (c) => {
  const user = await requireAuth(c);
  if (!isStaff(user)) return refuse(c, 403, { code: 'no_access', message: 'Reviews are for Operating Partners and Admins.' });
  const scope = c.req.param('scope');
  if (!isScope(scope)) return refuse(c, 400, { code: 'bad_scope', message: 'Choose one of the eleven scopes.' });
  const body = await c.req.json().catch(() => ({}));
  try {
    const review = parseReview(body);
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    const stored = (await storedScorecard(c.env, project.id)).find((s) => s.scope === scope)!;
    return c.json(await saveReview(c.env, user, project.id, scope, stored, review), 201);
  } catch (e) { return fail(c, e); }
});

r.post('/:projectId/corrections', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (!(await isFounderOf(c.env, user, project))) return refuse(c, 403, { code: 'no_access', message: 'Only the venture’s founders can ask to correct an input.' });
    return c.json(await askCorrection(c.env, user, project.id, body), 201);
  } catch (e) { return fail(c, e); }
});

// D1258 (SC12): the trajectory across model versions. The founder's own read is not logged; staff's is.
r.get('/:projectId/trajectory', async (c) => {
  const user = await requireAuth(c);
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    const founder = await isFounderOf(c.env, user, project);
    if (!founder && !isStaff(user)) return refuse(c, 403, { code: 'no_access', message: 'The trajectory is for the venture’s founders and studio staff.' });
    const out = await readTrajectory(c.env, project.id);
    if (!founder) {
      await logScorecard(c.env, { projectId: project.id, userId: user.id, action: 'venture_score_read',
        details: { viewer: 'staff', scopes: out.scopes.length, deal_id: null, masked: false, trajectory: true }, role: roleOf(user) });
    }
    return c.json({ project_id: project.id, ...out });
  } catch (e) { return fail(c, e, 'The trajectory'); }
});

r.get('/:projectId/sharing', async (c) => {
  const user = await requireAuth(c);
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (!(await isFounderOf(c.env, user, project))) return refuse(c, 403, { code: 'no_access', message: 'Only the venture’s founders choose who sees its scorecard.' });
    return c.json(await readSharing(c.env, project.id));
  } catch (e) { return fail(c, e, 'Sharing'); }
});

r.put('/:projectId/sharing', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  try {
    const project = await venture(c);
    if (!project) return refuse(c, 404, { code: 'not_found', message: 'No such venture.' });
    if (!(await isFounderOf(c.env, user, project))) return refuse(c, 403, { code: 'no_access', message: 'Only the venture’s founders choose who sees its scorecard.' });
    return c.json(await writeSharing(c.env, user, project.id, body));
  } catch (e) { return fail(c, e, 'Sharing'); }
});

export default r;
