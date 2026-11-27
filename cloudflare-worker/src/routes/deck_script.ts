/**
 * D4268 (#4268, D4254 P2a) — Script & rehearsal › Script: the whole-deck
 * script, card by card, and its notes-only save.
 *
 *   POST /api/decks/:id/script/quote
 *        { length_s?, audience?, tone?, cards? }
 *        → { ai: true, hold_microusd, model, count, length_s, pace: { wpm, source, rehearsal_at, pitch_seconds },
 *            targets: [{ card_uid, index, budget_s, target_words }] }
 *          | { ai: false, reason, message }
 *   POST /api/decks/:id/script   (the same body; `Idempotency-Key` optional)
 *        → { proposal, deck_id, version, length_s, audience, tone, pace,
 *            cards: [{ card_uid, index, budget_s, target_words, notes, words, model }],
 *            failed: [{ card_uid, index, reason }], hold_microusd, charged_microusd, stopped? }
 *   PUT  /api/decks/:id/notes-script   { notes: [{ card_uid, notes }] }   (`If-Match: <version>` optional)
 *        → { deck, saved } | { unchanged: true, deck_id }
 *
 * THE RUN. `length_s` is 120, 180 or 300 (default 180), `audience` is
 * investor_meeting, demo_day or partner, `tone` is clear, warm or bold.
 * Each card's budget is the pitch length split across every card of the
 * deck (Rehearse's split); its word target is that budget at the pace of the
 * founder's latest rehearsal of this venture's deck, or 150 words a minute
 * (`services/decks/script.ts`). `cards` (card uids or places) narrows the run,
 * so Regenerate this card is the same call with one card; the budgets stay
 * the whole deck's.
 *
 * ONE QUOTE, SETTLED PER CARD. The quote is the sum of each card's own run.
 * The press takes ONE hold of that sum, runs each card under it as its own
 * run on the rail option `deck:notes` (the same pick as the editor's speaker
 * notes), and settles the hold once at what the placed cards cost. A card
 * whose draft names a figure not on its card, adds a link or is empty fails:
 * it is listed in `failed`, and its run is settled at zero. A card the model
 * could not answer fails the same way. A refusal that stops every card (a
 * budget, the kill switch, AI off) ends the run there (`stopped`), with what
 * was written so far. One `ai_rail_proposals` row keeps the drafts (D780).
 * NOTHING IS SAVED: the Script tab places each draft as "Not saved", and
 * Save script calls the notes-only save.
 *
 * THE SAVE. Only `notes` change: the version's own cards are copied with each
 * named card's notes replaced (an empty string clears them), and ONE version
 * is written, as the editor's save writes one. A card not on the deck, or
 * notes over 4,000 characters, are refused and nothing is written. A version
 * that is no longer the current one answers the version conflict (409).
 *
 * Who: the deck's founders (`projectOwned` with `write`). Mounted ahead of
 * `decks`, whose `/:id` routes would otherwise take these paths.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { reserveAiBudget, settleAiReservation } from '../services/aiBudget';
import { ASSIST_PAGE } from '../services/decks/assist';
import { parseJsonLoose } from '../services/decks/autofill';
import { deckCeilingRefusal } from '../services/decks/observability';
import {
  DEFAULT_LENGTH, DEFAULT_WPM, cardBudgetsS, figuresOf, isAudience, isLength, isTone, paceOf, scriptFrom, scriptMaxTokens, scriptMessage,
  wordTarget, type ScriptAudience, type ScriptCard, type ScriptLength, type ScriptTone,
} from '../services/decks/script';
import { NOTES_MAX } from '../services/decks/slideModel';
import { TRANSFORM_OPTIONS, cardsOf } from '../services/decks/transform';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, projectOwned, rowToDeck, themeOfRow, versionConflictBody } from './decks';

const deckScript = new Hono<{ Bindings: Env }>();

export const SCRIPT_OPTION = TRANSFORM_OPTIONS.speaker_notes;

/** Refusals that are one card's alone: the card fails and the run goes on. Any other refusal stops the run. */
const CARD_REFUSALS = new Set(['safety_block', 'all_models_failed', 'guard_unavailable', 'guard_blocked', 'guard_blocked_output', 'invalid_input']);

type Opened = { deckId: number; projectId: number; row: any; slides: any[] };
type Pace = { wpm: number; source: 'rehearsal' | 'default'; rehearsal_at: string | null; pitch_seconds: number | null };
type Ask = Opened & { length: ScriptLength; audience: ScriptAudience; tone: ScriptTone; pace: Pace; cards: ScriptCard[]; skipped: ScriptCard[] };

/** The version the editor opened, which the caller may write, with its cards read; or the refusal. */
async function opened(c: any, user: User): Promise<Opened | Response> {
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  // The stored cards as they are, so a save changes their notes and nothing else.
  // Cards that cannot be read are refused, never scripted or saved as an empty deck.
  let slides: unknown;
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = null; }
  if (!Array.isArray(slides)) return refuse(c, 503, { code: 'unreadable', message: 'This deck could not be read. Nothing was changed.' });
  return { deckId, projectId, row, slides: slides as any[] };
}

/** The pace: the founder's latest reported rehearsal of this venture's deck, or the default. */
export async function paceFor(env: Env, projectId: number, userId: number): Promise<Pace> {
  try {
    const r = await env.DB.prepare(
      `SELECT report_json, created_at, pitch_seconds FROM deck_rehearsals
        WHERE project_id = ? AND user_id = ? AND status = 'reported'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).bind(projectId, userId).first<{ report_json: string | null; created_at: string; pitch_seconds: number }>();
    const wpm = r ? paceOf(r.report_json) : null;
    if (wpm != null) return { wpm, source: 'rehearsal', rehearsal_at: r!.created_at, pitch_seconds: isLength(r!.pitch_seconds) ? Number(r!.pitch_seconds) : null };
  } catch { /* no rehearsal store: the default pace */ }
  return { wpm: DEFAULT_WPM, source: 'default', rehearsal_at: null, pitch_seconds: null };
}

async function askOf(c: any, user: User): Promise<Ask | Response> {
  const body = await c.req.json().catch(() => ({} as any));
  const length = body?.length_s == null ? DEFAULT_LENGTH : Number(body.length_s);
  if (!isLength(length)) return c.json({ error: 'length_s must be 120, 180 or 300' }, 400);
  const audience = body?.audience == null ? 'investor_meeting' : body.audience;
  if (!isAudience(audience)) return c.json({ error: 'audience must be investor_meeting, demo_day or partner' }, 400);
  const tone = body?.tone == null ? 'clear' : body.tone;
  if (!isTone(tone)) return c.json({ error: 'tone must be clear, warm or bold' }, 400);
  const pick: string[] | null = Array.isArray(body?.cards)
    ? body.cards.filter((x: unknown) => (typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)) || Number.isInteger(x)).map(String).slice(0, 60)
    : null;
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const pace = await paceFor(c.env, o.projectId, Number(user.id) || 0);
  const budgets = cardBudgetsS(length, o.slides.length);
  const all: ScriptCard[] = cardsOf(o.slides, pick).map((w) => ({
    ...w, figures: figuresOf(o.slides[w.index]), budget_s: budgets[w.index], target_words: wordTarget(budgets[w.index], pace.wpm),
  }));
  if (pick && !all.length) return c.json({ error: 'cards must be cards of the deck. Save the deck, then ask again.' }, 400);
  const cards = all.filter((x) => x.title || x.blocks.length || x.figures.length);
  if (!cards.length) return refuse(c, 422, { code: 'nothing_to_change', message: 'These cards have no words of yours to script. Nothing was run.' });
  return { ...o, length, audience, tone, pace, cards, skipped: all.filter((x) => !cards.includes(x)) };
}

/** One card's run, so the quote and the press read the same input. */
function cardRun(c: any, user: User, a: Ask, card: ScriptCard): RunOptions {
  const msg = scriptMessage(card, { audience: a.audience, tone: a.tone });
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.raisePitch,
    rail: { ...railFor(c, { page: ASSIST_PAGE, option: SCRIPT_OPTION }, `deck:${a.deckId}`), option: SCRIPT_OPTION },
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    temperature: 0.5,
    maxTokens: scriptMaxTokens(card),
  };
}

const targetOf = (x: ScriptCard) => ({ card_uid: x.uid, index: x.index, budget_s: x.budget_s, target_words: x.target_words });

/** The one quote: each card's run, summed. */
async function quoteOf(c: any, user: User, a: Ask): Promise<{ ok: true; hold: number; model: string | null } | { ok: false; refusal: string; error?: string }> {
  let hold = 0;
  let model: string | null = null;
  for (const card of a.cards) {
    const q: any = await quoteRun(c.env, cardRun(c, user, a, card));
    if (!q.ok) return { ok: false, refusal: q.refusal, error: q.error };
    hold += Number(q.hold_microusd) || 0;
    model = model ?? q.model ?? null;
  }
  return { ok: true, hold, model };
}

deckScript.post('/:id{[0-9]+}/script/quote', async (c) => {
  const user = await requireAuth(c);
  const a = await askOf(c, user);
  if (a instanceof Response) return a;
  const q = await quoteOf(c, user, a);
  if (!q.ok) return c.json({ ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? 'AI assistance is off on this page.' : q.error });
  return c.json({ ai: true, hold_microusd: q.hold, model: q.model, count: a.cards.length, pace: a.pace, length_s: a.length, targets: a.cards.map(targetOf) });
});

deckScript.post('/:id{[0-9]+}/script', async (c) => {
  const user = await requireAuth(c);
  const a = await askOf(c, user);
  if (a instanceof Response) return a;
  const userId = Number(user.id) || 0;
  const q = await quoteOf(c, user, a);
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'The script could not be quoted. Nothing was run.' });
  // D1510: the owner's daily ceiling, before the one hold.
  const ceiling = await deckCeilingRefusal(c.env, q.hold);
  if (ceiling) return refuse(c, 429, ceiling);
  const key = c.req.header('Idempotency-Key');
  const idem = typeof key === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(key) ? `deck-script:${a.deckId}:${key}` : null;
  // The one hold refuses a balance that cannot cover it (402) before any card runs.
  const held = await reserveAiBudget(c.env, userId, q.hold, new Date(), { idempotencyKey: idem });
  if (!held.ok) return refuseRun(c, { refusal: held.refusal, error: 'The script could not be held.' }) ?? refuse(c, 402, { code: 'hold_refused', message: 'The script could not be held. Nothing was run.' });
  if ('replayed' in held && held.replayed) return refuse(c, 409, { code: 'already_pressed', message: 'This script was already generated. Its drafts are in the results.' });
  const parent = held.reservation;
  const placed: any[] = [];
  const failed: Array<{ card_uid: string | null; index: number; reason: string }> = a.skipped.map((x) => ({ card_uid: x.uid, index: x.index, reason: 'no_words' }));
  let stopped: { code: string; message: string } | null = null;
  let charged = 0;
  try {
    for (const card of a.cards) {
      const opts = cardRun(c, user, a, card);
      const res: any = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail, parentHold: parent });
      const ref = { card_uid: card.uid, index: card.index };
      if (!res.ok) {
        if (res.refusal && !CARD_REFUSALS.has(res.refusal)) {
          stopped = { code: String(res.refusal), message: res.refusal === 'assist_off' ? 'AI assistance is off on this page.' : 'The script stopped before every card was written. What it wrote is below.' };
          break;
        }
        failed.push({ ...ref, reason: 'model_failed' });
        continue;
      }
      const got = scriptFrom(parseJsonLoose<any>(res.output), card);
      if (!got.ok) {
        // A draft that cannot be placed costs nothing: its run is settled at zero under the one hold.
        if (res.usageLogId) {
          await c.env.DB.prepare('UPDATE ai_usage_logs SET charged_microusd = 0 WHERE id = ? AND user_id = ? AND reservation_uid = ?')
            .bind(res.usageLogId, userId, parent.uid).run();
        }
        failed.push({ ...ref, reason: got.reason });
        continue;
      }
      placed.push({ ...targetOf(card), notes: got.notes, words: got.words, model: res.usage?.model ?? null });
    }
  } finally {
    // The one hold settles once, at what the placed cards cost.
    const sum = await c.env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS c FROM ai_usage_logs WHERE reservation_uid = ? AND user_id = ?')
      .bind(parent.uid, userId).first<{ c: number }>();
    charged = Number(sum?.c ?? 0);
    await settleAiReservation(c.env, parent, charged, charged === 0);
  }
  const about = { deck_id: a.deckId, version: Number(a.row.version) || null, length_s: a.length, audience: a.audience, tone: a.tone, pace: a.pace };
  let proposal = null;
  if (placed.length) {
    try {
      proposal = await proposeRail(c.env, {
        userId, page: ASSIST_PAGE, option: SCRIPT_OPTION, record: `deck:${a.deckId}`, kind: 'proposal',
        payload: { ...about, action: 'script', cards: placed, failed }, model: placed[0].model, usageLogId: null,
      });
    } catch { /* the drafts are still returned; the proposal row is the record, not the delivery */ }
  }
  await auditDeckWrite(c, user, a.projectId, 'deck_script_proposed', `Script drafted for ${placed.length} card${placed.length === 1 ? '' : 's'}, ${failed.length} failed`);
  return c.json({ proposal, ...about, cards: placed, failed, hold_microusd: q.hold, charged_microusd: charged, ...(stopped ? { stopped } : {}) });
});

const revOf = (v: string) => {
  const m = /^\s*"?(\d{1,9})"?\s*$/.exec(v);
  return m ? Number(m[1]) : null;
};

deckScript.put('/:id{[0-9]+}/notes-script', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const list = Array.isArray(body?.notes) ? body.notes : null;
  if (!list || !list.length || list.length > 60) return c.json({ error: 'notes must list between 1 and 60 cards' }, 400);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const ifMatch = c.req.header('if-match');
  if (ifMatch != null) {
    const rev = revOf(ifMatch);
    if (rev == null) return c.json({ error: 'invalid_if_match', code: 'invalid_if_match', message: 'If-Match must be the version you edited, a whole number.' }, 400);
    if (rev !== Number(o.row.version) || Number(o.row.is_current) !== 1) return c.json(await versionConflictBody(c.env, o.projectId), 409);
  }
  const byUid = new Map<string, number>();
  o.slides.forEach((s: any, i: number) => { if (typeof s?.uid === 'string') byUid.set(s.uid, i); });
  const next = o.slides.map((s: any) => ({ ...s }));
  let changed = 0;
  for (const item of list) {
    const i = byUid.get(String(item?.card_uid ?? ''));
    if (i == null) return refuse(c, 400, { code: 'card_not_on_deck', message: 'A card in this script is not on the deck. Reload, then save again. Nothing was saved.' });
    if (typeof item?.notes !== 'string') return c.json({ error: 'notes must be text' }, 400);
    if (item.notes.length > NOTES_MAX) return refuse(c, 400, { code: 'notes_too_long', message: `Card ${i + 1}: the script is longer than ${NOTES_MAX} characters. Nothing was saved.` });
    const notes = item.notes.trim();
    const before = typeof next[i].notes === 'string' ? next[i].notes.trim() : '';
    if (notes === before) continue;
    if (notes) next[i].notes = notes; else delete next[i].notes;
    changed += 1;
  }
  if (!changed) return c.json({ unchanged: true, deck_id: o.deckId });
  let newId: number;
  try {
    // The opened version is the base: a newer version answers the conflict, never notes over old cards.
    newId = await insertVersion(c.env, o.projectId, next, o.row.title, Number(user.id) || null,
      { audience: o.row.audience ?? null, round_ref: o.row.round_ref ?? null, theme: themeOfRow(o.row) },
      { id: Number(o.row.id), version: Number(o.row.version) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  await auditDeckWrite(c, user, o.projectId, 'deck_script_saved', `Script saved on ${changed} card${changed === 1 ? '' : 's'}`);
  return c.json({ deck: rowToDeck(await getDeckRow(c.env, newId)), saved: changed });
});

export default deckScript;
// Ahead of `decks`, whose `/:id` routes would otherwise take these paths.
export const mount: RouteMount = { path: '/api/decks', router: deckScript, before: [decks] };
