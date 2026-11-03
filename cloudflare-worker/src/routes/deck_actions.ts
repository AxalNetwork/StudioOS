/**
 * D1561 (#3808, deck v2 C13) — the ⋯ menu's whole-deck actions.
 *
 *   POST /api/decks/:id/reorder-for-stage    { stage?, investor_type? }
 *        → { deck, stage, stage_label, stage_source, moved, one_undo_step: true }
 *          | { unchanged: true, deck_id, stage, stage_label, stage_source, moved: 0 }
 *        The cards in D1522's stage-plan order, saved as ONE new version (one
 *        undo step). Every card is kept; a card the plan does not know moves
 *        with the card before it (`reorderForStage`). Already in order: nothing
 *        is written. Free: no model, no charge. A version that is no longer
 *        the current one answers the version conflict (409), never a
 *        reordered copy of old cards.
 *   POST /api/decks/:id/check/wording/quote
 *        → { ai: true, hold_microusd, model } | { ai: false, reason, message }
 *   POST /api/decks/:id/check/wording
 *        → { deck_id, version, state: 'ok', findings: [{ key, kind, label, card_uid,
 *            card_index, quote, message, action }], dropped, cost }
 *          | { state: 'off', message }
 *        pd25's charged "Check wording": one run under `deck:wording`, charged
 *        only when pressed. A finding is shown only when its quote is on its
 *        card word for word (`wordingFindings`). An empty list is the answer
 *        "The wording reads as supported."
 *
 * Who: the venture's deck writers (`projectOwned` with `write`): the reorder
 * writes a version, and the wording run is charged to the founder who
 * pressed. Each writes one `raise.pitch-deck` activity row, never a figure
 * or a quote. Mounted ahead of `decks`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { ASSIST_PAGE } from '../services/decks/assist';
import { parseJsonLoose } from '../services/decks/autofill';
import { stagePlan } from '../services/decks/stagePlan';
import { AUDIENCES } from '../services/decks/slideModel';
import { stageFrom } from '../services/narrative/arcs';
import { WORDING_OPTION, WORDING_SYSTEM, reorderForStage, wordingCards, wordingFindings, wordingMessage } from '../services/decks/deckActions';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, projectOwned, rowToDeck, sanitizeSlides, themeOfRow } from './decks';
import { mercuryFor } from './deck_sources';

const deckActions = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

type Opened = { deckId: number; projectId: number; row: any; project: any; slides: any[] };

/** The version the editor opened, which the caller may write, with its cards read; or the refusal. */
async function opened(c: any, user: User): Promise<Opened | Response> {
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  let project: any;
  try { project = await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  let slides: any[];
  // Cards that cannot be read are refused, never reordered or checked as an empty deck.
  try { slides = sanitizeSlides(JSON.parse(row.slides || '[]')); }
  catch { return refuse(c, 503, { code: 'unreadable', message: 'This deck could not be read. Nothing was changed.' }); }
  return { deckId, projectId, row, project, slides };
}

deckActions.post('/:id{[0-9]+}/reorder-for-stage', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const stage = body?.stage == null || body.stage === '' ? null : String(body.stage);
  if (stage && !stageFrom(stage)) return c.json({ error: 'stage must be one of pre_seed, seed, series_a, series_b_plus' }, 400);
  const investorType = body?.investor_type == null || body.investor_type === '' ? null : String(body.investor_type);
  if (investorType && !(AUDIENCES as readonly string[]).includes(investorType)) return c.json({ error: `investor_type must be one of ${AUDIENCES.join(', ')}` }, 400);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const deck = rowToDeck(o.row);
  const plan = await stagePlan(c.env, {
    projectId: o.projectId, slides: o.slides, audience: deck.audience, stage, investorType,
    mercury: await mercuryFor(c, user, o.project ?? { founder_id: null, company_id: null }), today: today(),
  });
  const r = reorderForStage(o.slides, plan.order.map((x) => x.card));
  const about = { stage: plan.stage, stage_label: plan.stage_label, stage_source: plan.stage_source };
  if (r.moved === 0) return c.json({ unchanged: true, deck_id: o.deckId, ...about, moved: 0 });
  let newId: number;
  try {
    // The opened version is the base: a newer version answers the conflict, never a reordered copy of old cards.
    newId = await insertVersion(c.env, o.projectId, r.slides as any[], o.row.title, Number(user.id) || null,
      { audience: o.row.audience ?? null, round_ref: o.row.round_ref ?? null, theme: themeOfRow(o.row) },
      { id: Number(o.row.id), version: Number(o.row.version) });
  } catch (e) { if (e instanceof Response) return e; throw e; }
  await auditDeckWrite(c, user, o.projectId, 'deck_reordered_for_stage', `Cards ordered for ${plan.stage_label}: ${r.moved} moved`);
  return c.json({ deck: rowToDeck(await getDeckRow(c.env, newId)), ...about, moved: r.moved, one_undo_step: true });
});

function wordingRun(c: any, user: User, o: Opened): RunOptions {
  const rail = { ...railFor(c, { page: ASSIST_PAGE, option: WORDING_OPTION }, `deck:${o.deckId}`), option: WORDING_OPTION };
  return {
    task: 'rail_reason', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch, rail,
    systemPrompt: WORDING_SYSTEM, messages: [{ role: 'user', content: wordingMessage(wordingCards(o.slides)) }],
    temperature: 0.2, maxTokens: 1200,
  };
}

const AI_OFF = 'AI assistance is off on this page. The figure and consistency checks still show.';

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

deckActions.post('/:id{[0-9]+}/check/wording/quote', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const q = await quoteRun(c.env, { ...wordingRun(c, user, o), surface: AI_SURFACE.raisePitch });
  if (!q.ok) return c.json({ ai: false, reason: q.refusal ?? 'model_unavailable', message: q.refusal === 'assist_off' ? AI_OFF : q.error });
  return c.json({ ai: true, hold_microusd: q.hold_microusd, model: q.model });
});

deckActions.post('/:id{[0-9]+}/check/wording', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const userId = Number(user.id) || 0;
  const opts = wordingRun(c, user, o);
  const res = await run(c.env, { ...opts, rail: opts.rail, surface: AI_SURFACE.raisePitch });
  if (!res.ok) {
    if (res.refusal === 'assist_off') return c.json({ deck_id: o.deckId, state: 'off', message: AI_OFF });
    const stop = refuseRun(c, res);
    return stop ?? refuse(c, 503, { code: 'model_unavailable', message: 'The wording check could not run. Nothing was charged.' });
  }
  const got = wordingFindings(parseJsonLoose<any>(res.output), wordingCards(o.slides));
  await auditDeckWrite(c, user, o.projectId, 'deck_wording_checked', `v${Number(o.row.version) || 1}: ${got.findings.length} wording finding${got.findings.length === 1 ? '' : 's'}`);
  return c.json({
    deck_id: o.deckId, version: Number(o.row.version) || null, state: 'ok', findings: got.findings, dropped: got.dropped,
    cost: { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null },
  });
});

// Ahead of `decks`, whose `/:id` routes would otherwise take these paths.
export const mount: RouteMount = { path: '/api/decks', router: deckActions, before: [decks] };

export default deckActions;
