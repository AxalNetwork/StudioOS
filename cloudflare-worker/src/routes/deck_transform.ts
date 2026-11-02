/**
 * D1560 (#3807, deck v2 C12) — AI beyond one card.
 *
 *   POST /api/decks/:id/transform/quote
 *        { action, cards?, language? }
 *        → { action, option, ai: true, hold_microusd, model, warning? } | { action, option, ai: false, reason, message }
 *   POST /api/decks/:id/transform
 *        (the same body)
 *        → { proposal, action, option, cards: [{ card_uid, index, notes?, blocks? }], dropped, warning?, cost }
 *
 * `action` is `speaker_notes`, `proofread`, `fix_slide` (exactly one card in
 * `cards`) or `translate` (with a `language` from the assist list). `cards`
 * names card uids (or places); none means every card. `:id` is the saved
 * version (`pitch_decks.id`): the run reads the words that version holds.
 *
 * Each call is one run under its action's rail option (`TRANSFORM_OPTIONS`),
 * quoted and held as every run is (`quoteRun`, `run`), charged to the founder
 * who asked, and leaves one `ai_rail_proposals` row (D780). NOTHING IS SAVED:
 * Accept places the proposal in the editor, and Save writes the version.
 * What may be proposed, block by block, is `services/decks/transform.ts`'s
 * rule; a block that fails is listed in `dropped` with its reason.
 *
 * REFUSED BEFORE ANYTHING RUNS, so it costs nothing: an unknown action, a
 * fix with no card or more than one, a language outside the list, and a deck
 * with no words to work on (422 `nothing_to_change`).
 *
 * The frontend has no button for translation (S1's final canvas, #3807): the
 * per-area "in French" stays in the instruction box. The pipeline is here for
 * a whole-deck fork once an entry point is approved.
 *
 * Who: the deck's founders (`projectOwned` with `write`); an admin reads only.
 * Mounted in index.ts BEFORE `decks`, beside the other `/api/decks/*` routers.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { ASSIST_PAGE } from '../services/decks/assist';
import { parseJsonLoose } from '../services/decks/autofill';
import {
  TRANSFORM_ACTIONS, TRANSFORM_OPTIONS, cardsOf, hasWords, isLanguage, languageWarning, maxTokensFor, proposalsFrom, transformMessage,
  type CardWords, type TransformAction,
} from '../services/decks/transform';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned } from './decks';

const deckTransform = new Hono<{ Bindings: Env }>();

type Ask = { action: TransformAction; option: string; deckId: number; projectId: number; cards: CardWords[]; language?: string };

/** The ask a request makes, checked, or the response that refuses it. */
async function askOf(c: any, user: User): Promise<{ ask: Ask } | { refused: Response }> {
  const body = await c.req.json().catch(() => ({} as any));
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { refused: c.json({ error: 'deck id required' }, 400) };
  const action = String(body?.action || '') as TransformAction;
  if (!(TRANSFORM_ACTIONS as readonly string[]).includes(action)) return { refused: c.json({ error: `action must be one of ${TRANSFORM_ACTIONS.join(', ')}` }, 400) };
  const pick: string[] | null = Array.isArray(body?.cards)
    ? body.cards.filter((x: unknown) => (typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)) || Number.isInteger(x)).map(String).slice(0, 60)
    : null;
  if (action === 'fix_slide' && (!pick || pick.length !== 1)) return { refused: c.json({ error: 'fix_slide takes exactly one card' }, 400) };
  if (action === 'translate' && !isLanguage(body?.language)) return { refused: c.json({ error: 'language must be one of the assist languages' }, 400) };

  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  let slides: unknown = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  const cards = cardsOf(slides, pick);
  if (pick && !cards.length) return { refused: c.json({ error: 'cards must be cards of the deck. Save the deck, then ask again.' }, 400) };
  if (!hasWords(cards)) return { refused: refuse(c, 422, { code: 'nothing_to_change', message: 'These cards have no words of yours to work on. Nothing was run.' }) };
  return { ask: { action, option: TRANSFORM_OPTIONS[action], deckId, projectId, cards, ...(action === 'translate' ? { language: body.language } : {}) } };
}

/** The run one ask makes, so the quote and the run read the same input. */
function runOptions(c: any, user: User, a: Ask): RunOptions {
  const msg = transformMessage(a.action, a.cards, { language: a.language });
  const rail = { ...railFor(c, { page: ASSIST_PAGE, option: a.option }, `deck:${a.deckId}`), option: a.option };
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.raisePitch,
    rail,
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    temperature: a.action === 'proofread' || a.action === 'translate' ? 0.1 : 0.4,
    maxTokens: maxTokensFor(a.action, a.cards),
  };
}

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

const warningOf = (a: Ask) => {
  const w = a.action === 'translate' ? languageWarning(a.language) : null;
  return w ? { warning: w } : {};
};

deckTransform.post('/:id/transform/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await askOf(c, user);
  if ('refused' in got) return got.refused;
  const a = got.ask;
  const q = await quoteRun(c.env, runOptions(c, user, a));
  if (q.ok) return c.json({ action: a.action, option: a.option, ai: true, hold_microusd: q.hold_microusd, model: q.model, ...warningOf(a) });
  return c.json({ action: a.action, option: a.option, ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? 'AI assistance is off on this page.' : q.error });
});

deckTransform.post('/:id/transform', async (c) => {
  const user = await requireAuth(c);
  const got = await askOf(c, user);
  if ('refused' in got) return got.refused;
  const a = got.ask;
  const userId = Number(user.id) || 0;
  const opts = runOptions(c, user, a);
  const res = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail });
  if (!res.ok) {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
  }
  const cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };
  const made = proposalsFrom(a.action, parseJsonLoose<any>(res.output), a.cards);
  if (!made.cards.length) {
    return refuse(c, 422, { code: 'nothing_proposed', message: 'Eadwyn proposed no change that could be placed. It was charged for the run.', extra: { cost, dropped: made.dropped } });
  }
  const payload = { deck_id: a.deckId, action: a.action, ...(a.language ? { language: a.language } : {}), cards: made.cards, dropped: made.dropped };
  let proposal = null;
  try {
    proposal = await proposeRail(c.env, {
      userId, page: ASSIST_PAGE, option: a.option, record: `deck:${a.deckId}`, kind: 'proposal',
      payload, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
    });
  } catch {
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'Eadwyn answered, but the proposal could not be kept. It was charged for the run; try again in a moment.', extra: { cost } });
  }
  await auditDeckWrite(c, user, a.projectId, 'deck_transform_proposed', `${a.action} proposed on ${made.cards.length} card${made.cards.length === 1 ? '' : 's'}`);
  return c.json({ proposal, action: a.action, option: a.option, cards: made.cards, dropped: made.dropped, ...warningOf(a), cost });
});

export default deckTransform;
