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
 *                       once; then summarises; then calls D684's
 *                       `structureSession` (trigger `recording_processed`).
 *                       It never re-implements structuring.
 *   recoverSession      POST /sessions/:id/process: a failed or stale run, or
 *                       a session stuck in `transcribing` from before this
 *                       change, is resumed from the stage it reached.
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
  AUDIO_CHANNELS, AUDIO_PREFIX, consentBlocks, labelSegments, listChunks, loadSession, recordReceipt, replaceWithFinal,
  type ChunkRow, type SessionRow, type StoredSegment,
} from './interviewSessions';
import { DEFAULT_FINAL_MODEL } from './sttModels';
import { summariseTranscript, toSegments, type ReceiptLine, type SegmentRow, type SummarySentence } from './interviewStructuring';
import { structureSession } from './sessionAutoStructure';

export const STAGES = ['uploading', 'transcribing', 'summarising', 'placing', 'done', 'failed'] as const;
export type Stage = typeof STAGES[number];
/** Chunks transcribed per job message, so one message stays well inside a Worker's limits. */
export const CHUNKS_PER_MESSAGE = 20;
/** A stage other than done or failed that has not moved for this long is stale. */
export const STALE_MINUTES = 15;
/**
 * The job's type. Registering it in `models/jobs.ts` and `queueWorker.ts` is
 * S01's (D684 §16); the cast holds until then.
 */
export const PROCESS_JOB = 'interview_process' as JobType;

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
  | { ok: true; sentences: SummarySentence[]; model: string }
  | { ok: false; reason: 'no_final_transcript' | 'no_citation' | 'refused'; refusal: string | null };

/** Summarise the session's final transcript and store it. Never the live draft. */
export async function summariseSession(env: Env, session: SessionRow, userId: number, model?: string): Promise<SummaryResult> {
  const rows = await env.DB.prepare(
    `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(session.id).all<SegmentRow>();
  const segments = toSegments(rows.results ?? []);
  if (!segments.length) return { ok: false, reason: 'no_final_transcript', refusal: null };
  const out = await summariseTranscript(env, { userId, model, segments, step: session.summary ? 're_summarised' : 'summarised' });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && out.reason === 'refused' && i === out.receipt.length - 1;
    await recordSummaryReceipt(env, session.id, out.receipt[i], refusedHere ? 'refused' : 'ok', refusedHere ? out.refusal : null);
  }
  if (!out.ok) return { ok: false, reason: out.reason, refusal: out.refusal };
  const usedModel = out.receipt[out.receipt.length - 1]?.model || '';
  await env.DB.prepare(
    `UPDATE interview_sessions SET summary = ?, summary_model = ?, summarised_at = datetime('now'), summary_citations_json = ?,
            updated_at = datetime('now') WHERE id = ?`,
  ).bind(out.sentences.map((s) => s.text).join(' '), usedModel, JSON.stringify(out.sentences), session.id).run();
  return { ok: true, sentences: out.sentences, model: usedModel };
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

async function fail(env: Env, session: SessionRow, sentence: string) {
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
    await fail(env, session, 'The recording could not be read. Nothing was transcribed.');
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
      await fail(env, session, r.message);
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
  if (consentBlocks(session.channel, session.consent_status)) {
    await fail(env, session, 'The interviewee’s consent to be recorded is not recorded, so nothing was processed.');
    return 'failed';
  }
  const interview = await env.DB.prepare('SELECT interviewee_name FROM discovery_interviews WHERE id = ?')
    .bind(session.interview_id).first<{ interviewee_name: string | null }>();
  try {
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
        await setStage(env, session.id, 'done');
        return 'done';
      }
      await setStage(env, session.id, 'summarising');
      session = (await loadSession(env, session.id))!;
    }
    if (session.processing_stage === 'summarising') {
      // A refusal is a receipt line; the job moves on to the findings.
      await summariseSession(env, session, userId);
      await setStage(env, session.id, 'placing');
      session = (await loadSession(env, session.id))!;
    }
    if (session.processing_stage === 'placing') {
      const placed = await structureSession(env, { sessionId: session.id, userId, trigger: 'recording_processed' });
      const error = placed.ok ? null
        : placed.reason === 'refused' && String(placed.refusal || '').startsWith('budget')
          ? `${budgetRefusalMessage(String(placed.refusal))} The transcript is ready; place the findings when the allowance allows.`
          : placed.reason === 'refused'
            ? 'The findings could not be placed. The transcript is ready; try Structure again.'
            : null;
      await setStage(env, session.id, 'done', error ? { error } : {});
      return 'done';
    }
    return session.processing_stage as Stage;
  } catch (e) {
    console.warn('[processing] job failed', sessionId, (e as Error)?.message);
    await fail(env, session, 'Processing stopped unexpectedly. Nothing was lost; try again.');
    return 'failed';
  }
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
 */
export async function recoverSession(env: Env, session: SessionRow, userId: number): Promise<{ ok: true; stage: Stage } | { ok: false; detail: string; message: string }> {
  const legacyStuck = !session.processing_stage && session.status === 'transcribing';
  if (!legacyStuck && session.processing_stage !== 'failed' && !isStale(session)) {
    return { ok: false, detail: 'not_retryable', message: session.processing_stage ? 'This session is still being processed.' : 'Finish the recording first.' };
  }
  if (!AUDIO_CHANNELS.has(session.channel)) return { ok: false, detail: 'no_audio_on_this_channel', message: 'This session has no recording to process.' };
  let lastSeq = session.expected_last_seq;
  if (lastSeq == null) {
    const max = await env.DB.prepare('SELECT MAX(seq) AS m FROM interview_session_chunks WHERE session_id = ?').bind(session.id).first<{ m: number | null }>();
    lastSeq = max?.m ?? null;
  }
  if (lastSeq == null) return { ok: false, detail: 'no_audio', message: 'This session has no recorded audio yet.' };
  // Resume where it stopped: a transcript already in skips straight to the summary.
  const resumeAt: Stage = session.status === 'transcribed' || session.status === 'structured' ? 'summarising' : 'transcribing';
  await env.DB.prepare(
    `UPDATE interview_sessions SET expected_last_seq = ?, processing_auto = COALESCE(processing_auto, 1),
            status = CASE WHEN status = 'transcribing' THEN 'stopped' ELSE status END, updated_at = datetime('now') WHERE id = ?`,
  ).bind(lastSeq, session.id).run();
  await setStage(env, session.id, resumeAt, { error: null });
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
