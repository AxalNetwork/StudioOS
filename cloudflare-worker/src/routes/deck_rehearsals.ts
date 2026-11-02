/**
 * D1580 F1 (#3827) — rehearse a deck, and the report (pd38, pd39).
 *
 *   POST /api/decks/:id/rehearsals/quote  { pitch_seconds, model? }
 *        → { model, hold_microusd, minutes, balance }
 *        "Transcript · Holds up to $0.02 · you pay what it uses": the hold for
 *        the longest recording read (twice the pitch, at most ten minutes).
 *   POST /api/decks/:id/rehearsals        multipart: audio, pitch_seconds,
 *        duration_ms, marks (JSON [{ card, at_ms }]), model?
 *        → { rehearsal }  — one `transcribe` run through the router on the
 *        rail option `transcribe:rehearsal` (the member's pick in the AIRail),
 *        quoted and held, then the report worked out in code
 *        (`services/decks/rehearsal.ts`).
 *   GET  /api/decks/:id/rehearsals        → { deck_id, rehearsals: [summary] }
 *   GET  /api/decks/:id/rehearsals/:uid   → { rehearsal }
 *   PUT  /api/decks/:id/rehearsals/:uid/keep-audio { keep } → { rehearsal }
 *        Off deletes the audio now; on keeps it, while it is still held.
 *
 * Who: the founder, on a deck version they may write; a rehearsal is its
 * maker's alone, so a co-founder never reads another's. A support session may
 * not rehearse as the member. Every statement is bound.
 *
 * The audio is held in R2 only until the report has been read
 * (`services/rehearsalAudio.ts`); the transcript and the report stay.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, audioMinutesFromBytes, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { balanceRefusal } from '../services/aiImages';
import { CHUNK_MIME, MAX_CHUNK_BYTES } from '../services/interviewSessions';
import { IMAGE_PAGE } from '../services/decks/images';
import { MAX_DURATION_MS, PITCH_SECONDS, marksOf, rehearsalReport, type RehearsalReport } from '../services/decks/rehearsal';
import { audioDeleteAfter, deleteRehearsalAudio } from '../services/rehearsalAudio';
import { isSupportSession } from '../integrations/providers/mercury';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { getDeckRow, projectOwned } from './decks';

export const REHEARSE_PAGE = IMAGE_PAGE;
export const REHEARSE_OPTION = 'transcribe:rehearsal';
const UID = /^[0-9a-f-]{36}$/;
const LIST_MAX = 20;

const deckRehearsals = new Hono<{ Bindings: Env }>();

type Deck = { deckId: number; projectId: number; slides: unknown[] };

/** The deck version, which the caller may write, or the refusal. */
async function deckOf(c: any, user: User): Promise<Deck | Response> {
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return c.json({ error: 'deck id required' }, 400);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  if (await isSupportSession(c)) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot rehearse as this member.' });
  let slides: unknown[] = [];
  try { const parsed = JSON.parse(row.slides || '[]'); if (Array.isArray(parsed)) slides = parsed; } catch { slides = []; }
  return { deckId, projectId, slides };
}

const pitchOf = (v: unknown): number | null => {
  const n = Number(v);
  return (PITCH_SECONDS as readonly number[]).includes(n) ? n : null;
};
const PITCH_REFUSAL = { code: 'invalid_pitch_length', message: 'The pitch length is 2, 3 or 5 minutes.' };
const modelOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);

/** One run's options, so the quote and the run read the same input. */
function runOptions(c: any, user: User, deck: Deck, minutes: number, model?: string, audio?: { bytes: Uint8Array; mime: string }): RunOptions {
  const rail = { ...railFor(c, { page: REHEARSE_PAGE, option: REHEARSE_OPTION }, `deck:${deck.deckId}`), option: REHEARSE_OPTION };
  return {
    ...(model ? { model } : {}), task: 'transcribe', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch, rail,
    audioMinutes: minutes, ...(audio ? { audio: audio.bytes, audioMime: audio.mime } : {}),
  };
}

type Row = {
  id: number; uid: string; deck_id: number; pitch_seconds: number; duration_ms: number; status: string; report_json: string | null;
  transcript_json: string | null; model: string | null; charged_microusd: number | null; audio_r2_key: string | null; keep_audio: number;
  audio_delete_after: string | null; audio_deleted_at: string | null; created_at: string;
};

const audioState = (r: Row): 'kept' | 'held' | 'deleted' => (r.audio_r2_key ? (r.keep_audio ? 'kept' : 'held') : 'deleted');
const parse = <T,>(s: string | null): T | null => { try { return s ? JSON.parse(s) as T : null; } catch { return null; } };

function summary(r: Row) {
  const report = parse<RehearsalReport>(r.report_json);
  return {
    uid: r.uid, deck_id: Number(r.deck_id), pitch_seconds: Number(r.pitch_seconds), duration_ms: Number(r.duration_ms), status: r.status,
    time_line: report?.time_line ?? null, figures: report ? report.figures.length : null,
    audio: audioState(r), created_at: r.created_at,
  };
}
function whole(r: Row) {
  const transcript = parse<{ text?: string }>(r.transcript_json);
  return {
    ...summary(r), report: parse<RehearsalReport>(r.report_json), transcript: transcript?.text ?? null, model: r.model,
    charged_microusd: r.charged_microusd == null ? null : Number(r.charged_microusd),
    audio_delete_after: r.audio_r2_key && !r.keep_audio ? r.audio_delete_after : null, audio_deleted_at: r.audio_deleted_at,
  };
}

async function rowOf(env: Env, deckId: number, userId: number, uid: string): Promise<Row | null> {
  return env.DB.prepare('SELECT * FROM deck_rehearsals WHERE uid = ? AND deck_id = ? AND user_id = ?').bind(uid, deckId, userId).first<Row>();
}

deckRehearsals.post('/:id{[0-9]+}/rehearsals/quote', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => ({} as any));
  const pitch = pitchOf(body?.pitch_seconds);
  if (!pitch) return refuse(c, 400, PITCH_REFUSAL);
  const minutes = Math.min(MAX_DURATION_MS / 60_000, Math.ceil((pitch * 2) / 60));
  const q = await quoteRun(c.env, runOptions(c, user, deck, minutes, modelOf(body?.model)));
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Transcription is not available. Nothing was run.' });
  const short = await balanceRefusal(c.env, Number(user.id), q.hold_microusd);
  return c.json({ model: q.model, hold_microusd: q.hold_microusd, minutes, balance: short ? { ok: false, code: short.code, message: short.message } : { ok: true } });
});

deckRehearsals.post('/:id{[0-9]+}/rehearsals', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_unavailable', message: 'Rehearsals cannot be stored here yet. Nothing was run and nothing was charged.' });
  if (!deck.slides.length) return refuse(c, 422, { code: 'deck_empty', message: 'This version has no cards to rehearse.' });
  let form: FormData;
  try { form = await c.req.formData(); } catch { return refuse(c, 400, { code: 'invalid_body', message: 'Send the recording as a form.' }); }
  const pitch = pitchOf(form.get('pitch_seconds'));
  if (!pitch) return refuse(c, 400, PITCH_REFUSAL);
  const duration = Math.round(Number(form.get('duration_ms')));
  if (!Number.isFinite(duration) || duration < 1_000 || duration > MAX_DURATION_MS) {
    return refuse(c, 400, { code: 'invalid_duration', message: 'A rehearsal is between one second and ten minutes long.' });
  }
  let rawMarks: unknown = null;
  try { rawMarks = JSON.parse(String(form.get('marks') ?? '[]')); } catch { rawMarks = null; }
  const marks = marksOf(rawMarks, deck.slides.length, duration);
  if (!marks) return refuse(c, 400, { code: 'invalid_marks', message: 'The card changes could not be read. Nothing was run.' });
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') return refuse(c, 400, { code: 'audio_required', message: 'Record the rehearsal first.' });
  const mime = String((audio as File).type || '').split(';')[0].trim().toLowerCase();
  const ext = CHUNK_MIME[mime];
  if (!ext) return refuse(c, 415, { code: 'unsupported_audio', message: 'The recording is in a format that cannot be transcribed.' });
  const bytes = new Uint8Array(await (audio as File).arrayBuffer());
  if (!bytes.byteLength) return refuse(c, 400, { code: 'audio_required', message: 'The recording is empty.' });
  if (bytes.byteLength > MAX_CHUNK_BYTES) return refuse(c, 413, { code: 'audio_too_large', message: 'The recording is larger than 5 MB.' });

  const userId = Number(user.id);
  // The minutes charged are the longer of the stated length and the bytes' (the recorder runs at 32 kbps), so a short claim never underpays.
  const minutes = Math.max(1, Math.ceil(duration / 60_000), audioMinutesFromBytes(bytes.byteLength));
  const opts = runOptions(c, user, deck, minutes, modelOf(form.get('model')), { bytes, mime });
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return refuseRun(c, { refusal: q.refusal, error: q.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Transcription is not available. Nothing was run.' });
  const short = await balanceRefusal(c.env, userId, q.hold_microusd);
  if (short) return refuse(c, 402, { code: short.code, message: short.message });

  const uid = crypto.randomUUID();
  const key = `deck-rehearsals/${deck.projectId}/${uid}.${ext}`;
  try { await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } }); } catch {
    return refuse(c, 503, { code: 'storage_unavailable', message: 'The recording could not be stored. Nothing was run and nothing was charged.' });
  }
  const r = await run(c.env, { ...opts, surface: AI_SURFACE.raisePitch, rail: opts.rail });
  if (!r.ok) {
    await c.env.FILES.delete(key).catch(() => undefined);
    return refuseRun(c, { refusal: r.refusal, error: r.error }) ?? refuse(c, 503, { code: 'model_unavailable', message: 'The rehearsal could not be transcribed. Nothing was stored.' });
  }
  const segments = (r.transcript?.segments ?? []).map((s) => ({ start_ms: Number(s.start_ms) || 0, end_ms: Number(s.end_ms) || 0, text: String(s.text ?? '') }));
  const report = rehearsalReport({ pitchSeconds: pitch, durationMs: duration, marks, segments, slides: deck.slides });
  const charged = r.usageLogId
    ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(r.usageLogId, userId).first<any>().catch(() => null)
    : null;
  await c.env.DB.prepare(
    `INSERT INTO deck_rehearsals (uid, deck_id, project_id, user_id, pitch_seconds, duration_ms, status, card_marks_json, transcript_json, report_json,
       model, ai_usage_log_id, charged_microusd, audio_r2_key, audio_mime, keep_audio, audio_delete_after)
     VALUES (?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).bind(uid, deck.deckId, deck.projectId, userId, pitch, duration, JSON.stringify(marks),
    JSON.stringify({ text: r.transcript?.text ?? '', language: r.transcript?.language ?? null, segments }), JSON.stringify(report),
    r.usage?.model ?? q.model, r.usageLogId ?? null, charged?.charged_microusd == null ? null : Number(charged.charged_microusd),
    key, mime, audioDeleteAfter(new Date())).run();
  const row = await rowOf(c.env, deck.deckId, userId, uid);
  return c.json({ rehearsal: row ? whole(row) : null }, 201);
});

deckRehearsals.get('/:id{[0-9]+}/rehearsals', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const rows = await c.env.DB.prepare('SELECT * FROM deck_rehearsals WHERE deck_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(deck.deckId, Number(user.id), LIST_MAX).all<Row>();
  return c.json({ deck_id: deck.deckId, rehearsals: (rows.results || []).map(summary) });
});

deckRehearsals.get('/:id{[0-9]+}/rehearsals/:uid', async (c) => {
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const row = await rowOf(c.env, deck.deckId, Number(user.id), uid);
  return row ? c.json({ rehearsal: whole(row) }) : c.json({ error: 'not found' }, 404);
});

deckRehearsals.put('/:id{[0-9]+}/rehearsals/:uid/keep-audio', async (c) => {
  const uid = c.req.param('uid');
  if (!UID.test(uid)) return c.json({ error: 'not found' }, 404);
  const user = await requireAuth(c);
  const deck = await deckOf(c, user);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.keep !== 'boolean') return refuse(c, 400, { code: 'invalid_body', message: 'Say whether to keep the audio.' });
  const row = await rowOf(c.env, deck.deckId, Number(user.id), uid);
  if (!row) return c.json({ error: 'not found' }, 404);
  if (body.keep) {
    if (!row.audio_r2_key) return refuse(c, 409, { code: 'audio_deleted', message: 'The audio has already been deleted. The transcript and the report stay.' });
    await c.env.DB.prepare('UPDATE deck_rehearsals SET keep_audio = 1 WHERE id = ?').bind(row.id).run();
  } else {
    await c.env.DB.prepare('UPDATE deck_rehearsals SET keep_audio = 0 WHERE id = ?').bind(row.id).run();
    await deleteRehearsalAudio(c.env, row);
  }
  const fresh = await rowOf(c.env, deck.deckId, Number(user.id), uid);
  return c.json({ rehearsal: fresh ? whole(fresh) : null });
});

export default deckRehearsals;
