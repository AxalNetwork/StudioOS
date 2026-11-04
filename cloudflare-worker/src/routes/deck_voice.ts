/**
 * D1569 (#3816, deck v2 D8) — an AI voice-over per card, always labelled "AI voice".
 *
 *   POST /api/decks/:id/cards/:card/voice/quote   → { ai: true, model, job, hold_microusd, chars, balance }
 *                                                   | { ai: false, reason, message }
 *   POST /api/decks/:id/cards/:card/voice         → { proposal, card_uid, model, label, chars, url, hold_microusd, charged_microusd }
 *        The card's script (its speaker notes) spoken by the voice job DK10,
 *        quoted and held first (`quoteRun`, `run`). The clip is stored in R2 as
 *        PENDING (`services/decks/cardAudio.ts`); one `ai_rail_proposals` row
 *        holds its key. Nothing on the deck changes.
 *   POST /api/decks/:id/voice/:proposal/accept    → { deck }: a new version whose card carries
 *        `voice: { key, model, label: 'AI voice' }`. The current version is the base; an older one answers 409.
 *   POST /api/decks/:id/voice/:proposal/discard   → { discarded: true }: the clip leaves R2, then the row is discarded.
 *   GET  /api/decks/:id/voice                     → { model: { id, name, label }, cards: [{ card_uid, url }] }
 *        The voice the rail's Voice group reads, and a short-lived link for each
 *        card of this version that carries an accepted voice-over (Present).
 *   GET  /api/decks/voice/:token                  → the clip (audio/mpeg). The token is signed by the
 *        Worker for one clip and an hour (`voiceLink`), so the share viewer plays only
 *        what a share read that passed every gate handed it.
 *
 * THE MODEL. Owner answer (2026-11-04): MeloTTS only, by name, checked by
 * `speechChoice` against DK10's own list; Aura comes later in its own change,
 * after decision P. The rail shows the model and offers no other (the Voice
 * group, `deckRailGroups.js`).
 *
 * Who: the deck's founders (`projectOwned` with `write`); a support session
 * may not speak as the member. A card with no script is refused before anything runs.
 * Mounted ahead of `decks`, whose `/:id` routes would otherwise take these paths.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { balanceRefusal } from '../services/aiImages';
import { MELOTTS } from '../services/ai/speechJobs';
import { MAX_SPEAK_CHARS } from '../services/ai/shapes';
import { modelById } from '../services/ai/catalogue';
import { ASSIST_PAGE } from '../services/decks/assist';
import { deckCeilingRefusal } from '../services/decks/observability';
import { VOICE_LABEL } from '../services/decks/slideModel';
import { MAX_CLIP_BYTES, VOICE_OPTION, deleteCardAudio, isAudioKey, keyOfProject, putCardAudio } from '../services/decks/cardAudio';
import { decideRail, getRail, proposeRail } from '../services/railProposals';
import { isSupportSession } from '../integrations/providers/mercury';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { auditDeckWrite, ensureSchema, getDeckRow, insertVersion, projectOwned, rowToDeck, themeOfRow, verifySignedToken, voiceLink } from './decks';

const deckVoice = new Hono<{ Bindings: Env }>();

/** The speech job a voice-over runs (`modelUseCases.ts`: "Voice-over and rehearsal narration"). */
export const VOICE_JOB = 'DK10';
/** The one voice for now (owner answer, 2026-11-04). */
export const VOICE_MODEL = MELOTTS;
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_UID = /^[A-Za-z0-9_-]{1,40}$/;
const NO_SCRIPT = { code: 'no_script', message: 'This card has no script to speak. Write its script (its speaker notes) first. Nothing was run.' };

type Opened = { deckId: number; projectId: number; row: any; slides: any[] };

/** The version, which the caller may write, with its cards; or the refusal. */
async function opened(c: any, user: User): Promise<Opened | Response> {
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  let slides: unknown;
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = null; }
  if (!Array.isArray(slides)) return refuse(c, 503, { code: 'unreadable', message: 'This deck could not be read. Nothing was changed.' });
  return { deckId, projectId, row, slides: slides as any[] };
}

/** The card named by uid, and the words it speaks (its script, trimmed); or the refusal. */
function cardOf(c: any, o: Opened): { index: number; uid: string; text: string } | Response {
  const uid = String(c.req.param('card') || '');
  if (!CARD_UID.test(uid)) return refuse(c, 400, { code: 'invalid_card', message: 'That card is not on this deck.' });
  const index = o.slides.findIndex((s: any) => s?.uid === uid);
  if (index < 0) return refuse(c, 404, { code: 'card_not_on_deck', message: 'That card is not on this deck. Reload, then try again.' });
  const text = typeof o.slides[index]?.notes === 'string' ? o.slides[index].notes.trim() : '';
  if (!text) return refuse(c, 422, NO_SCRIPT);
  if (text.length > MAX_SPEAK_CHARS) return refuse(c, 422, { code: 'script_too_long', message: `This card's script is longer than ${MAX_SPEAK_CHARS} characters, the most one voice-over speaks. Shorten it, then try again. Nothing was run.` });
  return { index, uid, text };
}

/** The voice run's options, so the quote and the run read the same input. */
function voiceRun(c: any, user: User, o: Opened, text: string): RunOptions {
  return {
    task: 'module_voice' as any,
    userId: Number(user.id) || 0,
    role: user.role,
    surface: AI_SURFACE.raisePitch,
    rail: { ...railFor(c, { page: ASSIST_PAGE, option: VOICE_OPTION }, `deck:${o.deckId}`), option: VOICE_OPTION },
    model: VOICE_MODEL,
    speechJob: VOICE_JOB,
    text,
    speak: {},
  };
}

/** Each card of a version with an accepted voice-over, and a link to play it. A card naming another venture's clip gets none. */
export async function voiceLinks(env: Env, slides: any[], projectId: number): Promise<Array<{ card_uid: string; url: string }>> {
  const out: Array<{ card_uid: string; url: string }> = [];
  for (const s of slides || []) {
    const url = s?.voice?.key ? await voiceLink(env, s.voice.key, projectId) : null;
    if (url && typeof s?.uid === 'string') out.push({ card_uid: s.uid, url });
  }
  return out;
}

const modelView = () => ({ id: VOICE_MODEL, name: modelById(VOICE_MODEL)?.name ?? null, label: VOICE_LABEL });

deckVoice.post('/:id{[0-9]+}/cards/:card/voice/quote', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const card = cardOf(c, o);
  if (card instanceof Response) return card;
  const q: any = await quoteRun(c.env, voiceRun(c, user, o, card.text));
  if (!q.ok) return c.json({ ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? 'AI assistance is off on this page.' : q.error });
  const short = await balanceRefusal(c.env, Number(user.id), q.hold_microusd);
  return c.json({
    ai: true, model: q.model, job: q.speech?.job ?? null, hold_microusd: q.hold_microusd, chars: card.text.length, label: VOICE_LABEL,
    balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true },
  });
});

deckVoice.post('/:id{[0-9]+}/cards/:card/voice', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot make a voice-over as this member.' });
  const card = cardOf(c, o);
  if (card instanceof Response) return card;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Voice-overs cannot be stored here yet. Nothing was run and nothing was charged.' });
  const userId = Number(user.id) || 0;
  const opts = voiceRun(c, user, o, card.text);
  const q: any = await quoteRun(c.env, opts);
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'The voice is not available. Nothing was run.' });
  const short = await balanceRefusal(c.env, userId, q.hold_microusd);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  const ceiling = await deckCeilingRefusal(c.env, Number(q.hold_microusd) || 0);
  if (ceiling) return refuse(c, 429, ceiling);

  const r: any = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail });
  if (!r.ok) return refuseRun(c, { refusal: r.refusal, error: r.error }) ?? refuse(c, 502, { code: 'model_failed', message: 'The voice could not be made. Try again in a moment.' });
  const audio = r.audio as { bytes: Uint8Array; mime: string } | undefined;
  if (!audio?.bytes?.byteLength || audio.mime !== 'audio/mpeg' || audio.bytes.byteLength > MAX_CLIP_BYTES) {
    return refuse(c, 502, { code: 'model_failed', message: 'The voice came back in a form that cannot be stored. Try again in a moment.' });
  }
  // Pending: stored, and named only by its proposal. The guard's 413 storage_full is thrown before the write.
  const clip = await putCardAudio(c.env, { projectId: o.projectId, kind: 'ai_voice', bytes: audio.bytes, mime: audio.mime, caller: user });
  const model = String(r.usage?.model ?? q.model ?? VOICE_MODEL);
  let proposal;
  try {
    proposal = await proposeRail(c.env, {
      userId, page: ASSIST_PAGE, option: VOICE_OPTION, record: `deck:${o.deckId}`, kind: 'proposal',
      payload: { action: 'voice', deck_id: o.deckId, version: Number(o.row.version) || null, card_uid: card.uid, key: clip.key, model, label: VOICE_LABEL, chars: card.text.length, bytes: clip.bytes },
      model, usageLogId: r.usageLogId ?? null,
    });
  } catch {
    // Without its row the clip would be nobody's: it leaves R2, and the member is told.
    await deleteCardAudio(c.env, clip.key);
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'The voice-over could not be kept for you to review. Try again.' });
  }
  const charged = r.usageLogId
    ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(r.usageLogId, userId).first<any>().catch(() => null)
    : null;
  await auditDeckWrite(c, user, o.projectId, 'deck_voice_proposed', `AI voice-over made for card ${card.index + 1}, not yet accepted`);
  return c.json({
    proposal: { uid: proposal.uid, status: proposal.status }, card_uid: card.uid, model, label: VOICE_LABEL, chars: card.text.length,
    url: await voiceLink(c.env, clip.key, o.projectId), hold_microusd: q.hold_microusd,
    charged_microusd: charged?.charged_microusd == null ? null : Number(charged.charged_microusd),
  }, 201);
});

/** The member's own pending voice-over on this deck, or the refusal. */
async function pendingOf(c: any, user: User, o: Opened) {
  const uid = String(c.req.param('proposal') || '');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const p = await getRail(c.env, Number(user.id) || 0, uid);
  if (!p || p.rail_option !== VOICE_OPTION || p.record_ref !== `deck:${o.deckId}`) return c.json({ error: 'not found' }, 404);
  if (p.status !== 'proposed') return refuse(c, 409, { code: 'already_decided', message: 'This voice-over was already decided.' });
  const key = p.payload?.key;
  if (!keyOfProject(key, o.projectId)) return c.json({ error: 'not found' }, 404);
  return { p, key: key as string };
}

deckVoice.post('/:id{[0-9]+}/voice/:proposal/accept', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const got = await pendingOf(c, user, o);
  if (got instanceof Response) return got;
  if (Number(o.row.is_current) !== 1) return refuse(c, 409, { code: 'version_conflict', message: 'A newer version of this deck was saved. Open it, then accept again.' });
  const cardUid = String(got.p.payload?.card_uid || '');
  const index = o.slides.findIndex((s: any) => s?.uid === cardUid);
  if (index < 0) return refuse(c, 409, { code: 'card_not_on_deck', message: 'That card is no longer on this deck. Discard the voice-over.' });
  const before = o.slides[index]?.voice?.key;
  const next = o.slides.map((s: any, i: number) => (i === index
    ? { ...s, voice: { key: got.key, model: String(got.p.payload?.model || VOICE_MODEL), label: VOICE_LABEL, chars: Number(got.p.payload?.chars) || undefined } }
    : { ...s }));
  let newId: number;
  try {
    newId = await insertVersion(c.env, o.projectId, next, o.row.title, Number(user.id) || null,
      { audience: o.row.audience ?? null, round_ref: o.row.round_ref ?? null, theme: themeOfRow(o.row) },
      { id: Number(o.row.id), version: Number(o.row.version) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  await decideRail(c.env, Number(user.id) || 0, got.p.uid, 'accept');
  // The clip it replaces stays: an earlier version still names it, and Restore brings it back.
  void before;
  await auditDeckWrite(c, user, o.projectId, 'deck_voice_accepted', `AI voice-over accepted on card ${index + 1}`);
  return c.json({ deck: rowToDeck(await getDeckRow(c.env, newId)) });
});

deckVoice.post('/:id{[0-9]+}/voice/:proposal/discard', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  const got = await pendingOf(c, user, o);
  if (got instanceof Response) return got;
  // The object first: a clip R2 keeps is not marked gone, so the daily cleanup tries again.
  if (!(await deleteCardAudio(c.env, got.key))) return refuse(c, 503, { code: 'storage_unavailable', message: 'The voice-over could not be deleted just now. Try again.' });
  await decideRail(c.env, Number(user.id) || 0, got.p.uid, 'discard');
  return c.json({ discarded: true });
});

deckVoice.get('/:id{[0-9]+}/voice', async (c) => {
  const user = await requireAuth(c);
  const o = await opened(c, user);
  if (o instanceof Response) return o;
  return c.json({ model: modelView(), cards: await voiceLinks(c.env, o.slides, o.projectId) });
});

deckVoice.get('/voice/:token', async (c) => {
  let payload: any;
  try { payload = await verifySignedToken(c.env, c.req.param('token')); } catch { return c.json({ error: 'not found' }, 404); }
  // Only a clip's own token plays: a share token (`deck:…`) or any other key is not a clip.
  if (!isAudioKey(payload?.k)) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.FILES?.get(payload.k);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' } });
});

export default deckVoice;
// Ahead of `decks`, whose `/:id` routes would otherwise take these paths.
export const mount: RouteMount = { path: '/api/decks', router: deckVoice, before: [decks] };
