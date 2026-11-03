/**
 * D1590 (#3837, deck v2 F11) — the recorded walkthrough (pd36 "Record a pitch").
 *
 *   POST   /api/decks/:id/recordings/quote           { duration_ms } → { model, job, hold_microusd, minutes, balance }
 *   POST   /api/decks/:id/recordings                 form: card, duration_ms, media, audio?, model? → { take, walkthrough }
 *          A take of one card: the file in R2, its captions from the Listen job
 *          (WALKTHROUGH_CAPTIONS, the DK11 class, through run(): quoted, held,
 *          metered). A retake removes that card's earlier takes, never another card's.
 *   GET    /api/decks/:id/recordings                 → { deck_id, cards: [take | null], recorded, links: [share id] }
 *   GET    /api/decks/:id/recordings/:uid/media      → the take's file
 *   DELETE /api/decks/:id/recordings/:uid            → { deleted: true }; the R2 object goes, then the row
 *   PUT    /api/decks/:id/recordings/links/:shareId  { attach } → { links }: "Attach to [Fund]'s link"
 *
 * Who: the founder, on a deck version they may write. A walkthrough is its
 * maker's: a co-founder never reads another's takes. A support session may not
 * record as the member. HQ switches the feature (`deck:walkthrough`).
 *
 * Owner decision W = A: kept until its maker deletes it, or its deck or account
 * goes (`services/decks/recordings.ts`). A kept take counts against the
 * venture's storage plan (`deck_recordings` area).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { flagsFor, notSwitchedOn } from '../services/featureFlags';
import { quoteRun, run, audioMinutesFromBytes, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { balanceRefusal } from '../services/aiImages';
import { CHUNK_MIME, MAX_CHUNK_BYTES } from '../services/interviewSessions';
import { IMAGE_PAGE } from '../services/decks/images';
import { WALKTHROUGH_CAPTIONS, captionsOf } from '../services/ai/speechJobs';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import {
  MAX_MEDIA_BYTES, MAX_TAKE_MS, MEDIA_MIME, deleteTake, mediaKey, supersede, takeView, walkthroughOf, type TakeRow,
} from '../services/decks/recordings';
import { isSupportSession } from '../integrations/providers/mercury';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { getDeckRow, projectOwned } from './decks';

export const RECORD_PAGE = IMAGE_PAGE;
export const RECORD_OPTION = 'transcribe:walkthrough';
const UID = /^[0-9a-f-]{36}$/;

const deckRecordings = new Hono<{ Bindings: Env }>();

type Deck = { deckId: number; projectId: number; cards: number };

/** The deck version, which the caller may write, or the refusal. */
async function deckOf(c: any, user: User): Promise<Deck | Response> {
  if (!(await flagsFor(c.env, user)).on('deck:walkthrough')) return refuse(c, 404, notSwitchedOn);
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot record as this member.' });
  let cards = 0;
  try { const parsed = JSON.parse(row.slides || '[]'); if (Array.isArray(parsed)) cards = parsed.length; } catch { cards = 0; }
  return { deckId, projectId, cards };
}

const modelOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
const DURATION_REFUSAL = { code: 'invalid_duration', message: 'A take is between one second and three minutes long.' };
const durationOf = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1_000 && n <= MAX_TAKE_MS ? n : null;
};

/** The captions run's options, so the quote and the run read the same input. */
function captionOptions(c: any, user: User, deck: Deck, minutes: number, model?: string, audio?: { bytes: Uint8Array; mime: string }): RunOptions {
  const rail = { ...railFor(c, { page: RECORD_PAGE, option: RECORD_OPTION }, `deck:${deck.deckId}`), option: RECORD_OPTION };
  return {
    ...(model ? { model } : {}), task: 'transcribe', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch, rail,
    speechJob: WALKTHROUGH_CAPTIONS, audioMinutes: minutes, ...(audio ? { audio: audio.bytes, audioMime: audio.mime } : {}),
  };
}

async function takesOf(env: Env, deckId: number, userId: number): Promise<TakeRow[]> {
  return ((await env.DB.prepare('SELECT * FROM deck_recordings WHERE deck_id = ? AND user_id = ? ORDER BY card, take').bind(deckId, userId).all<TakeRow>()).results || []);
}
async function linksOf(env: Env, deckId: number, userId: number): Promise<number[]> {
  const rows = await env.DB.prepare('SELECT share_token_id FROM deck_recording_links WHERE deck_id = ? AND user_id = ? ORDER BY share_token_id')
    .bind(deckId, userId).all<{ share_token_id: number }>();
  return (rows.results || []).map((r) => Number(r.share_token_id));
}
async function takeOf(env: Env, deckId: number, userId: number, uid: string): Promise<TakeRow | null> {
  return env.DB.prepare('SELECT * FROM deck_recordings WHERE uid = ? AND deck_id = ? AND user_id = ?').bind(uid, deckId, userId).first<TakeRow>();
}

deckRecordings.post('/:id{[0-9]+}/recordings/quote', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => ({} as any));
  const duration = durationOf(body?.duration_ms ?? MAX_TAKE_MS);
  if (!duration) return refuse(c, 400, DURATION_REFUSAL);
  const minutes = Math.max(1, Math.ceil(duration / 60_000));
  const q = await quoteRun(c.env, captionOptions(c, user, deck, minutes, modelOf(body?.model)));
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Captions are not available. Nothing was run.' });
  const short = await balanceRefusal(c.env, Number(user.id), q.hold_microusd);
  // `job`: the Listen job that chose the model (DK11 for WALKTHROUGH_CAPTIONS), or null when no job did.
  return c.json({ model: q.model, job: q.speech?.job ?? null, hold_microusd: q.hold_microusd, minutes, balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true } });
});

deckRecordings.post('/:id{[0-9]+}/recordings', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Walkthroughs cannot be stored here yet. Nothing was run and nothing was charged.' });
  let form: FormData;
  try { form = await c.req.formData(); } catch { return refuse(c, 400, { code: 'invalid_body', message: 'Send the take as a form.' }); }
  const card = Math.round(Number(form.get('card')));
  if (!Number.isSafeInteger(card) || card < 1 || card > deck.cards) return refuse(c, 400, { code: 'invalid_card', message: 'That card is not in this version.' });
  const duration = durationOf(form.get('duration_ms'));
  if (!duration) return refuse(c, 400, DURATION_REFUSAL);

  const media = form.get('media');
  if (!media || typeof media === 'string') return refuse(c, 400, { code: 'media_required', message: 'Record the take first.' });
  const mediaMime = String((media as File).type || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIA_MIME[mediaMime];
  if (!ext) return refuse(c, 415, { code: 'unsupported_media', message: 'The take is in a format that cannot be stored.' });
  const mediaBytes = new Uint8Array(await (media as File).arrayBuffer());
  if (!mediaBytes.byteLength) return refuse(c, 400, { code: 'media_required', message: 'The take is empty.' });
  if (mediaBytes.byteLength > MAX_MEDIA_BYTES) return refuse(c, 413, { code: 'media_too_large', message: 'The take is larger than 40 MB. Record a shorter take.' });

  // The captions read the take's sound: its own audio track when the browser sent one, else the take when it is audio the model reads.
  const audioField = form.get('audio');
  let audio: { bytes: Uint8Array; mime: string } | null = null;
  if (audioField && typeof audioField !== 'string') {
    const mime = String((audioField as File).type || '').split(';')[0].trim().toLowerCase();
    if (!CHUNK_MIME[mime]) return refuse(c, 415, { code: 'unsupported_audio', message: 'The take\'s sound is in a format that cannot be captioned.' });
    audio = { bytes: new Uint8Array(await (audioField as File).arrayBuffer()), mime };
  } else if (CHUNK_MIME[mediaMime]) {
    audio = { bytes: mediaBytes, mime: mediaMime };
  }
  if (!audio || !audio.bytes.byteLength) return refuse(c, 400, { code: 'audio_required', message: 'The take has no sound to caption.' });
  if (audio.bytes.byteLength > MAX_CHUNK_BYTES) return refuse(c, 413, { code: 'audio_too_large', message: 'The take\'s sound is larger than 5 MB.' });

  const userId = Number(user.id);
  const minutes = Math.max(1, Math.ceil(duration / 60_000), audioMinutesFromBytes(audio.bytes.byteLength));
  const opts = captionOptions(c, user, deck, minutes, modelOf(form.get('model')), audio);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Captions are not available. Nothing was stored.' });
  const short = await balanceRefusal(c.env, userId, q.hold_microusd);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });
  // A take is kept until its maker deletes it, so it counts against the plan from the start (413 storage_full).
  const room = await assertStorageRoom(c.env, { projectId: deck.projectId }, mediaBytes.byteLength, user);

  const uid = crypto.randomUUID();
  const key = mediaKey(deck.projectId, uid, ext);
  try { await c.env.FILES.put(key, mediaBytes, { httpMetadata: { contentType: mediaMime } }); } catch {
    return refuse(c, 503, { code: 'storage_unavailable', message: 'The take could not be stored. Nothing was run and nothing was charged.' });
  }
  const r = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail });
  // A refusal the member must hear about stores nothing; a model that cannot be reached keeps the take, its captions Not recorded.
  if (!r.ok) {
    const answer = refuseRun(c, { refusal: r.refusal, error: r.error });
    if (answer) { await c.env.FILES.delete(key).catch(() => undefined); return answer; }
  }
  const captions = r.ok ? captionsOf(r.transcript) : null;
  const charged = r.ok && r.usageLogId
    ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(r.usageLogId, userId).first<any>().catch(() => null)
    : null;
  const next = await c.env.DB.prepare('SELECT COALESCE(MAX(take), 0) + 1 AS take FROM deck_recordings WHERE deck_id = ? AND user_id = ? AND card = ?')
    .bind(deck.deckId, userId, card).first<{ take: number }>();
  await c.env.DB.prepare(
    `INSERT INTO deck_recordings (uid, deck_id, project_id, user_id, card, take, duration_ms, media_r2_key, media_mime, media_bytes,
       captions_json, caption_model, ai_usage_log_id, charged_microusd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, deck.deckId, deck.projectId, userId, card, Number(next?.take) || 1, duration, key, mediaMime, mediaBytes.byteLength,
    captions ? JSON.stringify(captions) : null, r.ok ? (r.usage?.model ?? q.model) : null, r.ok ? (r.usageLogId ?? null) : null,
    charged?.charged_microusd == null ? null : Number(charged.charged_microusd)).run();
  // The retake replaces this card's earlier takes; every other card's stay.
  await supersede(c.env, deck.deckId, userId, card, uid);
  await noteStorageLanded(c.env, room);
  const row = await takeOf(c.env, deck.deckId, userId, uid);
  return c.json({ take: row ? takeView(row) : null, walkthrough: walkthroughOf(await takesOf(c.env, deck.deckId, userId), deck.cards) }, 201);
});

deckRecordings.get('/:id{[0-9]+}/recordings', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const userId = Number(user.id);
  return c.json({ deck_id: deck.deckId, ...walkthroughOf(await takesOf(c.env, deck.deckId, userId), deck.cards), links: await linksOf(c.env, deck.deckId, userId) });
});

deckRecordings.get('/:id{[0-9]+}/recordings/:uid{[0-9a-f-]{36}}/media', async (c) => {
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const row = await takeOf(c.env, deck.deckId, Number(user.id), uid);
  const obj = row ? await c.env.FILES?.get(row.media_r2_key) : null;
  if (!row || !obj) return c.json({ error: 'not found' }, 404);
  return new Response(obj.body, { headers: { 'content-type': row.media_mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
});

deckRecordings.delete('/:id{[0-9]+}/recordings/:uid{[0-9a-f-]{36}}', async (c) => {
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const row = await takeOf(c.env, deck.deckId, Number(user.id), uid);
  if (!row) return c.json({ error: 'not found' }, 404);
  // W = A: the delete removes the stored file, then the row. A file that could not be deleted keeps its row, so it is never lost track of.
  if (!(await deleteTake(c.env, row))) return refuse(c, 503, { code: 'storage_unavailable', message: 'The take could not be deleted. Try again.' });
  return c.json({ deleted: true });
});

deckRecordings.put('/:id{[0-9]+}/recordings/links/:shareId{[0-9]+}', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const shareId = Number(c.req.param('shareId'));
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.attach !== 'boolean') return refuse(c, 400, { code: 'invalid_body', message: 'Say whether to attach the walkthrough: { "attach": true }.' });
  const userId = Number(user.id);
  if (body.attach) {
    // A link of this version that has not been withdrawn or run out.
    const link = await c.env.DB.prepare(
      "SELECT id FROM pitch_deck_share_tokens WHERE id = ? AND deck_id = ? AND (revoked_at IS NULL) AND datetime(expires_at) > datetime('now')",
    ).bind(shareId, deck.deckId).first<{ id: number }>().catch(() => null);
    if (!link) return c.json({ error: 'not found' }, 404);
    const recorded = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM deck_recordings WHERE deck_id = ? AND user_id = ?').bind(deck.deckId, userId).first<{ n: number }>();
    if (!Number(recorded?.n)) return refuse(c, 409, { code: 'nothing_recorded', message: 'Record at least one card before attaching the walkthrough.' });
    await c.env.DB.prepare('INSERT INTO deck_recording_links (share_token_id, deck_id, user_id) VALUES (?, ?, ?) ON CONFLICT(share_token_id) DO NOTHING')
      .bind(shareId, deck.deckId, userId).run();
  } else {
    await c.env.DB.prepare('DELETE FROM deck_recording_links WHERE share_token_id = ? AND deck_id = ? AND user_id = ?').bind(shareId, deck.deckId, userId).run();
  }
  return c.json({ links: await linksOf(c.env, deck.deckId, userId) });
});

export const mount: RouteMount = { path: '/api/decks', router: deckRecordings, before: [decks] };
export default deckRecordings;
