/**
 * D685 §5.9–§5.10 (#1584) — Stop leads to the findings, with no button in
 * between: upload → transcribe → summarise → place findings, as one resumable
 * job (`interview_process`).
 *
 *   finishSession       POST /sessions/:id/finish: how many chunks to expect.
 *                       Queues the job once every one is stored; a chunk PUT
 *                       re-checks (`afterChunkStored`), so a late chunk is
 *                       waited for, not lost.
 *   runInterviewProcessJob
 *                       transcribes a bounded batch of chunks per message,
 *                       staging each chunk's segments so a retry never bills
 *                       a chunk twice; then assembles the final transcript
 *                       once; then calls D757's engine (`digestSession`,
 *                       trigger `recording_processed`) for its last two
 *                       stages, summarising and placing. It never
 *                       re-implements either.
 *   recoverSession      POST /sessions/:id/process: a failed or stale run, or
 *                       a session stuck in `transcribing` from before this
 *                       change, is resumed from the stage it reached.
 *   transcribeVoiceNote D754 (#1935): the voice-note mode of the per-chunk
 *                       stage, for a chat's session (channel 'text'). One
 *                       chunk is transcribed exactly as a recording's is, and
 *                       its segments are APPENDED (`appendSegments`), never
 *                       written over the chat (`replaceWithFinal`). The
 *                       staged transcript is inserted in the append's own
 *                       batch, so a chunk is appended once: a second run's
 *                       batch fails on the staged row's key and rolls back.
 *                       The job's voice-note branch resumes a chat session's
 *                       untranscribed chunks the same way, then hands the
 *                       session to the engine (`enqueueDigest`); it never
 *                       structures or summarises per note.
 *
 * Every AI step reserves and settles the member's D640 budget through the
 * router and leaves receipt lines; a refusal is recorded and shown in the
 * Worker's words. The processing count exists only where something is
 * counted (uploading, transcribing): summarising and placing carry none.
 */
import type { Env } from '../types';
import type { JobType } from '../models/jobs';
import { run as aiRun, audioMinutesFromBytes, budgetRefusalMessage } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import * as aiBudget from './aiBudget';
import { enqueueJob } from './queue';
import {
  AUDIO_CHANNELS, AUDIO_PREFIX, consentBlocks, labelSegments, sessionHasAudio, listChunks, loadSession, recordReceipt, replaceWithFinal,
  type ChunkRow, type SessionRow, type StoredSegment,
} from './interviewSessions';
import { DEFAULT_FINAL_MODEL } from './sttModels';
import { appendSegments } from './interviewIntake';
import type { ChannelProvider } from './channels/types';
import type { DigestOutcome } from './validateEngine';
import { summariseTranscript, toSegments, type DigestSections, type ReceiptLine, type SegmentRow, type SummarySentence } from './interviewStructuring';

export const STAGES = ['uploading', 'transcribing', 'summarising', 'placing', 'done', 'failed'] as const;
export type Stage = typeof STAGES[number];
/** Chunks transcribed per job message, so one message stays well inside a Worker's limits. */
export const CHUNKS_PER_MESSAGE = 20;
/** A stage other than done or failed that has not moved for this long is stale. */
export const STALE_MINUTES = 15;
/**
 * What a run the minute sweeper resumed says while it runs, and how the
 * sweeper knows it already tried: a run still carrying this note that stalls
 * again is failed (`STALLED_TWICE`), not resumed a second time. The job clears
 * it at done; a member's Retry clears it too.
 */
export const RESTARTED_NOTE = 'Processing stalled, so Axal restarted it from where it stopped.';
export const STALLED_TWICE = 'Processing stalled twice, so Axal stopped restarting it. Nothing was lost; try again.';
/** At done the restart note has served its purpose; any other note (missing parts, a placement refusal) stays. */
const doneNote = (session: SessionRow) => (session.processing_error === RESTARTED_NOTE ? { error: null } : {});
/**
 * The job's type, registered in `models/jobs.ts` and dispatched by
 * `queueWorker.ts`'s `handleJob` (S01, D684 §16).
 */
export const PROCESS_JOB: JobType = 'interview_process';

const micro = (usd: number) => Math.max(0, Math.round((usd || 0) * 1_000_000));

/**
 * Move the stage. The error is kept unless one is passed (null clears it), so
 * a note set on the way (the sweeper's missing parts) survives to `done`.
 */
async function setStage(env: Env, sessionId: number, stage: Stage, fields: { done?: number | null; total?: number | null; error?: string | null } = {}) {
  const setsError = 'error' in fields ? 1 : 0;
  await env.DB.prepare(
    `UPDATE interview_sessions
        SET processing_stage = ?, processing_done = ?, processing_total = ?,
            processing_error = CASE WHEN ? = 1 THEN ? ELSE processing_error END,
            processing_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(stage, fields.done ?? null, fields.total ?? null, setsError, fields.error ?? null, sessionId).run();
}

export function enqueueProcess(env: Env, sessionId: number, userId: number, key?: string) {
  return enqueueJob(env, PROCESS_JOB, { session_id: sessionId, user_id: userId }, {
    idempotency_key: key ?? `interview_process:${sessionId}:${crypto.randomUUID()}`,
  });
}

/** The chunks the run covers: every stored chunk at or below the expected last one. */
function expectedChunks(chunks: ChunkRow[], lastSeq: number): ChunkRow[] {
  return chunks.filter((c) => c.seq <= lastSeq);
}

// ---------------------------------------------------------------------------
// Transcribing one chunk (shared with POST /sessions/:id/transcribe)
// ---------------------------------------------------------------------------

export type ChunkTranscript =
  | { ok: true; segments: StoredSegment[]; language: string | null; model: string; fallback: boolean; costMicro: number }
  | { ok: false; refusal: string; message: string; budget: boolean };

/**
 * One chunk through the router, as the member. The segments come back placed
 * at `offsetMs`. Language and the model's fallback are the router's.
 */
export async function transcribeChunk(env: Env, opts: {
  session: Pick<SessionRow, 'language'>; userId: number; chunk: ChunkRow; model: string; intervieweeName: string | null; offsetMs: number;
}): Promise<ChunkTranscript> {
  const obj = env.FILES ? await env.FILES.get(opts.chunk.r2_key) : null;
  if (!obj) return { ok: false, refusal: 'chunk_missing', message: `Part ${opts.chunk.seq + 1} of the recording could not be read. Nothing was stored.`, budget: false };
  const r = await aiRun(env, {
    task: 'transcribe',
    userId: opts.userId,
    surface: AI_SURFACE.validateInterviews,
    model: opts.model,
    audio: new Uint8Array(await obj.arrayBuffer()),
    audioMime: opts.chunk.mime,
    audioMinutes: audioMinutesFromBytes(opts.chunk.size_bytes),
    language: opts.session.language,
  });
  if (!r.ok) {
    const budget = String(r.refusal || '').startsWith('budget');
    return {
      ok: false, refusal: r.refusal || 'all_models_failed', budget,
      message: budget ? budgetRefusalMessage(String(r.refusal)) : 'The recording could not be transcribed. Nothing was stored.',
    };
  }
  return {
    ok: true,
    segments: labelSegments(r.transcript?.segments ?? [], opts.intervieweeName, opts.offsetMs),
    language: r.transcript?.language || null,
    model: r.usage.model,
    fallback: !!r.usage.fallback_used,
    costMicro: aiBudget.usdToMicro(r.usage.est_cost_usd),
  };
}

// ---------------------------------------------------------------------------
// Voice-note mode (D754, #1935): a chat's voice note, appended to its session
// ---------------------------------------------------------------------------

/** A chat session's final model is the channel's marker (`channel:<provider>`); its notes use the recorder's default. */
export function voiceNoteModel(session: Pick<SessionRow, 'final_model'>): string {
  const m = String(session.final_model || '');
  return m && !m.startsWith('channel:') ? m : DEFAULT_FINAL_MODEL;
}

export type VoiceNoteTranscript =
  | { ok: true; appended: number; already: boolean }
  | { ok: false; refusal: string; message: string; budget: boolean };

const isKeyConflict = (e: unknown) => /UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error)?.message ?? e));

/**
 * One stored chunk of a chat session, transcribed by the recorder's per-chunk
 * stage on the session's final model, with a receipt line, and appended under
 * `speakerLabel`. `alongside` runs in the append's batch (the note's
 * placeholder, the webhook event's record). A chunk already appended answers
 * `already: true` and appends nothing.
 */
export async function transcribeVoiceNote(env: Env, opts: {
  session: SessionRow; userId: number; seq: number; speakerLabel: string; provider: ChannelProvider;
  alongside?: D1PreparedStatement[];
}): Promise<VoiceNoteTranscript> {
  const { session, userId, seq } = opts;
  const staged = await env.DB.prepare('SELECT 1 AS hit FROM interview_chunk_transcripts WHERE session_id = ? AND seq = ?').bind(session.id, seq).first();
  if (staged) {
    if (opts.alongside?.length) await env.DB.batch(opts.alongside);
    return { ok: true, appended: 0, already: true };
  }
  const chunk = (await listChunks(env, session.id)).find((c) => c.seq === seq);
  if (!chunk || !chunk.r2_key.startsWith(AUDIO_PREFIX)) {
    return { ok: false, refusal: 'chunk_missing', message: 'The voice note could not be read. Nothing was stored.', budget: false };
  }
  const model = voiceNoteModel(session);
  const r = await transcribeChunk(env, { session, userId, chunk, model, intervieweeName: null, offsetMs: 0 });
  if (!r.ok) {
    await recordReceipt(env, session.id, {
      kind: 'final', model, requested_model: model, fallback_used: false,
      audio_minutes: audioMinutesFromBytes(chunk.size_bytes), cost_microusd: 0,
      outcome: r.budget ? 'refused' : 'failed', refusal: r.refusal,
    });
    return r;
  }
  // D754 §6: one `final` segment per note, under the side's label, beside the chat's own lines.
  const text = r.segments.map((x) => String(x.text ?? '').trim()).filter(Boolean).join(' ');
  const segments: StoredSegment[] = text ? [{ start_ms: null, end_ms: null, speaker_label: opts.speakerLabel, speaker_raw: null, text }] : [];
  // A plain INSERT, not OR IGNORE: a chunk staged by another run fails the whole batch, so nothing is appended twice.
  const stage = env.DB.prepare(
    `INSERT INTO interview_chunk_transcripts (session_id, seq, model, language, segments_json, cost_microusd, fallback_used)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(session.id, seq, r.model, r.language, JSON.stringify(segments), r.costMicro, r.fallback ? 1 : 0);
  let appended = 0;
  try {
    appended = await appendSegments(env, userId, session.id, segments, opts.provider, [stage, ...(opts.alongside ?? [])]);
  } catch (e) {
    if (!isKeyConflict(e)) throw e;
    return { ok: true, appended: 0, already: true };
  }
  await recordReceipt(env, session.id, {
    kind: 'final', model: r.model, requested_model: model, fallback_used: r.fallback,
    audio_minutes: audioMinutesFromBytes(chunk.size_bytes), cost_microusd: r.costMicro, outcome: 'ok',
  });
  return { ok: true, appended, already: false };
}

/** The speaker of a stored channel chunk, from the side its R2 object records: 'Me', else the interviewee. */
async function chunkSpeaker(env: Env, chunk: ChunkRow, intervieweeName: string | null): Promise<string> {
  const head = env.FILES ? await env.FILES.head(chunk.r2_key).catch(() => null) : null;
  const side = head?.customMetadata?.side ?? null;
  return side === 'me' ? 'Me' : (String(intervieweeName ?? '').trim().slice(0, 80) || 'Interviewee');
}

/**
 * The job's voice-note branch: every chunk of a chat session not yet staged
 * (a note whose own job stopped), a bounded batch at a time, appended; the
 * note's placeholder goes in the same batch. Then the engine, once.
 */
async function transcribeVoiceNotes(env: Env, session: SessionRow, userId: number, intervieweeName: string | null): Promise<Stage> {
  const staged = await env.DB.prepare('SELECT seq FROM interview_chunk_transcripts WHERE session_id = ?').bind(session.id).all<{ seq: number }>();
  const have = new Set((staged.results || []).map((r) => r.seq));
  const todo = (await listChunks(env, session.id)).filter((c) => !have.has(c.seq));
  const provider = String(session.submitted_via || '') as ChannelProvider;
  for (const ch of todo.slice(0, CHUNKS_PER_MESSAGE)) {
    const r = await transcribeVoiceNote(env, {
      session, userId, seq: ch.seq, provider, speakerLabel: await chunkSpeaker(env, ch, intervieweeName),
      alongside: [env.DB.prepare('DELETE FROM channel_thread_messages WHERE id = ? AND voice_ref_enc IS NOT NULL').bind(ch.seq)],
    });
    if (!r.ok) {
      await failProcessing(env, session, r.message);
      return 'failed';
    }
  }
  if (todo.length > CHUNKS_PER_MESSAGE) {
    await setStage(env, session.id, 'transcribing');
    await enqueueProcess(env, session.id, userId);
    return 'transcribing';
  }
  await setStage(env, session.id, 'done');
  const { enqueueDigest } = await import('./validateEngine');
  await enqueueDigest(env, session.id, userId, 'voice_note_added');
  return 'done';
}

// ---------------------------------------------------------------------------
// The summary (shared with POST /sessions/:id/summarise)
// ---------------------------------------------------------------------------

export async function recordSummaryReceipt(env: Env, sessionId: number, line: ReceiptLine, outcome: 'ok' | 'refused', refusal: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO interview_summary_receipts
       (session_id, step, model, requested_model, fallback_used, prompt_tokens, completion_tokens, cost_microusd, outcome, refusal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, line.step, line.model, line.requested_model, line.fallback_used ? 1 : 0,
    line.prompt_tokens, line.completion_tokens, micro(line.est_cost_usd), outcome, refusal).run();
}

export type SummaryResult =
  | { ok: true; sentences: SummarySentence[]; model: string; digest: DigestSections }
  | { ok: false; reason: 'no_final_transcript' | 'no_citation' | 'refused'; refusal: string | null };

/**
 * Summarise the session's final transcript and store it. Never the live draft.
 *
 * D757 (#1924): the summary is the digest — an overview, key quotes with
 * speaker and time, decisions and next steps — written to `digest_json` as a
 * draft. `summary` and `summary_citations_json` are written from its overview,
 * so `summaryOf` and the session page read as before. A new run clears
 * `digest_kept_at` and `digest_kept_by`: a new draft must be kept again.
 */
export async function summariseSession(env: Env, session: SessionRow, userId: number, model?: string): Promise<SummaryResult> {
  const rows = await env.DB.prepare(
    `SELECT id, start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(session.id).all<SegmentRow>();
  const segments = toSegments(rows.results ?? []);
  if (!segments.length) return { ok: false, reason: 'no_final_transcript', refusal: null };
  const out = await summariseTranscript(env, {
    userId, model, segments, step: session.summary ? 're_summarised' : 'summarised',
    mode: session.channel === 'text' ? 'thread' : 'call',
  });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && out.reason === 'refused' && i === out.receipt.length - 1;
    await recordSummaryReceipt(env, session.id, out.receipt[i], refusedHere ? 'refused' : 'ok', refusedHere ? out.refusal : null);
  }
  if (!out.ok) return { ok: false, reason: out.reason, refusal: out.refusal };
  const usedModel = out.receipt[out.receipt.length - 1]?.model || '';
  // Dynamic: validateEngine.ts imports this file.
  const { transcriptHash } = await import('./validateEngine');
  const digest = {
    v: 1,
    source: session.submitted_via || (AUDIO_CHANNELS.has(session.channel) ? 'recorder' : session.channel),
    kind: session.channel,
    hash: await transcriptHash(segments),
    model: usedModel,
    written_at: new Date().toISOString(),
    parts: out.parts,
    // The engine names the structure run beside it once that run lands (validateEngine.ts).
    run_id: null,
    overview: out.digest.overview.map((o) => ({ text: o.text, cite: o.cites[0] })),
    key_quotes: out.digest.key_quotes,
    decisions: out.digest.decisions.map((d) => ({ text: d.text, cite: d.cites[0] })),
    next_steps: out.digest.next_steps.map((n) => ({ text: n.text, who: n.who, cite: n.cites[0] })),
  };
  await env.DB.prepare(
    `UPDATE interview_sessions SET summary = ?, summary_model = ?, summarised_at = datetime('now'), summary_citations_json = ?,
            digest_json = ?, digest_kept_at = NULL, digest_kept_by = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(out.sentences.map((s) => s.text).join(' '), usedModel, JSON.stringify(out.sentences), JSON.stringify(digest), session.id).run();
  return { ok: true, sentences: out.sentences, model: usedModel, digest: out.digest };
}

/** The summary as a read shows it: its sentences with their citations, or null. */
export function summaryOf(session: SessionRow) {
  if (!session.summary) return null;
  let sentences: SummarySentence[] = [];
  try { sentences = JSON.parse(session.summary_citations_json || '[]'); } catch { sentences = []; }
  return { text: session.summary, sentences, model: session.summary_model ?? null, summarised_at: session.summarised_at ?? null };
}

// ---------------------------------------------------------------------------
// Finish, and the late chunk
// ---------------------------------------------------------------------------

async function storedUpTo(env: Env, sessionId: number, lastSeq: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id = ? AND seq <= ?')
    .bind(sessionId, lastSeq).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * Record the chunks to expect after Stop. The stage is `uploading` with the
 * count stored so far; once every chunk is in, the job is queued.
 */
export async function finishSession(env: Env, session: SessionRow, userId: number, lastSeq: number, auto: boolean) {
  const total = lastSeq + 1;
  const done = await storedUpTo(env, session.id, lastSeq);
  await env.DB.prepare(
    `UPDATE interview_sessions SET expected_last_seq = ?, processing_auto = ?, processing_stage = 'uploading',
            processing_done = ?, processing_total = ?, processing_error = NULL, processing_updated_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(lastSeq, auto ? 1 : 0, done, total, session.id).run();
  if (done >= total) await enqueueProcess(env, session.id, userId, `interview_process:${session.id}:finish`);
  return { stage: 'uploading' as Stage, done, total, queued: done >= total };
}

/** After a chunk is stored: move the upload count, and queue the job when the last one arrives. */
export async function afterChunkStored(env: Env, sessionId: number, userId: number) {
  const s = await loadSession(env, sessionId);
  if (!s || s.processing_stage !== 'uploading' || s.expected_last_seq == null) return;
  const total = s.expected_last_seq + 1;
  const done = await storedUpTo(env, s.id, s.expected_last_seq);
  await env.DB.prepare(
    `UPDATE interview_sessions SET processing_done = ?, processing_updated_at = datetime('now') WHERE id = ? AND processing_stage = 'uploading'`,
  ).bind(done, s.id).run();
  if (done >= total) await enqueueProcess(env, s.id, userId, `interview_process:${s.id}:finish`);
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export const NO_CONSENT_SENTENCE = 'The interviewee’s consent to be recorded is not recorded, so nothing was processed.';

/** Stage `failed` with a sentence. The sweeper also uses it, for a stale run it cannot resume. */
export async function failProcessing(env: Env, session: SessionRow, sentence: string) {
  await setStage(env, session.id, 'failed', { error: sentence });
  // Back to where a person can act: stopped (retry), or transcribed if the transcript is in.
  await env.DB.prepare(
    `UPDATE interview_sessions SET status = 'stopped', updated_at = datetime('now') WHERE id = ? AND status = 'transcribing'`,
  ).bind(session.id).run();
}

/** Transcribe what remains, a bounded batch at a time. Returns true when every chunk is staged. */
async function transcribeBatch(env: Env, session: SessionRow, userId: number, intervieweeName: string | null): Promise<boolean | 'failed'> {
  const lastSeq = session.expected_last_seq ?? -1;
  const chunks = expectedChunks(await listChunks(env, session.id), lastSeq);
  if (chunks.some((ch) => !ch.r2_key.startsWith(AUDIO_PREFIX))) {
    await failProcessing(env, session, 'The recording could not be read. Nothing was transcribed.');
    return 'failed';
  }
  const staged = await env.DB.prepare('SELECT seq FROM interview_chunk_transcripts WHERE session_id = ?')
    .bind(session.id).all<{ seq: number }>();
  const have = new Set((staged.results || []).map((r) => r.seq));
  const todo = chunks.filter((ch) => !have.has(ch.seq));
  const model = session.final_model || DEFAULT_FINAL_MODEL;
  await env.DB.prepare(`UPDATE interview_sessions SET status = 'transcribing', updated_at = datetime('now') WHERE id = ? AND status = 'stopped'`)
    .bind(session.id).run();
  await setStage(env, session.id, 'transcribing', { done: have.size, total: chunks.length });
  let done = have.size;
  for (const ch of todo.slice(0, CHUNKS_PER_MESSAGE)) {
    const r = await transcribeChunk(env, { session, userId, chunk: ch, model, intervieweeName, offsetMs: 0 });
    if (!r.ok) {
      await recordReceipt(env, session.id, {
        kind: 'final', model, requested_model: model, fallback_used: false,
        audio_minutes: audioMinutesFromBytes(ch.size_bytes), cost_microusd: 0,
        outcome: r.budget ? 'refused' : 'failed', refusal: r.refusal,
      });
      await failProcessing(env, session, r.message);
      return 'failed';
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO interview_chunk_transcripts (session_id, seq, model, language, segments_json, cost_microusd, fallback_used)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(session.id, ch.seq, r.model, r.language, JSON.stringify(r.segments), r.costMicro, r.fallback ? 1 : 0).run();
    done += 1;
    await setStage(env, session.id, 'transcribing', { done, total: chunks.length });
  }
  return done >= chunks.length;
}

/** Every staged chunk, placed on one timeline, written as the final transcript once. */
async function assemble(env: Env, session: SessionRow) {
  const lastSeq = session.expected_last_seq ?? -1;
  const chunks = expectedChunks(await listChunks(env, session.id), lastSeq);
  const rows = await env.DB.prepare(
    'SELECT seq, model, language, segments_json, cost_microusd, fallback_used FROM interview_chunk_transcripts WHERE session_id = ? ORDER BY seq',
  ).bind(session.id).all<{ seq: number; model: string; language: string | null; segments_json: string; cost_microusd: number; fallback_used: number }>();
  const startOf = new Map(chunks.map((c) => [c.seq, c.start_ms]));
  const segments: StoredSegment[] = [];
  let cursor = 0;
  let language: string | null = null;
  let cost = 0;
  let fallback = false;
  let model = session.final_model || DEFAULT_FINAL_MODEL;
  for (const r of rows.results || []) {
    const offset = startOf.get(r.seq) ?? cursor;
    const placed = (JSON.parse(r.segments_json) as StoredSegment[]).map((s) => ({
      ...s,
      start_ms: s.start_ms == null ? null : s.start_ms + offset,
      end_ms: s.end_ms == null ? null : s.end_ms + offset,
    }));
    segments.push(...placed);
    cursor = Math.max(cursor, placed.reduce((m, p) => Math.max(m, p.end_ms ?? 0), offset));
    language = language || r.language;
    cost += Number(r.cost_microusd || 0);
    if (r.fallback_used) { fallback = true; model = r.model; }
  }
  await replaceWithFinal(env, session, segments, model, language);
  await recordReceipt(env, session.id, {
    kind: 'final', model, requested_model: session.final_model, fallback_used: fallback,
    audio_minutes: chunks.reduce((m, c) => m + audioMinutesFromBytes(c.size_bytes), 0), cost_microusd: cost, outcome: 'ok',
  });
}

/**
 * The `interview_process` job. Resumes from the stage the session reached; a
 * refusal or a failure is stored as a sentence, never retried by itself
 * (POST /sessions/:id/process retries).
 */
export async function runInterviewProcessJob(env: Env, payload: unknown): Promise<Stage | null> {
  const p = (payload ?? {}) as { session_id?: unknown; user_id?: unknown };
  const sessionId = Number(p.session_id);
  const userId = Number(p.user_id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) return null;
  let session = await loadSession(env, sessionId);
  if (!session || !session.processing_stage || session.processing_stage === 'done' || session.processing_stage === 'failed') return null;
  // Only the member who recorded it processes it.
  if (session.created_by_user_id !== userId) return null;
  // #1470: no consent, no AI over the recording.
  if (consentBlocks(session.channel, session.consent_status, {
    hasAudio: await sessionHasAudio(env, session.id), submittedVia: session.submitted_via ?? null,
  })) {
    await failProcessing(env, session, NO_CONSENT_SENTENCE);
    return 'failed';
  }
  const interview = await env.DB.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?')
    .bind(session.interview_id).first<{ interviewee_name: string | null }>();
  try {
    // D754 (#1935): a chat's session holds voice notes, not a recording: append, never assemble.
    if (!AUDIO_CHANNELS.has(session.channel)) return await transcribeVoiceNotes(env, session, userId, interview?.interviewee_name ?? null);
    if (session.processing_stage === 'uploading' || session.processing_stage === 'transcribing') {
      if (session.processing_stage === 'uploading') {
        const total = (session.expected_last_seq ?? -1) + 1;
        if ((await storedUpTo(env, session.id, session.expected_last_seq ?? -1)) < total) return 'uploading';
      }
      const finished = await transcribeBatch(env, session, userId, interview?.interviewee_name ?? null);
      if (finished === 'failed') return 'failed';
      if (!finished) {
        await enqueueProcess(env, session.id, userId);
        return 'transcribing';
      }
      session = (await loadSession(env, session.id))!;
      await assemble(env, session);
      if (session.processing_auto === 0) {
        // Manual mode: stop after Transcribing; the review offers Summarise and Structure.
        await setStage(env, session.id, 'done', doneNote(session));
        return 'done';
      }
      await setStage(env, session.id, 'summarising');
      session = (await loadSession(env, session.id))!;
    }
    // D757: both stages are the engine's. Dynamic: validateEngine.ts imports this file.
    if (session.processing_stage === 'summarising') {
      // A refusal is a receipt line; the job moves on to the findings.
      const { digestSession } = await import('./validateEngine');
      await digestSession(env, { sessionId: session.id, userId, trigger: 'recording_processed', stages: ['summarise'] });
      await setStage(env, session.id, 'placing');
      session = (await loadSession(env, session.id))!;
    }
    if (session.processing_stage === 'placing') {
      const { digestSession } = await import('./validateEngine');
      const placed = await digestSession(env, { sessionId: session.id, userId, trigger: 'recording_processed', stages: ['structure'] });
      const error = placingError(placed);
      await setStage(env, session.id, 'done', error ? { error } : doneNote(session));
      return 'done';
    }
    return session.processing_stage as Stage;
  } catch (e) {
    console.warn('[processing] job failed', sessionId, (e as Error)?.message);
    await failProcessing(env, session, 'Processing stopped unexpectedly. Nothing was lost; try again.');
    return 'failed';
  }
}

/**
 * What the placing stage's outcome says, in the sentences the job has always
 * used: the budget's, or "try Structure again". A conversation too long for
 * one run says so instead (D7): Structure again cannot succeed for it.
 */
function placingError(placed: DigestOutcome): string | null {
  if (placed.status !== 'refused' || placed.reason === 'consent_not_recorded') return null;
  if (placed.reason === 'transcript_too_large') return placed.note;
  if (String(placed.refusal || '').startsWith('budget')) {
    return `${budgetRefusalMessage(String(placed.refusal))} The transcript is ready; place the findings when the allowance allows.`;
  }
  return 'The findings could not be placed. The transcript is ready; try Structure again.';
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export function isStale(session: SessionRow, now = Date.now()): boolean {
  const stage = session.processing_stage;
  if (!stage || stage === 'done' || stage === 'failed') return false;
  const at = Date.parse(String(session.processing_updated_at || '').replace(' ', 'T') + 'Z');
  return !Number.isFinite(at) || now - at > STALE_MINUTES * 60_000;
}

/**
 * Resume a failed or stale run, or a session left in `transcribing` by the old
 * synchronous route. Staged chunks are kept, so nothing is billed twice. A
 * fresh idempotency key, so the queue does not ack the retry as a repeat.
 *
 * Two callers, `POST /sessions/:id/process` and the minute sweeper, can reach
 * the same row at once. The resume is one UPDATE guarded on the stage, the
 * stage's time and the status the caller read, so only one of them queues a
 * run; the other is told the session is still being processed.
 *
 * A retry keeps the member's Stop choice. One that never recorded a choice
 * (`processing_auto` NULL) is manual: it stops after Transcribing (D770, #2095).
 */
export async function recoverSession(env: Env, session: SessionRow, userId: number, now = Date.now(), note: string | null = null): Promise<{ ok: true; stage: Stage } | { ok: false; detail: string; message: string }> {
  const legacyStuck = !session.processing_stage && session.status === 'transcribing';
  if (!legacyStuck && session.processing_stage !== 'failed' && !isStale(session, now)) {
    return { ok: false, detail: 'not_retryable', message: session.processing_stage ? 'This session is still being processed.' : 'Finish the recording first.' };
  }
  // D754 (#1935): a chat's session that holds voice notes resumes them too.
  const voiceNotes = !AUDIO_CHANNELS.has(session.channel);
  if (voiceNotes && !(await sessionHasAudio(env, session.id))) return { ok: false, detail: 'no_audio_on_this_channel', message: 'This session has no recording to process.' };
  let lastSeq = session.expected_last_seq;
  if (lastSeq == null) {
    const max = await env.DB.prepare('SELECT MAX(seq) AS m FROM interview_session_chunks WHERE session_id = ?').bind(session.id).first<{ m: number | null }>();
    lastSeq = max?.m ?? null;
  }
  if (lastSeq == null) return { ok: false, detail: 'no_audio', message: 'This session has no recorded audio yet.' };
  // Resume where it stopped: a transcript already in skips straight to the summary.
  const resumeAt: Stage = !voiceNotes && (session.status === 'transcribed' || session.status === 'structured') ? 'summarising' : 'transcribing';
  const claimed = await env.DB.prepare(
    `UPDATE interview_sessions
        SET expected_last_seq = ?, processing_auto = CASE WHEN ? = 1 THEN 0 ELSE COALESCE(processing_auto, 0) END,
            status = CASE WHEN status = 'transcribing' THEN 'stopped' ELSE status END,
            processing_stage = ?, processing_done = NULL, processing_total = NULL, processing_error = ?,
            processing_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND processing_stage IS ? AND processing_updated_at IS ? AND status = ?`,
  ).bind(lastSeq, voiceNotes ? 1 : 0, resumeAt, note, session.id, session.processing_stage ?? null, session.processing_updated_at ?? null, session.status).run();
  if (Number(claimed.meta?.changes || 0) !== 1) {
    return { ok: false, detail: 'not_retryable', message: 'This session is still being processed.' };
  }
  await enqueueProcess(env, session.id, userId);
  return { ok: true, stage: resumeAt };
}

/** The processing state on a read. */
export function processingOf(session: SessionRow) {
  if (!session.processing_stage) return null;
  return {
    stage: session.processing_stage,
    done: session.processing_done ?? null,
    total: session.processing_total ?? null,
    error: session.processing_error ?? null,
    stale: isStale(session),
  };
}
