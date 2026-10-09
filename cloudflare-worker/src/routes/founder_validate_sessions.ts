/**
 * D657 — interview sessions on Validate: record, transcribe live and in full,
 * mark, review, delete. Mounted on `/api/founder/validate` beside
 * `founder_validate.ts`, whose paths it does not share.
 *
 *   GET    /sessions/models                 the live and final speech-to-text models, priced
 *   POST   /interviews/:id/sessions         open a session on an interview
 *   GET    /interviews/:id/sessions         the interview's sessions
 *   GET    /sessions/:id                    one session: segments, marks, chunks
 *   PATCH  /sessions/:id/consent            record consent to record
 *   POST   /sessions/:id/{start,pause,resume,stop}
 *   PUT    /sessions/:id/chunks/:seq        one audio chunk, idempotent by seq
 *   POST   /sessions/:id/marks              mark a moment
 *   GET    /sessions/:id/live               WebSocket: the live transcript
 *   POST   /sessions/:id/transcribe         the final transcript
 *   PATCH  /sessions/:id/segments/:segId    assign a passage's speaker
 *   GET    /sessions/:id/receipt            what each job cost, and the budget left
 *   DELETE /sessions/:id                    the session, its audio and its transcript
 *
 * A session belongs to a `discovery_interviews` row, so a Spin-Out Lab
 * venture's interviews (ordinary `projects` rows) get sessions with no
 * Lab-specific code. Every route but the model list is gated on `canWrite`,
 * the venture's own founder or an admin: a session holds a recording of
 * someone else's voice, so nobody reads it who could not write it.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite, type ProjectRef } from './_founder_validate_helpers';
import { run as aiRun, audioMinutesFromBytes, budgetRefusalMessage, estimateCostUsd } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import * as aiBudget from '../services/aiBudget';
import {
  AUDIO_CHANNELS, AUDIO_PREFIX, CHANNELS, CHUNK_MIME, CONSENT, CONSENT_METHODS, MAX_CHUNK_BYTES, MAX_CHUNKS,
  TRANSITIONS, consentBlocks, deleteSession, labelSegments, listChunks, loadSession, putChunk, recordReceipt,
  replaceWithFinal, transition, type SessionRow, type StoredSegment,
} from '../services/interviewSessions';
import { DEFAULT_FINAL_MODEL, DEFAULT_LIVE_MODEL, isChoosable, listSttModels } from '../services/sttModels';
import { WHISPER_TURBO } from '../services/sttFormats';
import { holdBlock, openLiveRelay } from '../services/liveTranscription';

const sessions = new Hono<{ Bindings: Env }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
});
const notFound = (what: string) => json({ detail: `${what} not found` }, 404);

type Owner = { id: number; project_id: number; interviewee_name: string | null };

/** The interview, its project and the caller, or the Response that refuses them. */
async function scopeInterview(c: any, interviewId: number): Promise<{ user: User; interview: Owner } | Response> {
  if (!Number.isSafeInteger(interviewId) || interviewId <= 0) return json({ detail: 'Invalid interview id' }, 400);
  const user = (await requireAuth(c)) as User;
  const interview = await c.env.DB.prepare(
    'SELECT id, project_id, interviewee_name FROM discovery_interviews WHERE id = ?',
  ).bind(interviewId).first() as Owner | null;
  if (!interview) return notFound('Interview');
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(interview.project_id).first() as ProjectRef | null;
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return json({ detail: 'Forbidden' }, 403);
  return { user, interview };
}

/** The session, its interview and the caller, or the refusal. */
async function scopeSession(c: any): Promise<{ user: User; session: SessionRow; interview: Owner } | Response> {
  const session = await loadSession(c.env, Number(c.req.param('id')));
  if (!session) {
    await requireAuth(c);
    return notFound('Session');
  }
  const s = await scopeInterview(c, session.interview_id);
  if (s instanceof Response) return s;
  return { ...s, session };
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

// ---------------------------------------------------------------------------
// The model list
// ---------------------------------------------------------------------------

sessions.get('/sessions/models', async (c) => {
  await requireAuth(c);
  return json(listSttModels());
});

// ---------------------------------------------------------------------------
// Opening a session
// ---------------------------------------------------------------------------

/**
 * Text chat and manual entry record no audio: their messages arrive with the
 * request and become `final` segments at once, each with its author and time.
 */
function messagesToSegments(raw: unknown): StoredSegment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: StoredSegment[] = [];
  for (const m of raw.slice(0, 2000)) {
    const body = text(m?.text, 8000);
    if (!body) continue;
    const at = Number(m?.at_ms);
    out.push({
      start_ms: Number.isSafeInteger(at) && at >= 0 ? at : null,
      end_ms: null,
      speaker_label: text(m?.author, 80) || 'Speaker ?',
      speaker_raw: null,
      text: body,
    });
  }
  return out;
}

sessions.post('/interviews/:id/sessions', async (c) => {
  const s = await scopeInterview(c, Number(c.req.param('id')));
  if (s instanceof Response) return s;
  const body = await c.req.json<any>().catch(() => ({}));

  const channel = String(body?.channel || '');
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    return json({ detail: 'invalid_channel', accepted: CHANNELS }, 400);
  }
  const audio = AUDIO_CHANNELS.has(channel);

  const consent = audio ? String(body?.consent?.status || 'not_recorded') : 'not_recorded';
  if (!(CONSENT as readonly string[]).includes(consent)) return json({ detail: 'invalid_consent', accepted: CONSENT }, 400);
  const method = consent === 'given' ? String(body?.consent?.method || '') : '';
  if (consent === 'given' && !(CONSENT_METHODS as readonly string[]).includes(method)) {
    return json({ detail: 'consent_method_required', accepted: CONSENT_METHODS }, 400);
  }

  // `live_model: null` is "Live transcript off": no socket, no cost.
  let liveModel: string | null = null;
  let finalModel: string | null = null;
  if (audio) {
    liveModel = body?.live_model === null ? null : String(body?.live_model || DEFAULT_LIVE_MODEL);
    if (liveModel && !isChoosable(liveModel, 'live')) return json({ detail: 'model_not_offered', model: liveModel, kind: 'live' }, 400);
    finalModel = String(body?.final_model || DEFAULT_FINAL_MODEL);
    if (!isChoosable(finalModel, 'final')) return json({ detail: 'model_not_offered', model: finalModel, kind: 'final' }, 400);
  }

  const messages = audio ? null : messagesToSegments(body?.messages);
  const uid = crypto.randomUUID();
  const ins = await c.env.DB.prepare(
    `INSERT INTO interview_sessions
       (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
        live_model, final_model)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, CASE WHEN ? = 'given' THEN datetime('now') END, ?, ?)`,
  ).bind(uid, s.interview.id, s.interview.project_id, s.user.id, channel, consent, method || null, consent,
    liveModel, finalModel).run();
  const session = await loadSession(c.env, Number(ins.meta?.last_row_id));
  if (!session) return json({ detail: 'session_not_created' }, 500);

  if (messages && messages.length) {
    await replaceWithFinal(c.env, session, messages, channel === 'text' ? 'text_chat' : 'manual_entry', null);
  }
  await c.env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
  ).bind('interview_session_created', JSON.stringify({ session_uid: uid, interview_id: s.interview.id, channel, consent }),
    `user:${s.user.id}`, s.user.id, s.interview.project_id).run();
  return json({ session: await loadSession(c.env, session.id) }, 201);
});

sessions.get('/interviews/:id/sessions', async (c) => {
  const s = await scopeInterview(c, Number(c.req.param('id')));
  if (s instanceof Response) return s;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM interview_sessions WHERE interview_id = ? ORDER BY created_at DESC, id DESC',
  ).bind(s.interview.id).all<SessionRow>();
  return json({ items: rows.results || [] });
});

sessions.get('/sessions/:id', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const [segments, marks, chunks] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, source, start_ms, end_ms, speaker_label, text, model FROM interview_transcript_segments
        WHERE session_id = ? ORDER BY source, COALESCE(start_ms, 0), id`,
    ).bind(s.session.id).all(),
    c.env.DB.prepare('SELECT id, offset_ms, label, created_at FROM interview_session_marks WHERE session_id = ? ORDER BY offset_ms')
      .bind(s.session.id).all(),
    listChunks(c.env, s.session.id),
  ]);
  return json({
    session: s.session,
    segments: segments.results || [],
    marks: marks.results || [],
    chunks: chunks.map((ch) => ({ seq: ch.seq, size_bytes: ch.size_bytes, start_ms: ch.start_ms })),
  });
});

sessions.patch('/sessions/:id/consent', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
  if (!['draft', 'paused'].includes(s.session.status)) return json({ detail: 'consent_locked', status: s.session.status }, 409);
  const body = await c.req.json<any>().catch(() => ({}));
  const status = String(body?.status || '');
  if (!(CONSENT as readonly string[]).includes(status)) return json({ detail: 'invalid_consent', accepted: CONSENT }, 400);
  const method = status === 'given' ? String(body?.method || '') : '';
  if (status === 'given' && !(CONSENT_METHODS as readonly string[]).includes(method)) {
    return json({ detail: 'consent_method_required', accepted: CONSENT_METHODS }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE interview_sessions SET consent_status = ?, consent_method = ?,
            consent_at = CASE WHEN ? = 'given' THEN datetime('now') ELSE NULL END, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(status, method || null, status, s.session.id).run();
  // A paused recording whose consent is withdrawn is stopped, not resumed.
  if (status !== 'given' && s.session.status === 'paused') await transition(c.env, s.session, 'stop');
  return json({ session: await loadSession(c.env, s.session.id) });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

for (const action of Object.keys(TRANSITIONS) as (keyof typeof TRANSITIONS)[]) {
  sessions.post(`/sessions/:id/${action}`, async (c) => {
    const s = await scopeSession(c);
    if (s instanceof Response) return s;
    if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
    // THE WORKER ENFORCES CONSENT. A page that hides the button is not the gate.
    if (action === 'start' || action === 'resume') {
      const blocked = consentBlocks(s.session.channel, s.session.consent_status);
      if (blocked) return json(blocked, 409);
    }
    if (!(await transition(c.env, s.session, action))) {
      return json({ detail: 'invalid_transition', status: s.session.status, action }, 409);
    }
    return json({ session: await loadSession(c.env, s.session.id) });
  });
}

sessions.put('/sessions/:id/chunks/:seq', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!c.env.FILES) return json({ detail: 'storage_not_configured' }, 503);
  if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
  const blocked = consentBlocks(s.session.channel, s.session.consent_status);
  if (blocked) return json(blocked, 409);
  if (!['recording', 'paused', 'stopped'].includes(s.session.status)) {
    return json({ detail: 'not_recording', status: s.session.status }, 409);
  }
  const seq = Number(c.req.param('seq'));
  if (!Number.isSafeInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) return json({ detail: 'invalid_seq', max: MAX_CHUNKS - 1 }, 400);
  const mime = String(c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!CHUNK_MIME[mime]) return json({ detail: 'unsupported_type', accepted: Object.keys(CHUNK_MIME) }, 415);
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) return json({ detail: 'too_large', max_bytes: MAX_CHUNK_BYTES }, 413);
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return json({ detail: 'empty_chunk' }, 400);
  if (bytes.byteLength > MAX_CHUNK_BYTES) return json({ detail: 'too_large', max_bytes: MAX_CHUNK_BYTES }, 413);
  // For placing passages on the timeline only; never billed on.
  const rawStart = Number(c.req.header('x-chunk-start-ms'));
  const startMs = Number.isSafeInteger(rawStart) && rawStart >= 0 ? Math.min(rawStart, 24 * 3600 * 1000) : null;
  try {
    const r = await putChunk(c.env, s.session, s.user.id, seq, mime, bytes, startMs);
    return json({ ok: true, seq, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
  } catch (e) {
    console.error('[sessions] chunk store failed:', (e as Error).message);
    return json({ detail: 'storage_write_failed' }, 502);
  }
});

sessions.post('/sessions/:id/marks', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<any>().catch(() => ({}));
  const offset = Number(body?.offset_ms);
  if (!Number.isSafeInteger(offset) || offset < 0) return json({ detail: 'invalid_offset' }, 400);
  const r = await c.env.DB.prepare(
    'INSERT INTO interview_session_marks (session_id, offset_ms, label) VALUES (?, ?, ?)',
  ).bind(s.session.id, offset, text(body?.label, 200)).run();
  return json({ mark: { id: Number(r.meta?.last_row_id), offset_ms: offset, label: text(body?.label, 200) } }, 201);
});

// ---------------------------------------------------------------------------
// The live transcript
// ---------------------------------------------------------------------------

sessions.get('/sessions/:id/live', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (String(c.req.header('upgrade') || '').toLowerCase() !== 'websocket') return json({ detail: 'websocket_required' }, 426);
  if (!s.session.live_model) return json({ detail: 'live_off', message: 'Live transcript is off for this session.' }, 409);
  const blocked = consentBlocks(s.session.channel, s.session.consent_status);
  if (blocked) return json(blocked, 409);
  if (s.session.status !== 'recording') return json({ detail: 'not_recording', status: s.session.status }, 409);
  const first = await holdBlock(c.env, s.user.id, s.session.live_model);
  if (!first.ok) {
    await recordReceipt(c.env, s.session.id, {
      kind: 'live', model: s.session.live_model, requested_model: s.session.live_model, fallback_used: false,
      audio_minutes: 0, cost_microusd: 0, outcome: 'refused', refusal: first.refusal,
    });
    return json({ ok: false, refusal: first.refusal, message: first.message }, 402);
  }
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try { ctx = c.executionCtx; } catch { ctx = undefined; }
  return openLiveRelay(c.env, ctx, s.session, s.user.id, s.interview.interviewee_name, first.reservation);
});

// ---------------------------------------------------------------------------
// The final transcript
// ---------------------------------------------------------------------------

sessions.post('/sessions/:id/transcribe', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!c.env.FILES) return json({ detail: 'storage_not_configured' }, 503);
  if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
  if (!['stopped', 'transcribed'].includes(s.session.status)) {
    return json({ detail: 'stop_first', status: s.session.status }, 409);
  }
  const body = await c.req.json<any>().catch(() => ({}));
  const model = String(body?.model || s.session.final_model || DEFAULT_FINAL_MODEL);
  if (!isChoosable(model, 'final')) return json({ detail: 'model_not_offered', model }, 400);

  const chunks = await listChunks(c.env, s.session.id);
  if (!chunks.length) return json({ error: 'no_audio', message: 'This session has no recorded audio yet.' }, 400);
  if (chunks.some((ch) => !ch.r2_key.startsWith(AUDIO_PREFIX))) {
    console.error('[sessions] refusing a key outside validate-audio/');
    return json({ detail: 'storage_read_failed' }, 502);
  }

  // UP FRONT, FOR THE WHOLE JOB. A spent budget runs nothing and stores
  // nothing: the job is quoted at its dearest (the chosen model, or the
  // default it may fall back to) and held, then the hold is released and each
  // chunk is billed through the router as it runs.
  const minutesPer = chunks.map((ch) => audioMinutesFromBytes(ch.size_bytes));
  const totalMinutes = minutesPer.reduce((a, b) => a + b, 0);
  const quote = Math.max(estimateCostUsd(model, 0, 0, totalMinutes), estimateCostUsd(WHISPER_TURBO, 0, 0, totalMinutes));
  if (s.user.id > 0) {
    let held: Awaited<ReturnType<typeof aiBudget.reserveAiBudget>>;
    try { held = await aiBudget.reserveAiBudget(c.env, s.user.id, aiBudget.usdToMicro(quote)); }
    catch { return json({ ok: false, refusal: 'misconfigured', message: 'Unreadable: your AI allowance and top-up balance could not be checked.' }, 503); }
    if (!held.ok) {
      await recordReceipt(c.env, s.session.id, {
        kind: 'final', model, requested_model: model, fallback_used: false,
        audio_minutes: totalMinutes, cost_microusd: 0, outcome: 'refused', refusal: held.refusal,
      });
      return json({ ok: false, refusal: held.refusal, message: budgetRefusalMessage(held.refusal) }, 402);
    }
    await aiBudget.settleAiReservation(c.env, held.reservation, 0, true);
  }

  await c.env.DB.prepare(`UPDATE interview_sessions SET status = 'transcribing', updated_at = datetime('now') WHERE id = ?`)
    .bind(s.session.id).run();

  const segments: StoredSegment[] = [];
  let language: string | null = null;
  let modelUsed = model;
  let fallback = false;
  let costMicro = 0;
  let cursorMs = 0;
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const obj = await c.env.FILES.get(ch.r2_key);
    const fail = async (refusal: string, message: string, status: number) => {
      await c.env.DB.prepare(`UPDATE interview_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(s.session.status, s.session.id).run();
      await recordReceipt(c.env, s.session.id, {
        kind: 'final', model: modelUsed, requested_model: model, fallback_used: fallback,
        audio_minutes: totalMinutes, cost_microusd: costMicro, outcome: refusal.startsWith('budget') ? 'refused' : 'failed', refusal,
      });
      return json({ ok: false, refusal, message }, status);
    };
    if (!obj) return fail('chunk_missing', `Chunk ${ch.seq} could not be read. Nothing was stored.`, 502);
    const r = await aiRun(c.env, {
      task: 'transcribe',
      userId: s.user.id,
      surface: AI_SURFACE.validateInterviews,
      model,
      audio: new Uint8Array(await obj.arrayBuffer()),
      audioMime: ch.mime,
      audioMinutes: minutesPer[i],
    });
    if (!r.ok) {
      const budget = String(r.refusal || '').startsWith('budget');
      return fail(r.refusal || 'all_models_failed',
        budget ? budgetRefusalMessage(String(r.refusal)) : 'The recording could not be transcribed. Nothing was stored.',
        budget ? 402 : 503);
    }
    costMicro += aiBudget.usdToMicro(r.usage.est_cost_usd);
    if (r.usage.fallback_used) { fallback = true; modelUsed = r.usage.model; }
    language = language || r.transcript?.language || null;
    const offset = ch.start_ms ?? cursorMs;
    const placed = labelSegments(r.transcript?.segments ?? [], s.interview.interviewee_name, offset);
    segments.push(...placed);
    const lastEnd = placed.reduce((m, p) => Math.max(m, p.end_ms ?? 0), offset);
    cursorMs = Math.max(cursorMs, lastEnd);
  }

  const transcript = await replaceWithFinal(c.env, s.session, segments, modelUsed, language);
  await recordReceipt(c.env, s.session.id, {
    kind: 'final', model: modelUsed, requested_model: model, fallback_used: fallback,
    audio_minutes: totalMinutes, cost_microusd: costMicro, outcome: 'ok',
  });
  return json({
    ok: true,
    transcript,
    language,
    segments: segments.length,
    usage: { model: modelUsed, requested_model: model, fallback_used: fallback, audio_minutes: totalMinutes, cost_microusd: costMicro },
  });
});

sessions.patch('/sessions/:id/segments/:segmentId', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<any>().catch(() => ({}));
  const label = text(body?.speaker_label, 80);
  if (!label) return json({ detail: 'speaker_label_required' }, 400);
  const r = await c.env.DB.prepare(
    'UPDATE interview_transcript_segments SET speaker_label = ? WHERE id = ? AND session_id = ?',
  ).bind(label, Number(c.req.param('segmentId')), s.session.id).run();
  if (!Number(r.meta?.changes || 0)) return notFound('Segment');
  return json({ ok: true, speaker_label: label });
});

sessions.get('/sessions/:id/receipt', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const rows = await c.env.DB.prepare(
    `SELECT kind, model, requested_model, fallback_used, audio_minutes, cost_microusd, outcome, refusal, created_at
       FROM interview_session_receipts WHERE session_id = ? ORDER BY created_at, id`,
  ).bind(s.session.id).all();
  let budget: Record<string, unknown> | null = null;
  let budgetError: string | null = null;
  try {
    const b: any = await aiBudget.loadAiBudget(c.env, s.user.id);
    budget = {
      day_left_microusd: Math.max(0, b.daily_microusd - b.day_spend_microusd - b.day_reserved_microusd),
      month_left_microusd: Math.max(0, b.monthly_microusd - b.month_spend_microusd - b.month_reserved_microusd),
      balance_microusd: b.balance_microusd,
    };
  } catch {
    budgetError = 'Unreadable: your AI allowance and top-up balance could not be read.';
  }
  const items = rows.results || [];
  return json({
    items,
    total_cost_microusd: items.reduce((a: number, r: any) => a + Number(r.cost_microusd || 0), 0),
    budget,
    budget_error: budgetError,
  });
});

sessions.delete('/sessions/:id', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (s.session.status === 'transcribing') return json({ detail: 'transcribing', message: 'Wait for the transcript to finish.' }, 409);
  try {
    const r = await deleteSession(c.env, s.session, s.user.id);
    return json({ ok: true, audio_chunks_deleted: r.keys.length });
  } catch (e) {
    console.error('[sessions] delete failed:', (e as Error).message);
    return json({ detail: 'delete_failed' }, 502);
  }
});

export default sessions;
