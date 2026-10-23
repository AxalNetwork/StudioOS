/**
 * D657 — interview sessions: what a recording session is, and the writes that
 * keep it honest.
 *
 * A session hangs off one `discovery_interviews` row (migration 438). It is
 * the whole of "Record a session": the channel it happened on, the consent to
 * RECORD (not `quote_consent`, which is consent to quote), the audio as
 * numbered R2 chunks, the live draft transcript, the final transcript, the
 * marks, and a receipt per speech-to-text job.
 *
 * The rules this file holds, so a route cannot forget one:
 *   - Recording/transcription and direct audio operations require consent
 *     (`consentBlocks`). D754's WhatsApp admission gate runs before text is
 *     stored. D757 #1930 step 3 / #1898 decision 3 deliberately never gate
 *     engine digestion of admitted final text on audio consent; explicit
 *     withdrawal still stops it (`sessionDigestConsentBlocks`).
 *   - A chunk is stored once per sequence number (`putChunk`).
 *   - The final transcript replaces the live draft and is copied, as plain
 *     text, to `discovery_interviews.transcript`, so every existing reader of
 *     that column keeps working (`replaceWithFinal`).
 *   - The duration is the server's, summed over recording intervals on the
 *     Worker's clock (`transition`).
 *   - Deleting a session deletes its audio from R2 and leaves an audit row
 *     (`deleteSession`).
 */
import type { Env } from '../types';
import { speakerLabel, type SttSegment } from './sttFormats';
import { markInterviewHeld } from './sessionSetup';
import { closeAttachedRefs } from './channels/meetings';
import { consentRequired } from './channels/types';
import { presentTables } from './interviewFindings';

export const CHANNELS = ['in_person', 'video', 'phone', 'text', 'manual'] as const;
export type Channel = typeof CHANNELS[number];
/** Channels that record audio. Text chat and manual entry record none. */
export const AUDIO_CHANNELS: ReadonlySet<string> = new Set(['in_person', 'video', 'phone']);
export const CONSENT = ['given', 'declined', 'not_recorded'] as const;
export const CONSENT_METHODS = ['verbal', 'written', 'in_app', 'pre_agreed'] as const;
export const AUDIO_PREFIX = 'validate-audio/';

/**
 * One chunk's ceiling. Each chunk is transcribed on its own, and the router
 * hands Workers AI the bytes in memory, so this is a memory bound as well as a
 * policy one: 5 MB is about 21 minutes of 32 kbps speech per chunk, and
 * nothing holds a whole recording in memory any more.
 */
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_CHUNKS = 2000;

/** What a browser's MediaRecorder produces, plus raw PCM for the live path. */
export const CHUNK_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/**
 * D872 (#2519) — a call recording uploaded as a file (`submitted_via
 * 'upload'`). The browser decodes the file and re-encodes it as the one
 * format below; the chunk route refuses anything else for such a session, so
 * its bytes are its duration and the cap is exact.
 */
export const UPLOAD_SOURCE = 'upload';
export const UPLOAD_SAMPLE_RATE = 16_000;
/** 16 kHz, mono, 16-bit PCM: 32 000 bytes a second. */
export const UPLOAD_BYTES_PER_SECOND = UPLOAD_SAMPLE_RATE * 2;
/** A canonical WAV header (RIFF, fmt, data), the only one an upload chunk may carry. */
export const WAV_HEADER_BYTES = 44;
/** The longest upload: 3 hours, about $0.09 on whisper-large-v3-turbo and $0.94 on nova-3 (D872 §3). */
export const MAX_UPLOAD_MS = 3 * 3600 * 1000;
/** How the founder attests that everyone recorded agreed, as the session's consent method. */
export const UPLOAD_ATTESTATIONS = ['verbal', 'written', 'pre_agreed'] as const;

export interface WavInfo { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataBytes: number; durationMs: number }

/**
 * A PCM WAV's format and length, read from its header, or null when the bytes
 * are not one. `dataBytes` is what the bytes actually hold, never more than
 * the header claims. The duration is what a decoder plays, so it is what
 * speech-to-text is charged on (`interviewProcessing.chunkAudioMinutes`).
 */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < WAV_HEADER_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength) {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bitsPerSample: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || !fmt.channels || !fmt.sampleRate || !fmt.bitsPerSample) return null;
      const dataBytes = Math.min(size, bytes.byteLength - body);
      const perSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      return { ...fmt, dataOffset: body, dataBytes, durationMs: Math.round((dataBytes / perSecond) * 1000) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Whether a chunk is the upload format exactly: canonical header, 16 kHz, mono, 16-bit PCM, with samples. */
export function isUploadWav(bytes: Uint8Array): boolean {
  const w = wavInfo(bytes);
  return !!w && w.dataOffset === WAV_HEADER_BYTES && w.sampleRate === UPLOAD_SAMPLE_RATE && w.channels === 1
    && w.bitsPerSample === 16 && w.dataBytes > 0 && w.dataBytes === bytes.byteLength - WAV_HEADER_BYTES;
}

export interface SessionRow {
  id: number; uid: string; interview_id: number; project_id: number; created_by_user_id: number;
  channel: Channel; status: string; consent_status: string; consent_method: string | null; consent_at: string | null;
  language: string | null; live_model: string | null; final_model: string | null;
  active_ms: number; recording_since: string | null; started_at: string | null; stopped_at: string | null;
  audio_bytes: number; created_at: string; updated_at: string;
  call_provider?: string | null; meeting_url?: string | null; client_key?: string | null; submitted_via?: string | null;
  // D685 §5.9–§5.10 (migration 453).
  processing_stage?: string | null; processing_done?: number | null; processing_total?: number | null;
  processing_error?: string | null; processing_updated_at?: string | null; processing_auto?: number | null;
  expected_last_seq?: number | null;
  summary?: string | null; summary_model?: string | null; summarised_at?: string | null; summary_citations_json?: string | null;
  // D757 (migration 487): the Validate engine's state (services/validateEngine.ts).
  digest_status?: 'queued' | 'running' | 'done' | 'refused' | 'skipped' | null; digest_note?: string | null;
  digest_hash?: string | null; digest_trigger?: string | null; digest_run_id?: string | null; digested_at?: string | null;
  digest_json?: string | null; digest_kept_at?: string | null; digest_kept_by?: number | null;
  // D877 (migration 530): the audio went, the text stayed.
  audio_removed_at?: string | null; audio_removed_reason?: AudioRemovedReason | null;
}

export async function loadSession(env: Env, id: number): Promise<SessionRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return (await env.DB.prepare('SELECT * FROM interview_sessions WHERE id = ?').bind(id).first<SessionRow>()) ?? null;
}

/**
 * The 409 a session gets without consent, or null when it may go on. It gates
 * three kinds of session (D754 §4, #1893):
 *   - an audio channel, as #1470 did;
 *   - any session that holds an audio chunk, whatever its channel;
 *   - a chat from a provider whose chats wait for the interviewee's consent
 *     (`consentRequired`): nothing from it is structured, asked, summarised
 *     or processed until the interviewee agreed in the chat, or the member
 *     confirmed it once Axal's notice reached them.
 * `opts` is required, so a caller that forgets it fails `tsc`.
 */
export function consentBlocks(
  channel: string, consentStatus: string, opts: { hasAudio: boolean; submittedVia: string | null },
): { error: 'consent_not_recorded'; message: string } | null {
  if (consentStatus === 'given') return null;
  if (consentRequired(opts.submittedVia)) {
    return {
      error: 'consent_not_recorded',
      message: consentStatus === 'declined'
        ? 'The interviewee declined or withdrew consent in the chat, so Axal runs nothing on it.'
        : 'The interviewee has not agreed in the chat yet, so Axal runs nothing on it.',
    };
  }
  if (!AUDIO_CHANNELS.has(channel) && !opts.hasAudio) return null;
  return {
    error: 'consent_not_recorded',
    message: consentStatus === 'declined'
      ? 'The interviewee declined to be recorded. Take notes instead, or switch to manual entry.'
      : 'Record the interviewee’s consent to be recorded before you start.',
  };
}

/** Whether a session holds any audio chunk: one indexed probe. */
export async function sessionHasAudio(env: Env, sessionId: number): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 AS hit FROM interview_session_chunks WHERE session_id = ? LIMIT 1').bind(sessionId).first());
}

/** `consentBlocks` for a stored session, reading whether it holds audio. */
export async function sessionConsentBlocks(env: Env, session: SessionRow): Promise<ReturnType<typeof consentBlocks>> {
  return consentBlocks(session.channel, session.consent_status, {
    hasAudio: await sessionHasAudio(env, session.id), submittedVia: session.submitted_via ?? null,
  });
}

/** D757 (#1930 step 3, #1898 decision 3): the engine never gates admitted final text on audio consent.
 * Thread admission applies WhatsApp's consent rule before text is stored. An
 * explicit decline/withdrawal stops every text run.
 * Transcription continues to use sessionConsentBlocks/consentBlocks, including the chunk probe.
 */
export async function sessionDigestConsentBlocks(env: Env, session: SessionRow): Promise<ReturnType<typeof consentBlocks>> {
  if (session.channel !== 'text') return sessionConsentBlocks(env, session);
  if (session.consent_status === 'declined') return {
    error: 'consent_not_recorded', message: 'The interviewee declined or withdrew consent, so Axal runs nothing on it.',
  };
  return null;
}

/**
 * The interview a session was made for, removed with it: only while nothing
 * else is on it — no transcript, no other session, no recruiting stage past
 * booked — and only when it was created within five seconds of the session.
 * `createInterview` sets no stage, so NULL counts as booked. An interview the
 * founder logged by hand is never removed.
 */
export async function dropInterviewMadeFor(env: Env, interviewId: number, sessionCreatedAt: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM discovery_interviews
      WHERE id = ? AND (stage IS NULL OR stage = 'booked') AND transcript IS NULL
        AND ABS(julianday(created_at) - julianday(?)) * 86400 <= 5
        AND NOT EXISTS (SELECT 1 FROM interview_sessions WHERE interview_id = discovery_interviews.id)`,
  ).bind(interviewId, sessionCreatedAt).run();
}

/**
 * Status changes, with the server-measured duration. Every interval between a
 * start (or resume) and a pause (or stop) is added on the Worker's clock; a
 * duration the client sends is never read.
 */
export const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  start: { from: ['draft'], to: 'recording' },
  pause: { from: ['recording'], to: 'paused' },
  resume: { from: ['paused'], to: 'recording' },
  stop: { from: ['recording', 'paused'], to: 'stopped' },
};

export async function transition(env: Env, session: SessionRow, action: keyof typeof TRANSITIONS): Promise<boolean> {
  const t = TRANSITIONS[action];
  // At most two states a transition starts from; both bound, never interpolated.
  const [fromA, fromB = fromA] = t.from;
  const closesInterval = action === 'pause' || action === 'stop';
  const opensInterval = action === 'start' || action === 'resume';
  const r = await env.DB.prepare(
    `UPDATE interview_sessions
        SET status = ?,
            active_ms = active_ms + CASE WHEN ? = 1 AND recording_since IS NOT NULL
                          THEN MAX(0, CAST(ROUND((julianday('now') - julianday(recording_since)) * 86400000) AS INTEGER))
                          ELSE 0 END,
            recording_since = CASE WHEN ? = 1 THEN datetime('now') WHEN ? = 1 THEN NULL ELSE recording_since END,
            started_at = COALESCE(started_at, CASE WHEN ? = 1 THEN datetime('now') END),
            stopped_at = CASE WHEN ? = 'stop' THEN datetime('now') ELSE stopped_at END,
            updated_at = datetime('now')
      WHERE id = ? AND status IN (?, ?) AND COALESCE(submitted_via, '') <> 'meeting_bot'`,
  ).bind(t.to, closesInterval ? 1 : 0, opensInterval ? 1 : 0, closesInterval ? 1 : 0, opensInterval ? 1 : 0,
    action, session.id, fromA, fromB).run();
  const changed = Number(r.meta?.changes || 0) === 1;
  // D685 §5.1.6 — "it lands in Interviews when you stop". Every stop passes
  // here: the action route and the consent-withdrawal stop alike. A pasted
  // call link attached to the session takes the stored stop as its end, so the
  // transcript sweep can collect it (S18, #1585).
  if (changed && action === 'stop') {
    await markInterviewHeld(env, session, null);
    await closeAttachedRefs(env, session.id);
  }
  return changed;
}

/** The chunk's R2 key: derived from the session and the sequence number, never from the request. */
export function chunkKey(ownerUserId: number, sessionUid: string, seq: number, ext: string): string {
  return `${AUDIO_PREFIX}${ownerUserId}/sessions/${sessionUid}/${String(seq).padStart(6, '0')}.${ext}`;
}

/**
 * Store one chunk once. A sequence number already stored answers
 * `duplicate: true` and writes nothing, so a client that lost the response and
 * re-sends (the canvas's `offline` state, uploading on reconnect) costs nothing
 * and stores nothing twice.
 */
export async function putChunk(
  env: Env, session: SessionRow, ownerUserId: number, seq: number, mime: string, bytes: ArrayBuffer, startMs: number | null,
  meta: Record<string, string> = {},
): Promise<{ duplicate: boolean; objectPath: string }> {
  const existing = await env.DB.prepare(
    'SELECT r2_key FROM interview_session_chunks WHERE session_id = ? AND seq = ?',
  ).bind(session.id, seq).first<{ r2_key: string }>();
  if (existing) return { duplicate: true, objectPath: existing.r2_key };
  const objectPath = chunkKey(ownerUserId, session.uid, seq, CHUNK_MIME[mime]);
  await env.FILES!.put(objectPath, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { ...meta, session_id: String(session.id), seq: String(seq), owner_user_id: String(ownerUserId) },
  });
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, start_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(session.id, seq, objectPath, mime, bytes.byteLength, startMs).run();
  if (Number(ins.meta?.changes || 0) === 0) return { duplicate: true, objectPath };
  await env.DB.prepare(
    `UPDATE interview_sessions SET audio_bytes = audio_bytes + ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(bytes.byteLength, session.id).run();
  return { duplicate: false, objectPath };
}

export interface ChunkRow { seq: number; r2_key: string; mime: string; size_bytes: number; start_ms: number | null }
export async function listChunks(env: Env, sessionId: number): Promise<ChunkRow[]> {
  const r = await env.DB.prepare(
    'SELECT seq, r2_key, mime, size_bytes, start_ms FROM interview_session_chunks WHERE session_id = ? ORDER BY seq',
  ).bind(sessionId).all<ChunkRow>();
  return r.results || [];
}

/** A passage ready to store: its offsets, speaker label and text. */
/** D866 §4: a content-free tombstone keeps the passage's position stable. */
export const SOURCE_DELETED_TEXT = '[Deleted at the source]';
export const SOURCE_DELETED_NOTE = 'The source message was deleted in Telegram.';
export interface StoredSegment { start_ms: number | null; end_ms: number | null; speaker_label: string; speaker_raw: string | null; text: string; source_ref?: string | null }

export function labelSegments(segments: SttSegment[], intervieweeName: string | null, offsetMs = 0): StoredSegment[] {
  return segments.map((s) => ({
    start_ms: s.start_ms == null ? null : s.start_ms + offsetMs,
    end_ms: s.end_ms == null ? null : s.end_ms + offsetMs,
    speaker_label: speakerLabel(s.speaker, intervieweeName),
    speaker_raw: s.speaker == null ? null : String(s.speaker),
    text: s.text,
  }));
}

/**
 * The final transcript REPLACES the live draft. One batch, so a reader never
 * sees both or neither: the session's segments are deleted, the final ones
 * written, the session marked transcribed with its language and model, and the
 * plain text copied to `discovery_interviews.transcript` for every existing
 * reader of that column.
 */
export async function replaceWithFinal(
  env: Env, session: SessionRow, segments: StoredSegment[], model: string, language: string | null, status = 'transcribed',
): Promise<string> {
  const text = segments.map((s) => s.text).join('\n');
  const stmts = [
    env.DB.prepare('DELETE FROM interview_transcript_segments WHERE session_id = ?').bind(session.id),
    ...segments.map((s) => env.DB.prepare(
      `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model)
       VALUES (?, 'final', ?, ?, ?, ?, ?, ?)`,
    ).bind(session.id, s.start_ms, s.end_ms, s.speaker_label, s.speaker_raw, s.text, model)),
    env.DB.prepare(
      `UPDATE interview_sessions SET status = ?, language = COALESCE(?, language), final_model = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(status, language, model, session.id),
    env.DB.prepare(
      `UPDATE discovery_interviews
          SET transcript = ?, transcribed_at = datetime('now'), transcribed_by_model = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(text, model, session.interview_id),
  ];
  await env.DB.batch(stmts);
  return text;
}

/** A finished live passage, stored as the draft. */
export async function storeLiveSegment(env: Env, session: SessionRow, seg: StoredSegment, model: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model)
     VALUES (?, 'live', ?, ?, ?, ?, ?, ?)`,
  ).bind(session.id, seg.start_ms, seg.end_ms, seg.speaker_label, seg.speaker_raw, seg.text, model).run();
}

export async function recordReceipt(env: Env, sessionId: number, r: {
  kind: 'live' | 'final'; model: string; requested_model: string | null; fallback_used: boolean;
  audio_minutes: number; cost_microusd: number; outcome: 'ok' | 'refused' | 'failed'; refusal?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO interview_session_receipts
       (session_id, kind, model, requested_model, fallback_used, audio_minutes, cost_microusd, outcome, refusal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, r.kind, r.model, r.requested_model, r.fallback_used ? 1 : 0, r.audio_minutes,
    Math.max(0, Math.round(r.cost_microusd)), r.outcome, r.refusal ?? null).run();
}

/** D877 (#2524) — why a session's audio went while its text stayed. */
export type AudioRemovedReason = 'retention' | 'deleted';

/**
 * D877 (#2524) — remove a session's audio and keep its text: the R2 chunks
 * first, then their rows, then `audio_removed_at` and its reason on the
 * session, and one audit row. The segments, marks, receipts, digest and every
 * accepted item stay. Keys outside the feature's prefix are never deleted,
 * whatever a row says. `actorUserId` is null for the retention purge.
 */
export async function deleteSessionAudio(env: Env, session: SessionRow, actorUserId: number | null, reason: AudioRemovedReason): Promise<{ keys: string[] }> {
  if (env.MEETING_BOT_RUN) {
    const { stopSessionBot } = await import('./meetingBots');
    await stopSessionBot(env, session.id, session.created_by_user_id);
  }
  const keys = (await listChunks(env, session.id)).map((c) => c.r2_key).filter((k) => k.startsWith(AUDIO_PREFIX));
  if (keys.length && env.FILES) {
    for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM interview_session_chunks WHERE session_id = ?').bind(session.id),
    env.DB.prepare(
      `UPDATE interview_sessions SET audio_removed_at = COALESCE(audio_removed_at, datetime('now')),
              audio_removed_reason = COALESCE(audio_removed_reason, ?), updated_at = datetime('now') WHERE id = ?`,
    ).bind(reason, session.id),
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind('interview_session_audio_deleted', JSON.stringify({
      session_uid: session.uid, interview_id: session.interview_id, reason, audio_chunks: keys.length,
    }), actorUserId ? `user:${actorUserId}` : 'system:call_audio_retention', actorUserId ?? session.created_by_user_id, session.project_id),
  ]);
  return { keys };
}

/**
 * Delete a session: its R2 chunks first, then its rows, then one audit row in
 * `activity_logs` naming what was removed. Keys outside the feature's prefix
 * are never deleted, whatever a row says.
 */
export async function deleteSession(env: Env, session: SessionRow, actorUserId: number): Promise<{ keys: string[] }> {
  if (env.MEETING_BOT_RUN) {
    const { stopSessionBot } = await import('./meetingBots');
    await stopSessionBot(env, session.id, session.created_by_user_id);
  }
  const keys = (await listChunks(env, session.id)).map((c) => c.r2_key).filter((k) => k.startsWith(AUDIO_PREFIX));
  if (keys.length && env.FILES) {
    for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  }
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM interview_transcript_segments WHERE session_id = ?) AS segments,
            (SELECT COUNT(*) FROM interview_session_marks WHERE session_id = ?) AS marks,
            (SELECT COALESCE(SUM(cost_microusd), 0) FROM interview_session_receipts WHERE session_id = ?) AS cost_microusd`,
  ).bind(session.id, session.id, session.id).first<{ segments: number; marks: number; cost_microusd: number }>();
  // D757 §2.13 (#1923) — the findings this session's suggestions became keep
  // their row (the founder accepted them) and lose the interviewee's words.
  const findings = (await presentTables(env, ['interview_findings'])).has('interview_findings')
    ? [env.DB.prepare('UPDATE interview_findings SET quote = NULL, cite_from = NULL, cite_to = NULL WHERE session_id = ?').bind(session.id)]
    : [];
  const botTables = await presentTables(env, ['meeting_bots', 'meeting_bot_events']);
  await env.DB.batch([
    ...(botTables.has('meeting_bots') && botTables.has('meeting_bot_events') ? [env.DB.prepare('DELETE FROM meeting_bot_events WHERE run_uid IN (SELECT uid FROM meeting_bots WHERE session_id = ?)').bind(session.id)] : []),
    ...(botTables.has('meeting_bots') ? [env.DB.prepare('DELETE FROM meeting_bots WHERE session_id = ?').bind(session.id)] : []),
    ...findings,
    // D667 — the session's PENDING proposals go with it, whoever proposed
    // them (StudioOS or an assistant): each carries a quote of a transcript
    // that is being deleted. A decided proposal stays, as the record of what
    // the founder accepted or discarded, but its quote is cleared.
    env.DB.prepare(`DELETE FROM validate_proposals WHERE session_id = ? AND status = 'pending'`).bind(session.id),
    env.DB.prepare('UPDATE validate_proposals SET citation_json = NULL WHERE session_id = ?').bind(session.id),
    env.DB.prepare('DELETE FROM interview_transcript_segments WHERE session_id = ?').bind(session.id),
    env.DB.prepare('DELETE FROM interview_session_marks WHERE session_id = ?').bind(session.id),
    env.DB.prepare('DELETE FROM interview_session_receipts WHERE session_id = ?').bind(session.id),
    env.DB.prepare('DELETE FROM interview_session_chunks WHERE session_id = ?').bind(session.id),
    // D685 §5.2 — deleted explicitly, not left to the CASCADE.
    env.DB.prepare('DELETE FROM interview_session_points WHERE session_id = ?').bind(session.id),
    // D685 §5.9–§5.10 — the staged chunk transcripts and the summary's receipts.
    env.DB.prepare('DELETE FROM interview_chunk_transcripts WHERE session_id = ?').bind(session.id),
    env.DB.prepare('DELETE FROM interview_summary_receipts WHERE session_id = ?').bind(session.id),
    // D754 (#1893) — the chat consent given for this session goes with it, and
    // a chat that pointed here is pending again, its consent to be asked anew.
    env.DB.prepare('DELETE FROM channel_consents WHERE session_id = ?').bind(session.id),
    env.DB.prepare(
      `UPDATE channel_threads SET status = 'pending', interview_id = NULL, session_id = NULL, consent_state = NULL,
              updated_at = datetime('now') WHERE session_id = ?`,
    ).bind(session.id),
    env.DB.prepare('DELETE FROM interview_sessions WHERE id = ?').bind(session.id),
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind('interview_session_deleted', JSON.stringify({
      session_uid: session.uid, interview_id: session.interview_id, channel: session.channel,
      audio_chunks: keys.length, segments: counts?.segments ?? 0, marks: counts?.marks ?? 0,
      cost_microusd: counts?.cost_microusd ?? 0,
    }), `user:${actorUserId}`, actorUserId, session.project_id),
  ]);
  return { keys };
}
