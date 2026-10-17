/**
 * D657 — interview sessions on Validate: record, transcribe live and in full,
 * mark, review, delete. Mounted on `/api/founder/validate` beside
 * `founder_validate.ts`, whose paths it does not share.
 *
 *   GET    /sessions/models                 the live and final speech-to-text models, priced
 *   POST   /sessions                        D685: set up in one call (Who, How, Transcript, Consent)
 *   POST   /interviews/:id/sessions         open a session on an interview
 *   PUT    /sessions/:id/points/:pointId    D685: tick or untick a talking point
 *   POST   /sessions/:id/finish             D685: the chunks to expect; queues processing
 *   POST   /sessions/:id/process            D685: retry a failed or stale run
 *   POST   /sessions/:id/summarise          D685: the summary, run again
 *   GET    /interviews/:id/sessions         the interview's sessions
 *   GET    /sessions/:id                    one session: segments, marks, chunks
 *   PATCH  /sessions/:id/consent            record consent to record
 *   POST   /sessions/:id/{start,pause,resume,stop}
 *   PUT    /sessions/:id/chunks/:seq        one audio chunk, idempotent by seq
 *   GET    /sessions/active                 D685: the caller's recordings in flight
 *   POST   /sessions/:id/marks              mark a moment (D685: gated, client_key, capped)
 *   GET    /sessions/:id/live               WebSocket: the live transcript
 *   POST   /sessions/:id/transcribe         the final transcript
 *   PATCH  /sessions/:id/segments/:segId    assign a passage's speaker
 *   GET    /sessions/:id/receipt            what each job cost, and the budget left
 *   GET    /sessions/:id/audio              one signed download per recorded chunk (D690)
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
import { audioMinutesFromBytes, budgetRefusalMessage, estimateCostUsd } from '../services/aiRouter';
import * as aiBudget from '../services/aiBudget';
import {
  AUDIO_CHANNELS, AUDIO_PREFIX, CHANNELS, CHUNK_MIME, CONSENT, CONSENT_METHODS, MAX_CHUNK_BYTES, MAX_CHUNKS,
  TRANSITIONS, consentBlocks, deleteSession, listChunks, loadSession, putChunk, recordReceipt,
  replaceWithFinal, transition, type SessionRow, type StoredSegment,
} from '../services/interviewSessions';
import { DEFAULT_FINAL_MODEL, DEFAULT_LIVE_MODEL, isChoosable, listSttModels } from '../services/sttModels';
import { WHISPER_TURBO } from '../services/sttFormats';
import { holdBlock, openLiveRelay } from '../services/liveTranscription';
import {
  SETUP_CHANNELS, activeSessionOf, callRefusal, interviewCard, languageFor, listPoints, markInterviewHeld,
  pointStatements, sessionExtras,
} from '../services/sessionSetup';
import { setInterviewStage } from '../services/validateWriters';
import {
  afterChunkStored, finishSession, isStale, processingOf, recoverSession, summariseSession, summaryOf, transcribeChunk,
} from '../services/interviewProcessing';
import { consentRefusal, modelFrom, processingBusy, refusedBody, refusedStatus } from './founder_validate_structure';
import { activeSessionsOf } from '../services/sessionSweeper';
import { ensureTier, ensureTierSchema, FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';
import { mintDownloadToken } from '../services/signedDownload';

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
  // D685 — 404, not 403: another member learns nothing, not even that the
  // interview exists.
  if (!canWrite(project, user)) return notFound('Interview');
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

// D685 §5.6 — the caller's own recordings in flight, for the pill and the
// recovery on app load. Declared above `/sessions/:id` so "active" is never
// read as an id. Filtered on the caller, not on a project scope.
sessions.get('/sessions/active', async (c) => {
  const user = (await requireAuth(c)) as User;
  return json({ items: await activeSessionsOf(c.env, user.id) });
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

/**
 * Open a session on an interview the caller may write (D657, widened by D685
 * §5.1). Shared by the setup call and the per-interview route, so the two
 * cannot disagree on a rule. Every value is checked before anything is
 * written; the refusal is a Response.
 */
type OpenPlan = {
  channel: string; audio: boolean; consent: string; method: string; liveModel: string | null; finalModel: string | null;
  language: string | null; callProvider: string | null; meetingUrl: string | null; clientKey: string | null;
  messages: StoredSegment[] | null; quoteConsent: boolean;
};

function planSession(body: any, legacy: boolean): OpenPlan | Response {
  const channel = String(body?.channel || '');
  const offered: readonly string[] = legacy ? CHANNELS : SETUP_CHANNELS;
  if (!offered.includes(channel)) return json({ detail: 'invalid_channel', accepted: offered }, 400);
  const audio = AUDIO_CHANNELS.has(channel);

  const consent = audio ? String(body?.consent?.status || 'not_recorded') : 'not_recorded';
  if (!(CONSENT as readonly string[]).includes(consent)) return json({ detail: 'invalid_consent', accepted: CONSENT }, 400);
  const method = consent === 'given' ? String(body?.consent?.method || '') : '';
  if (consent === 'given' && !(CONSENT_METHODS as readonly string[]).includes(method)) {
    return json({ detail: 'consent_method_required', accepted: CONSENT_METHODS }, 400);
  }
  // A text session records no audio, so it has no recording consent. A method
  // picked there is consent to QUOTE the chat (D685 §5.1.4).
  const quoteConsent = channel === 'text' && (CONSENT_METHODS as readonly string[]).includes(String(body?.consent?.method || ''));

  const callProvider = text(body?.call_provider, 40);
  const meetingUrl = text(body?.meeting_url, 500);
  const refusal = callRefusal(channel, callProvider, meetingUrl);
  if (refusal) return json({ detail: 'invalid_call', message: refusal }, 400);

  // `live_model: null` is "Live transcript off": no socket, no cost.
  let liveModel: string | null = null;
  let finalModel: string | null = null;
  if (audio) {
    liveModel = body?.live_model === null ? null : String(body?.live_model || DEFAULT_LIVE_MODEL);
    if (liveModel && !isChoosable(liveModel, 'live')) return json({ detail: 'model_not_offered', model: liveModel, kind: 'live' }, 400);
    finalModel = String(body?.final_model || DEFAULT_FINAL_MODEL);
    if (!isChoosable(finalModel, 'final')) return json({ detail: 'model_not_offered', model: finalModel, kind: 'final' }, 400);
  }
  const lang = languageFor(body?.language, liveModel);
  if (!lang.ok) return json({ detail: 'invalid_language', message: lang.message }, 400);

  return {
    channel, audio, consent, method, liveModel, finalModel, language: lang.language, callProvider,
    meetingUrl, clientKey: text(body?.client_key, 100), messages: audio ? null : messagesToSegments(body?.messages), quoteConsent,
  };
}

/** The session already opened under this member's `client_key`, if any. */
async function replayed(env: Env, userId: number, clientKey: string | null): Promise<SessionRow | null> {
  if (!clientKey) return null;
  return await env.DB.prepare('SELECT * FROM interview_sessions WHERE created_by_user_id = ? AND client_key = ?')
    .bind(userId, clientKey).first<SessionRow>() ?? null;
}

async function sessionBody(env: Env, session: SessionRow) {
  return { session, ...(await sessionExtras(env, session)) };
}

/**
 * Insert the session for an interview, then its points and any pasted chat.
 *
 * `create` is the INSERT of a new interview (POST /sessions with no pick). It
 * runs in the same D1 batch as the session's INSERT, which takes the new
 * interview's id from `last_insert_rowid()`: one transaction, so when a second
 * Start racing past the replay check meets the client_key index, its interview
 * rolls back with it and a double click makes one interview (D685 §5.1.1).
 */
async function openOn(env: Env, user: User, interview: { id: number | null; project_id: number }, plan: OpenPlan, body: any,
  create: D1PreparedStatement | null = null): Promise<SessionRow> {
  const uid = crypto.randomUUID();
  const insert = env.DB.prepare(
    `INSERT INTO interview_sessions
       (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
        live_model, final_model, language, call_provider, meeting_url, client_key)
     VALUES (?, COALESCE(?, last_insert_rowid()), ?, ?, ?, 'draft', ?, ?, CASE WHEN ? = 'given' THEN datetime('now') END, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, interview.id, interview.project_id, user.id, plan.channel, plan.consent, plan.method || null, plan.consent,
    plan.liveModel, plan.finalModel, plan.language, plan.callProvider, plan.meetingUrl, plan.clientKey);
  const ins = create ? (await env.DB.batch([create, insert]))[1] : await insert.run();
  const session = (await loadSession(env, Number(ins.meta?.last_row_id)))!;
  interview = { id: session.interview_id, project_id: interview.project_id };

  const stmts = [
    ...(await pointStatements(env, session.id, interview.project_id, body?.points)),
    // The interview takes its channel from its first session (D685 §5.4).
    env.DB.prepare('UPDATE discovery_interviews SET channel = COALESCE(channel, ?) WHERE id = ?').bind(plan.channel, interview.id),
    ...(plan.quoteConsent ? [env.DB.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').bind(interview.id)] : []),
    env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`)
      .bind('interview_session_created', JSON.stringify({ session_uid: uid, interview_id: interview.id, channel: plan.channel, consent: plan.consent }),
        `user:${user.id}`, user.id, interview.project_id),
  ];
  await env.DB.batch(stmts);

  if (plan.messages && plan.messages.length) {
    await replaceWithFinal(env, session, plan.messages, plan.channel === 'text' ? 'text_chat' : 'manual_entry', null);
    // A text session is held the moment its chat is in.
    await markInterviewHeld(env, session, user.id);
  }
  return (await loadSession(env, session.id))!;
}

/**
 * D685 §5.1.1 — one live session per member: both setup routes refuse an
 * audio session while another is recording or paused, before anything is
 * written, as `/start` refuses it too. A text session records nothing.
 *
 * The per-interview route refuses too (#1588): a row's "Record a session" or a
 * draft's Start opened while recording would otherwise hand the recorder a
 * second session, and the page could not offer the live one in its place.
 */
async function liveRefusal(env: Env, userId: number, plan: OpenPlan): Promise<Response | null> {
  if (!plan.audio) return null;
  const live = await activeSessionOf(env, userId);
  return live ? json({ error: 'session_active', session_id: live.id, message: 'You are already recording another session. Stop it, or return to it, first.' }, 409) : null;
}

sessions.post('/interviews/:id/sessions', async (c) => {
  const s = await scopeInterview(c, Number(c.req.param('id')));
  if (s instanceof Response) return s;
  const body = await c.req.json<any>().catch(() => ({}));
  const plan = planSession(body, true);
  if (plan instanceof Response) return plan;
  const again = await replayed(c.env, s.user.id, plan.clientKey);
  if (again) return json(await sessionBody(c.env, again), 200);
  const busy = await liveRefusal(c.env, s.user.id, plan);
  if (busy) return busy;
  const session = await openOn(c.env, s.user, s.interview, plan, body);
  return json(await sessionBody(c.env, session), 201);
});

/**
 * D685 §5.1 — one setup call. Creates the interview from Who when none is
 * picked (booked, today), or takes a picked one still in the pipeline, and
 * opens the session on it. A repeated `client_key` answers the same pair.
 */
sessions.post('/sessions', async (c) => {
  const user = (await requireAuth(c)) as User;
  const body = await c.req.json<any>().catch(() => ({}));
  const projectId = Number(body?.project_id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return json({ detail: 'project_id_required' }, 400);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first() as ProjectRef | null;
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return notFound('Project');

  const plan = planSession(body, false);
  if (plan instanceof Response) return plan;
  const again = await replayed(c.env, user.id, plan.clientKey);
  if (again) return json(await sessionBody(c.env, again), 200);
  // D685 §5.1.1 — one live session per member: the setup call refuses while
  // the caller is recording or paused, as Start does (audio only; see liveRefusal).
  const busy = await liveRefusal(c.env, user.id, plan);
  if (busy) return busy;

  let interview: { id: number | null; project_id: number };
  let create: D1PreparedStatement | null = null;
  const pickedId = body?.interview_id == null ? null : Number(body.interview_id);
  if (pickedId != null) {
    const picked = await c.env.DB.prepare('SELECT id, project_id, stage FROM discovery_interviews WHERE id = ?')
      .bind(pickedId).first<{ id: number; project_id: number; stage: string | null }>();
    if (!picked || picked.project_id !== projectId) return notFound('Interview');
    if (!['lead', 'invited', 'booked'].includes(String(picked.stage))) {
      return json({ detail: 'interview_not_in_pipeline', message: 'That interview has already been held. Pick one still to come, or name someone new.' }, 409);
    }
    if (picked.stage !== 'booked') {
      await setInterviewStage(c.env, { projectId, userId: user.id, interviewId: picked.id, stage: 'booked' });
    }
    interview = picked;
  } else {
    const name = text(body?.interviewee?.name, 120);
    if (!name) return json({ detail: 'interviewee_name_required', message: 'Name the person you are talking to.' }, 400);
    if (typeof body?.interviewee?.name === 'string' && body.interviewee.name.trim().length > 120) {
      return json({ detail: 'interviewee_name_too_long', message: 'A name is at most 120 characters.' }, 400);
    }
    // progress.ts's whole free-tier check, not the constant alone.
    if (user.role === 'founder' && !userMeetsTier(user, 'growth')) {
      await ensureTierSchema(c.env);
      const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?')
        .bind(projectId).first<{ n: number }>();
      if (Number(existing?.n ?? 0) >= FREE_TIER_LIMITS.discoveryInterviews) {
        try { ensureTier(user, 'growth'); } catch (e) { if (e instanceof Response) return e; throw e; }
      }
    }
    // Written in the session's own batch (openOn), never on its own.
    create = c.env.DB.prepare(
      `INSERT INTO discovery_interviews
         (project_id, interviewee_name, interviewee_company, interview_date, channel, stage, booked_at, created_at, updated_at)
       VALUES (?, ?, ?, date('now'), ?, 'booked', datetime('now'), datetime('now'), datetime('now'))`,
    ).bind(projectId, name, text(body?.interviewee?.company, 160), plan.channel);
    interview = { id: null, project_id: projectId };
  }

  let session: SessionRow;
  try {
    session = await openOn(c.env, user, interview, plan, body, create);
  } catch (e) {
    // Two Start clicks racing past the replay check meet the unique index:
    // the second answers the first's session.
    const raced = await replayed(c.env, user.id, plan.clientKey);
    if (raced) return json(await sessionBody(c.env, raced), 200);
    throw e;
  }
  return json(await sessionBody(c.env, session), 201);
});

sessions.get('/interviews/:id/sessions', async (c) => {
  const s = await scopeInterview(c, Number(c.req.param('id')));
  if (s instanceof Response) return s;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM interview_sessions WHERE interview_id = ? ORDER BY created_at DESC, id DESC',
  ).bind(s.interview.id).all<SessionRow>();
  const card = await interviewCard(c.env, s.interview.id);
  const items = [];
  for (const row of rows.results || []) {
    const extra = await sessionExtras(c.env, row);
    items.push({ ...row, call_label: extra.call_label, meeting_url: extra.meeting_url, points: extra.points, points_covered: extra.points_covered });
  }
  return json({ interview: card, items });
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
    ...(await sessionExtras(c.env, s.session)),
    processing: processingOf(s.session),
    summary: summaryOf(s.session),
    segments: segments.results || [],
    marks: marks.results || [],
    chunks: chunks.map((ch) => ({ seq: ch.seq, size_bytes: ch.size_bytes, start_ms: ch.start_ms })),
  });
});

/**
 * D685 §5.2 — tick or untick a talking point. The offset is the Worker's:
 * the active time so far, counting the open interval while recording.
 */
sessions.put('/sessions/:id/points/:pointId', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<any>().catch(() => ({}));
  if (typeof body?.covered !== 'boolean') return json({ detail: 'covered_required' }, 400);
  const pointId = Number(c.req.param('pointId'));
  const r = body.covered
    ? await c.env.DB.prepare(
      `UPDATE interview_session_points
          SET covered_at = datetime('now'),
              covered_offset_ms = (SELECT active_ms + CASE WHEN status = 'recording' AND recording_since IS NOT NULL
                   THEN MAX(0, CAST(ROUND((julianday('now') - julianday(recording_since)) * 86400000) AS INTEGER)) ELSE 0 END
                 FROM interview_sessions WHERE id = ?)
        WHERE id = ? AND session_id = ?`,
    ).bind(s.session.id, pointId, s.session.id).run()
    : await c.env.DB.prepare(
      'UPDATE interview_session_points SET covered_at = NULL, covered_offset_ms = NULL WHERE id = ? AND session_id = ?',
    ).bind(pointId, s.session.id).run();
  if (!Number(r.meta?.changes || 0)) return notFound('Point');
  const points = await listPoints(c.env, s.session.id);
  return json({ points, points_covered: points.filter((p) => p.covered).length });
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
    // D685 §5.1 — one live session per member: a second Start refuses.
    if (action === 'start' || action === 'resume') {
      const live = await activeSessionOf(c.env, s.user.id, s.session.id);
      if (live) return json({ error: 'session_active', session_id: live.id, message: 'You are already recording another session. Stop it, or return to it, first.' }, 409);
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
    // D685 §5.9 — a chunk arriving after /finish moves the upload count, and
    // the last one queues the processing job.
    if (!r.duplicate) await afterChunkStored(c.env, s.session.id, s.user.id);
    return json({ ok: true, seq, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
  } catch (e) {
    console.error('[sessions] chunk store failed:', (e as Error).message);
    return json({ detail: 'storage_write_failed' }, 502);
  }
});

/** The furthest a mark can sit: the time recorded so far, on the Worker's clock. */
export function markCeiling(session: { active_ms: number; recording_since: string | null }, now = Date.now()): number {
  const since = session.recording_since ? Date.parse(session.recording_since.replace(' ', 'T') + 'Z') : NaN;
  return Math.max(0, session.active_ms + (Number.isFinite(since) ? Math.max(0, now - since) : 0));
}

// D685 §5.7 — a mark is taken while recording or paused, and after Stop too:
// Stop is posted before the capture's last flush, as for chunks. A replayed
// `client_key` answers the mark already stored; the offset is capped at the
// time actually recorded.
sessions.post('/sessions/:id/marks', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!['recording', 'paused', 'stopped'].includes(s.session.status)) {
    return json({ detail: 'not_recording', message: 'A moment can be marked only while the session is recording, paused or just stopped.', status: s.session.status }, 409);
  }
  const body = await c.req.json<any>().catch(() => ({}));
  const offset = Number(body?.offset_ms);
  if (!Number.isSafeInteger(offset) || offset < 0) return json({ detail: 'invalid_offset' }, 400);
  const key = typeof body?.client_key === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.client_key) ? body.client_key : null;
  if (body?.client_key != null && !key) return json({ detail: 'invalid_client_key' }, 400);
  if (key) {
    const prior = await c.env.DB.prepare('SELECT id, offset_ms, label FROM interview_session_marks WHERE session_id = ? AND client_key = ?')
      .bind(s.session.id, key).first<{ id: number; offset_ms: number; label: string | null }>();
    if (prior) return json({ mark: prior, duplicate: true });
  }
  const at = Math.min(offset, markCeiling(s.session));
  const label = text(body?.label, 200);
  const r = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO interview_session_marks (session_id, offset_ms, label, client_key) VALUES (?, ?, ?, ?)',
  ).bind(s.session.id, at, label, key).run();
  if (key && Number(r.meta?.changes || 0) === 0) {
    // Two replays raced; the other one stored it.
    const prior = await c.env.DB.prepare('SELECT id, offset_ms, label FROM interview_session_marks WHERE session_id = ? AND client_key = ?')
      .bind(s.session.id, key).first<{ id: number; offset_ms: number; label: string | null }>();
    return json({ mark: prior, duplicate: true });
  }
  return json({ mark: { id: Number(r.meta?.last_row_id), offset_ms: at, label } }, 201);
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

// ---------------------------------------------------------------------------
// D685 §5.9–§5.10 — processed without a button
// ---------------------------------------------------------------------------

/**
 * After Stop: the chunks to expect. The job is queued once every one is
 * stored; `auto: false` (the rail's Manual mode) stops it after Transcribing.
 */
sessions.post('/sessions/:id/finish', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
  const blocked = consentRefusal(s.session);
  if (blocked) return blocked;
  if (s.session.status !== 'stopped') return json({ detail: 'stop_first', status: s.session.status }, 409);
  const busy = processingBusy(s.session);
  if (busy && s.session.processing_stage !== 'uploading') return busy;
  const body = await c.req.json<any>().catch(() => ({}));
  const lastSeq = Number(body?.last_seq);
  if (!Number.isSafeInteger(lastSeq) || lastSeq < 0 || lastSeq >= MAX_CHUNKS) return json({ detail: 'invalid_last_seq', max: MAX_CHUNKS - 1 }, 400);
  const out = await finishSession(c.env, s.session, s.user.id, lastSeq, body?.auto !== false);
  return json({ ok: true, processing: { stage: out.stage, done: out.done, total: out.total, error: null }, queued: out.queued }, 202);
});

/** Retry a failed or stale run, from the stage it reached. */
sessions.post('/sessions/:id/process', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const blocked = consentRefusal(s.session);
  if (blocked) return blocked;
  const out = await recoverSession(c.env, s.session, s.user.id);
  if (!out.ok) return json({ detail: out.detail, message: out.message }, 409);
  return json({ ok: true, processing: processingOf((await loadSession(c.env, s.session.id))!) }, 202);
});

/**
 * The summary, run again (the job runs it once). Not gated on audio: a text
 * or imported session has a final transcript and no recording.
 */
sessions.post('/sessions/:id/summarise', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const blocked = consentRefusal(s.session);
  if (blocked) return blocked;
  const busy = processingBusy(s.session);
  if (busy) return busy;
  const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
  const picked = modelFrom(body?.model);
  if ('refused' in picked) return json(refusedBody('model_not_offered'), 400);
  const out = await summariseSession(c.env, s.session, s.user.id, picked.model);
  if (!out.ok) {
    if (out.reason === 'no_final_transcript') return json({ error: 'no_final_transcript', detail: 'This session has no final transcript to summarise yet.' }, 409);
    if (out.reason === 'no_citation') return json({ error: 'no_citation', detail: 'The summary could not be tied to the transcript, so none is stored.' }, 422);
    return json(refusedBody(out.refusal), refusedStatus(out.refusal));
  }
  return json({ ok: true, summary: summaryOf((await loadSession(c.env, s.session.id))!) }, 201);
});

sessions.post('/sessions/:id/transcribe', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  if (!c.env.FILES) return json({ detail: 'storage_not_configured' }, 503);
  if (!AUDIO_CHANNELS.has(s.session.channel)) return json({ detail: 'no_audio_on_this_channel' }, 400);
  if (!['stopped', 'transcribed', 'structured', 'reviewed'].includes(s.session.status)) {
    return json({ detail: 'stop_first', status: s.session.status }, 409);
  }
  // D685 §5.9 — never two writers: the processing job transcribes on its own.
  const busy = processingBusy(s.session);
  if (busy) return busy;
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
    const fail = async (refusal: string, message: string, status: number) => {
      await c.env.DB.prepare(`UPDATE interview_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(s.session.status, s.session.id).run();
      await recordReceipt(c.env, s.session.id, {
        kind: 'final', model: modelUsed, requested_model: model, fallback_used: fallback,
        audio_minutes: totalMinutes, cost_microusd: costMicro, outcome: refusal.startsWith('budget') ? 'refused' : 'failed', refusal,
      });
      return json({ ok: false, refusal, message }, status);
    };
    const offset = ch.start_ms ?? cursorMs;
    // The same per-chunk call the processing job makes (D685 §5.9).
    const r = await transcribeChunk(c.env, {
      session: s.session, userId: s.user.id, chunk: ch, model, intervieweeName: s.interview.interviewee_name, offsetMs: offset,
    });
    if (!r.ok) return fail(r.refusal, r.message, r.refusal === 'chunk_missing' ? 502 : r.budget ? 402 : 503);
    costMicro += r.costMicro;
    if (r.fallback) { fallback = true; modelUsed = r.model; }
    language = language || r.language;
    const placed = r.segments;
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

/**
 * One session's cost lines, in time order: `kind` is the step. D658 — the
 * language-model lines (Structured, Re-structured, Asked) live in
 * `interview_structure_receipts` (446), because this table's CHECK admits
 * only speech-to-text kinds; D685's summary lines (Summarised, Re-summarised)
 * in `interview_summary_receipts` (453). The receipt route and the Customer
 * research record's Cost section (D690, #1692) both read it.
 */
export async function sessionReceiptLines(env: Env, sessionId: number): Promise<any[]> {
  const rows = await env.DB.prepare(
    `SELECT kind, model, requested_model, fallback_used, audio_minutes, cost_microusd, outcome, refusal, created_at
       FROM (
         SELECT kind, model, requested_model, fallback_used, audio_minutes, cost_microusd, outcome, refusal, created_at, id, 0 AS src
           FROM interview_session_receipts WHERE session_id = ?
         UNION ALL
         SELECT step, model, requested_model, fallback_used, 0, cost_microusd, outcome, refusal, created_at, id, 1
           FROM interview_structure_receipts WHERE session_id = ?
         UNION ALL
         SELECT step, model, requested_model, fallback_used, 0, cost_microusd, outcome, refusal, created_at, id, 2
           FROM interview_summary_receipts WHERE session_id = ?
       ) ORDER BY created_at, src, id`,
  ).bind(sessionId, sessionId, sessionId).all();
  return rows.results || [];
}

sessions.get('/sessions/:id/receipt', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const items = await sessionReceiptLines(c.env, s.session.id);
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
  return json({
    items,
    total_cost_microusd: items.reduce((a: number, r: any) => a + Number(r.cost_microusd || 0), 0),
    budget,
    budget_error: budgetError,
  });
});

/**
 * D690 (#1692) — a session's recorded audio, as one signed download per
 * chunk (decision 11): `{ parts: [{ seq, url, mime, start_ms, expires_at }] }`
 * in `seq` order, or null when the session has no chunk.
 *
 * Each URL is `routes/files.ts`' single-use, two-minute token (audience
 * `validate-audio:<session uid>`), served as an attachment, so a player
 * fetches each part once, as a blob, and asks again for fresh URLs. Every key
 * is checked against `AUDIO_PREFIX` first, as transcribe checks it.
 */
export async function sessionAudioParts(env: Env, session: SessionRow, userId: number):
  Promise<Array<{ seq: number; url: string; mime: string | null; start_ms: number | null; expires_at: string }> | null> {
  const chunks = await listChunks(env, session.id);
  if (!chunks.length) return null;
  if (chunks.some((ch) => !ch.r2_key.startsWith(AUDIO_PREFIX))) throw new Error('A chunk key is outside validate-audio/');
  const parts = [];
  for (const ch of chunks) {
    const { token, expires_at } = await mintDownloadToken(env, {
      key: ch.r2_key, audience: `validate-audio:${session.uid}`, userId, ttlSec: 120,
    });
    parts.push({ seq: Number(ch.seq), url: `/api/files/dl/${token}`, mime: ch.mime ?? null, start_ms: ch.start_ms ?? null, expires_at });
  }
  return parts;
}

// D690 (#1692) — Open recording. Behind `scopeSession`, so anyone who cannot
// write the venture gets 404, as for every other session route.
sessions.get('/sessions/:id/audio', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  try {
    const parts = await sessionAudioParts(c.env, s.session, Number(s.user.id));
    if (!parts) return json({ detail: 'This session has no recorded audio.' }, 404);
    return json({ parts });
  } catch (e) {
    console.error('[sessions] audio refused:', (e as Error).message);
    return json({ detail: 'storage_read_failed' }, 502);
  }
});

sessions.delete('/sessions/:id', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  // D685 §5.9 — a run that is moving is waited for; a failed or stale one
  // (including a row the old synchronous route left in `transcribing`) is not.
  const moving = s.session.processing_stage && !['done', 'failed'].includes(s.session.processing_stage) && !isStale(s.session);
  const legacyStuck = !s.session.processing_stage && s.session.status === 'transcribing';
  if (moving || (legacyStuck && !isStale({ ...s.session, processing_stage: 'transcribing', processing_updated_at: s.session.updated_at }))) {
    return json({ detail: 'transcribing', message: 'Wait for the transcript to finish.' }, 409);
  }
  try {
    const r = await deleteSession(c.env, s.session, s.user.id);
    return json({ ok: true, audio_chunks_deleted: r.keys.length });
  } catch (e) {
    console.error('[sessions] delete failed:', (e as Error).message);
    return json({ detail: 'delete_failed' }, 502);
  }
});

export default sessions;
