/**
 * D756 (#1896) — which recordings from a chat Axal takes, for every provider.
 *
 * The recorder's own rules, applied to a file a customer sent:
 *   size      at most the recorder's chunk, MAX_CHUNK_BYTES (5 MB): the router
 *             hands Workers AI the bytes in memory, so this is a memory bound
 *   type      the type declared on the message, normalised (lower case, no
 *             parameters, `audio/x-m4a` → `audio/mp4`, `audio/mp3` →
 *             `audio/mpeg`), must be one the recorder admits (CHUNK_MIME)
 *   bytes     the file's own container (providerHttp.ts's sniff) must agree
 *             with that type; with no declared type, the container names it.
 *             A download's `content-type` is never trusted.
 *
 * The rules are pure, with no provider names. D754 W3 (#1935) adds the one
 * shared step that keeps a consented note as recorder audio:
 *
 *   ingestChannelAudio  admit the file (the rules above), store it as a chunk
 *             of the chat's session (`putChunk`, `validate-audio/…`), mark the
 *             session for the recorder's voice-note mode, transcribe it there
 *             (`transcribeVoiceNote`: the per-chunk stage, a receipt line, the
 *             segments APPENDED under the note's speaker). Since D765 (#2090)
 *             no summary follows: the founder presses Summarise (D720 §6).
 *             The chunk's `seq` is the note's own message id: unique within
 *             the session and the same on every retry, so two jobs never
 *             share an R2 key and a retry stores nothing twice. Never a
 *             direct model call, `structureSession` or `summariseSession`.
 */
import type { Env } from '../../types';
import { CHUNK_MIME, MAX_CHUNK_BYTES, putChunk } from '../interviewSessions';
import { sniffAudioContainer, type AudioContainer } from './providerHttp';
import type { ChannelProvider, MessageSide, VoiceMedia } from './types';

export const CHANNEL_AUDIO_MAX_BYTES = MAX_CHUNK_BYTES;

const ALIASES: Record<string, string> = { 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg' };

/** The declared types each container may carry; the first is the type a file with none is given. */
const CONTAINER_TYPES: Record<Exclude<AudioContainer, 'unknown'>, readonly string[]> = {
  ogg: ['audio/ogg'],
  mpeg: ['audio/mpeg'],
  wav: ['audio/wav', 'audio/x-wav'],
  mp4: ['audio/mp4'],
  webm: ['audio/webm'],
};

/** A declared type, lower-cased, without parameters, with its alias resolved. Null when there is none. */
export function normaliseAudioMime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const type = raw.split(';')[0].trim().toLowerCase();
  if (!type) return null;
  return ALIASES[type] ?? type;
}

/** Whether a declared type, normalised, is one the recorder admits. */
export function audioMimeAdmitted(raw: unknown): boolean {
  const type = normaliseAudioMime(raw);
  return !!type && Object.prototype.hasOwnProperty.call(CHUNK_MIME, type);
}

/** The type to transcribe a file as, or `unsupported_format`. */
export function admitAudio(declared: string | null, container: AudioContainer):
  { ok: true; mime: string } | { ok: false; code: 'unsupported_format' } {
  if (container === 'unknown' || !Object.prototype.hasOwnProperty.call(CONTAINER_TYPES, container)) return { ok: false, code: 'unsupported_format' };
  const types = CONTAINER_TYPES[container];
  const type = normaliseAudioMime(declared);
  if (type === null) return { ok: true, mime: types[0] };
  if (!audioMimeAdmitted(type) || !types.includes(type)) return { ok: false, code: 'unsupported_format' };
  return { ok: true, mime: type };
}

export type IngestResult =
  | { ok: true; appended: number; already: boolean }
  | { ok: false; reason: 'too_large' | 'unsupported_format' }
  | { ok: false; reason: 'transcription'; refusal: string; budget: boolean };

/**
 * One consented note, kept and transcribed as the recorder's audio is. A
 * refusal is a code (a `VoiceReason`, or the transcription's refusal), never a
 * throw; a session the member can no longer write throws `IntakeError` 404,
 * as every intake write does. `alongside` runs in the append's batch.
 */
export async function ingestChannelAudio(env: Env, opts: {
  sessionId: number; userId: number; seq: number; bytes: Uint8Array; declaredMime: string | null;
  mediaKind: VoiceMedia; side: MessageSide; speakerLabel: string; provider: ChannelProvider;
  alongside?: D1PreparedStatement[];
}): Promise<IngestResult> {
  if (opts.bytes.byteLength > CHANNEL_AUDIO_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const admitted = admitAudio(opts.declaredMime, sniffAudioContainer(opts.bytes));
  if (!admitted.ok) return { ok: false, reason: 'unsupported_format' };
  // Dynamic: the adapters import the rules above, and must not load the intake and the pipeline with them.
  const [{ writableSession }, { transcribeVoiceNote }] = await Promise.all([import('../interviewIntake'), import('../interviewProcessing')]);
  const { session } = await writableSession(env, opts.userId, opts.sessionId);
  const body = opts.bytes.slice().buffer as ArrayBuffer;
  await putChunk(env, session, opts.userId, opts.seq, admitted.mime, body, null, { side: opts.side, media: opts.mediaKind });
  // The recorder's pipeline never structures a chat per note (D757 ruling 7);
  // a run that stops here is resumed in voice-note mode by the sweeper.
  await env.DB.prepare(
    `UPDATE interview_sessions
        SET processing_auto = 0, processing_stage = 'transcribing', processing_error = NULL,
            expected_last_seq = MAX(COALESCE(expected_last_seq, -1), ?),
            processing_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(opts.seq, session.id).run();
  const r = await transcribeVoiceNote(env, {
    session, userId: opts.userId, seq: opts.seq, speakerLabel: opts.speakerLabel, provider: opts.provider, alongside: opts.alongside,
  });
  if (!r.ok) return { ok: false, reason: 'transcription', refusal: r.refusal, budget: r.budget };
  await env.DB.prepare(
    `UPDATE interview_sessions SET processing_stage = 'done', processing_updated_at = datetime('now')
      WHERE id = ? AND processing_stage = 'transcribing'
        AND NOT EXISTS (SELECT 1 FROM interview_session_chunks c WHERE c.session_id = interview_sessions.id
                          AND NOT EXISTS (SELECT 1 FROM interview_chunk_transcripts t WHERE t.session_id = c.session_id AND t.seq = c.seq))`,
  ).bind(session.id).run();
  // D765 (#2090), D720 §6: transcribed (saving); no summary starts without the founder's press.
  return r;
}
