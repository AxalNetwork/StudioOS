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
 * Pure, with no provider names. D754 W3 extends this file for WhatsApp; it
 * does not write a second table.
 */
import { CHUNK_MIME, MAX_CHUNK_BYTES } from '../interviewSessions';
import type { AudioContainer } from './providerHttp';

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
