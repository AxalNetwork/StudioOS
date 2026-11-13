/**
 * D870 (#2517) — a call's authorized audio recording, turned into text with
 * Workers AI speech-to-text, for the calls whose provider made no transcript.
 * Shared with M2 (Google Meet) and M3 (an uploaded recording): the source
 * choice, the chunking and the transcription are here; fetching the file with
 * the member's own token stays in each provider's adapter (`zoom.ts`).
 *
 * THE SOURCE (`chooseRecordingSource`), in this order:
 *   1. the provider's own transcript (Zoom's TRANSCRIPT, else its CC file),
 *      when the call's language is English or unknown;
 *   2. otherwise the audio-only recording (Zoom's M4A);
 *   3. otherwise the transcript after all, when the founder set another
 *      language and there is no audio to transcribe in it;
 *   4. otherwise nothing, with the reason.
 * A file the provider is still processing makes the call wait, never guess.
 *
 * WITHIN WORKERS LIMITS. A 60-minute M4A is one file whose index (`moov`) can
 * sit at either end, so it cannot be cut by bytes: Cloudflare's own Whisper
 * chunking guide cuts MP3 by bytes, which works for MP3's self-synchronising
 * frames and not for MP4. `demuxM4a` reads the AAC samples out of the file's
 * sample tables, and `remuxChunk` writes each run of them as a small, complete
 * M4A that copies the source's own codec description (`stsd`) byte for byte.
 * A chunk is at most `MAX_CHUNK_BYTES` (the recorder's own per-chunk bound,
 * the size the router already sends Workers AI) and `CHUNK_MAX_MS`. Media
 * Transformations' audio mode was not used: its documented input limit is 10
 * minutes and 100 MB (D870 §3).
 *
 * THE CHUNKS are recorder chunks: `putChunk` stores each in R2 under the
 * call's session, and they are purged with it. Each is transcribed once by the
 * recorder's own `transcribeChunk` (the router, the session's model, metered
 * on the AI token ledger) and staged in `interview_chunk_transcripts`; a
 * staged chunk is never transcribed again, so a retry or a duplicate event
 * charges once.
 *
 * Nothing here logs audio, text or a URL.
 */
import type { Env } from '../../types';
import {
  listChunks, loadSession, MAX_CHUNK_BYTES, putChunk, recordReceipt, type SessionRow, type StoredSegment,
} from '../interviewSessions';
import { CUSTOMER_RESEARCH_PAGE, TRANSCRIBE_OPTIONS, transcribeChunk } from '../interviewProcessing';
import { audioMinutesFromBytes } from '../aiRouter';
import { DEFAULT_FINAL_MODEL } from '../sttModels';
import type { ImportedSegment } from './types';

/** A chunk's longest span. Ten minutes keeps a 60-minute call to six requests, and a cut mid-word to five. */
export const CHUNK_MAX_MS = 10 * 60 * 1000;
/** The largest audio recording fetched: about two hours of Zoom's audio-only M4A (UNVERIFIED bitrate). */
export const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
/** Chunks transcribed per run (a job message or a member's Retry); the rest continue on the queue. */
export const STT_CHUNKS_PER_RUN = 3;
/** The one container the audio path reads. */
export const AUDIO_MIME = 'audio/mp4';

// ───────────────────────────────────────────────────────────── the source

/** One recording file as a provider lists it, reduced to what the choice reads. */
export interface RecordingFileLike { file_type?: string; status?: string; download_url?: string }

export type SourceChoice<F> =
  | { kind: 'native'; file: F }
  | { kind: 'audio'; file: F }
  | { kind: 'waiting' }
  | { kind: 'none' };

/** English or unknown: the provider's own transcript is good enough and costs nothing. */
export function prefersNative(callLang: string | null | undefined): boolean {
  const lang = String(callLang ?? '').trim().toLowerCase();
  return !lang || lang === 'en' || lang.startsWith('en-');
}

/**
 * The file a call's text comes from. `usable` says whether a file can be
 * downloaded (completed, on the provider's own host).
 */
export function chooseRecordingSource<F extends RecordingFileLike>(
  files: F[], callLang: string | null | undefined, usable: (f: F) => boolean,
): SourceChoice<F> {
  const typed = (type: string) => files.filter((f) => String(f.file_type ?? '').toUpperCase() === type);
  const natives = typed('TRANSCRIPT').length ? typed('TRANSCRIPT') : typed('CC');
  const audios = typed('M4A');
  const ready = (list: F[]) => list.find((f) => (f.status ?? 'completed') === 'completed' && usable(f));
  const native = ready(natives);
  const audio = ready(audios);
  const order: Array<['native' | 'audio', F[], F | undefined]> = prefersNative(callLang)
    ? [['native', natives, native], ['audio', audios, audio]]
    : [['audio', audios, audio], ['native', natives, native]];
  for (const [kind, list, file] of order) {
    if (file) return { kind, file };
    if (list.length) return { kind: 'waiting' };
  }
  return { kind: 'none' };
}

// ───────────────────────────────────────────────────────────── M4A in

export class AudioUnreadable extends Error {
  constructor(reason: string) { super(`audio_unreadable:${reason}`); this.name = 'AudioUnreadable'; }
}

interface Box { type: string; start: number; body: number; end: number }

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** The boxes directly inside [from, to). Refuses a box that runs past its parent. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) throw new AudioUnreadable('box');
      size = u64(b, at + 8);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) throw new AudioUnreadable('box');
    out.push({ type, start: at, body, end: at + size });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string) => boxes(b, parent.body, parent.end).find((x) => x.type === type) ?? null;

function need(box: Box | null, what: string): Box {
  if (!box) throw new AudioUnreadable(what);
  return box;
}

export interface DemuxedAudio {
  /** Samples per second of the media's own clock. */
  timescale: number;
  /** The `stsd` box as it is in the source, header included. */
  stsd: Uint8Array;
  /** Each AAC sample: where it is in the file, its size, and its duration in `timescale` units. */
  samples: Array<{ offset: number; size: number; duration: number }>;
}

/**
 * The audio track of an MP4/M4A: its clock, codec description and samples.
 * Reads only the sample tables (stts, stsc, stsz, stco/co64); every offset is
 * checked against the file, and a file without exactly the tables an AAC
 * track has is refused.
 */
export function demuxM4a(b: Uint8Array): DemuxedAudio {
  const top = boxes(b, 0, b.length);
  if (!top.some((x) => x.type === 'ftyp')) throw new AudioUnreadable('ftyp');
  const moov = need(top.find((x) => x.type === 'moov') ?? null, 'moov');
  const track = boxes(b, moov.body, moov.end).filter((x) => x.type === 'trak').find((t) => {
    const hdlr = child(b, need(child(b, t, 'mdia'), 'mdia'), 'hdlr');
    return !!hdlr && hdlr.body + 12 <= hdlr.end && fourcc(b, hdlr.body + 8) === 'soun';
  });
  if (!track) throw new AudioUnreadable('no_audio_track');
  const mdia = need(child(b, track, 'mdia'), 'mdia');
  const mdhd = need(child(b, mdia, 'mdhd'), 'mdhd');
  const timescale = b[mdhd.body] === 1 ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
  if (!timescale) throw new AudioUnreadable('timescale');
  const stbl = need(child(b, need(child(b, mdia, 'minf'), 'minf'), 'stbl'), 'stbl');
  const stsd = need(child(b, stbl, 'stsd'), 'stsd');
  if (!boxes(b, stsd.body + 8, stsd.end).some((x) => x.type === 'mp4a')) throw new AudioUnreadable('not_aac');

  const stsz = need(child(b, stbl, 'stsz'), 'stsz');
  const fixed = u32(b, stsz.body + 4);
  const count = u32(b, stsz.body + 8);
  if (!count || (!fixed && stsz.body + 12 + count * 4 > stsz.end)) throw new AudioUnreadable('stsz');
  const sizes = Array.from({ length: count }, (_, i) => fixed || u32(b, stsz.body + 12 + i * 4));

  const stco = child(b, stbl, 'stco');
  const co64 = child(b, stbl, 'co64');
  const chunkBox = need(stco ?? co64, 'stco');
  const chunks = u32(b, chunkBox.body + 4);
  const width = stco ? 4 : 8;
  if (chunkBox.body + 8 + chunks * width > chunkBox.end) throw new AudioUnreadable('stco');
  const chunkOffset = (i: number) => (stco ? u32(b, chunkBox.body + 8 + i * 4) : u64(b, chunkBox.body + 8 + i * 8));

  const stsc = need(child(b, stbl, 'stsc'), 'stsc');
  const runs = u32(b, stsc.body + 4);
  if (!runs || stsc.body + 8 + runs * 12 > stsc.end) throw new AudioUnreadable('stsc');
  const run = (i: number) => ({ first: u32(b, stsc.body + 8 + i * 12), per: u32(b, stsc.body + 12 + i * 12) });

  const stts = need(child(b, stbl, 'stts'), 'stts');
  const deltas = u32(b, stts.body + 4);
  if (stts.body + 8 + deltas * 8 > stts.end) throw new AudioUnreadable('stts');
  const durations: number[] = [];
  for (let i = 0; i < deltas && durations.length < count; i++) {
    const n = u32(b, stts.body + 8 + i * 8);
    const d = u32(b, stts.body + 12 + i * 8);
    for (let k = 0; k < n && durations.length < count; k++) durations.push(d);
  }
  if (durations.length !== count) throw new AudioUnreadable('stts');

  const samples: DemuxedAudio['samples'] = [];
  for (let r = 0; r < runs && samples.length < count; r++) {
    const { first, per } = run(r);
    const last = r + 1 < runs ? run(r + 1).first - 1 : chunks;
    if (first < 1 || last > chunks || !per) throw new AudioUnreadable('stsc');
    for (let c = first; c <= last && samples.length < count; c++) {
      let at = chunkOffset(c - 1);
      for (let k = 0; k < per && samples.length < count; k++) {
        const i = samples.length;
        if (at + sizes[i] > b.length) throw new AudioUnreadable('sample_offset');
        samples.push({ offset: at, size: sizes[i], duration: durations[i] });
        at += sizes[i];
      }
    }
  }
  if (samples.length !== count) throw new AudioUnreadable('sample_count');
  return { timescale, stsd: b.slice(stsd.start, stsd.end), samples };
}

// ───────────────────────────────────────────────────────────── M4A out

export interface ChunkPlan { from: number; to: number; startMs: number; endMs: number; bytes: number }

/** Runs of whole samples, each within `maxBytes` and `maxMs`. */
export function planChunks(a: DemuxedAudio, maxBytes = MAX_CHUNK_BYTES, maxMs = CHUNK_MAX_MS): ChunkPlan[] {
  // The chunk's boxes besides its samples and their stsz entries (counted per sample below).
  const overhead = 2048 + a.stsd.length;
  const plans: ChunkPlan[] = [];
  let from = 0;
  let clock = 0;
  while (from < a.samples.length) {
    let to = from;
    let bytes = 0;
    let span = 0;
    while (to < a.samples.length) {
      const s = a.samples[to];
      const nextBytes = bytes + s.size + 4;
      const nextMs = ((span + s.duration) * 1000) / a.timescale;
      if (to > from && (nextBytes + overhead > maxBytes || nextMs > maxMs)) break;
      bytes = nextBytes - 4;
      span += s.duration;
      to += 1;
    }
    if (bytes + overhead > maxBytes) throw new AudioUnreadable('sample_too_large');
    plans.push({ from, to, startMs: Math.round((clock * 1000) / a.timescale), endMs: Math.round(((clock + span) * 1000) / a.timescale), bytes });
    clock += span;
    from = to;
  }
  return plans;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function words(...values: Array<number | [number, 'u16' | 'u8']>): Uint8Array {
  const sizes = values.map((v) => (Array.isArray(v) ? (v[1] === 'u16' ? 2 : 1) : 4));
  const out = new Uint8Array(sizes.reduce((n, s) => n + s, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  values.forEach((v, i) => {
    if (Array.isArray(v)) { if (v[1] === 'u16') view.setUint16(at, v[0]); else view.setUint8(at, v[0]); }
    else view.setUint32(at, v >>> 0);
    at += sizes[i];
  });
  return out;
}

const MATRIX = words(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
const ascii = (s: string) => new TextEncoder().encode(s);

/**
 * Samples [plan.from, plan.to) as one complete M4A: ftyp, a one-track moov
 * with the source's own codec description, and the samples in one mdat.
 */
export function remuxChunk(a: DemuxedAudio, source: Uint8Array, plan: ChunkPlan): Uint8Array {
  const picked = a.samples.slice(plan.from, plan.to);
  const duration = picked.reduce((n, s) => n + s.duration, 0);
  const sttsRuns: Array<[number, number]> = [];
  for (const s of picked) {
    const last = sttsRuns[sttsRuns.length - 1];
    if (last && last[1] === s.duration) last[0] += 1; else sttsRuns.push([1, s.duration]);
  }
  const ftyp = box('ftyp', ascii('M4A '), words(0), ascii('M4A mp42isom'));
  const moovFor = (mdatPayload: number) => box('moov',
    box('mvhd', words(0, 0, 0, a.timescale, duration, 0x00010000), words([0x0100, 'u16'], [0, 'u16'], 0, 0), MATRIX, new Uint8Array(24), words(2)),
    box('trak',
      box('tkhd', words(3, 0, 0, 1, 0, duration, 0, 0), words([0, 'u16'], [0, 'u16'], [0x0100, 'u16'], [0, 'u16']), MATRIX, words(0, 0)),
      box('mdia',
        box('mdhd', words(0, 0, 0, a.timescale, duration), words([0x55c4, 'u16'], [0, 'u16'])),
        box('hdlr', words(0, 0), ascii('soun'), new Uint8Array(12), ascii('SoundHandler\0')),
        box('minf',
          box('smhd', words(0), words([0, 'u16'], [0, 'u16'])),
          box('dinf', box('dref', words(0, 1), box('url ', words(1)))),
          box('stbl',
            a.stsd,
            box('stts', words(0, sttsRuns.length), ...sttsRuns.map(([n, d]) => words(n, d))),
            box('stsc', words(0, 1, 1, picked.length, 1)),
            box('stsz', words(0, 0, picked.length), ...picked.map((s) => words(s.size))),
            box('stco', words(0, 1, mdatPayload)),
          ),
        ),
      ),
    ),
  );
  const moovSize = moovFor(0).length;
  const moov = moovFor(ftyp.length + moovSize + 8);
  const media = new Uint8Array(plan.bytes);
  let at = 0;
  for (const s of picked) { media.set(source.subarray(s.offset, s.offset + s.size), at); at += s.size; }
  return concat(ftyp, moov, box('mdat', media));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ───────────────────────────────────────────────────────────── store and transcribe

/** Stored chunks and how many the recording has; null when none are stored yet. */
async function storedPlan(env: Env, session: SessionRow): Promise<{ total: number; stored: number } | null> {
  if (session.expected_last_seq == null) return null;
  const chunks = await listChunks(env, session.id);
  return { total: session.expected_last_seq + 1, stored: chunks.filter((c) => c.seq <= session.expected_last_seq!).length };
}

/** Whether every chunk of the call's audio is already in R2 (a resumed run needs no download). */
export async function audioStored(env: Env, sessionId: number): Promise<boolean> {
  const session = await loadSession(env, sessionId);
  const plan = session ? await storedPlan(env, session) : null;
  return !!plan && plan.stored >= plan.total;
}

/**
 * Cut the recording into chunks and store each under the session. Idempotent:
 * a chunk already stored is kept (`putChunk` answers duplicate), so a run
 * that stopped halfway finishes the set. Returns the number of chunks.
 */
export async function storeAudioChunks(env: Env, sessionId: number, ownerUserId: number, source: Uint8Array, runUid: string): Promise<number> {
  const session = await loadSession(env, sessionId);
  if (!session) throw new AudioUnreadable('session');
  const demuxed = demuxM4a(source);
  const plans = planChunks(demuxed);
  for (let seq = 0; seq < plans.length; seq++) {
    const bytes = remuxChunk(demuxed, source, plans[seq]);
    await putChunk(env, session, ownerUserId, seq, AUDIO_MIME, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      plans[seq].startMs, { source: 'meeting_audio', stt_run: runUid, end_ms: String(plans[seq].endMs) });
  }
  await env.DB.prepare(`UPDATE interview_sessions SET expected_last_seq = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(plans.length - 1, session.id).run();
  return plans.length;
}

export type TranscribeRun =
  | { state: 'done'; segments: ImportedSegment[]; model: string }
  | { state: 'more'; done: number; total: number }
  | { state: 'refused'; refusal: string; budget: boolean };

const SPEAKER_UNKNOWN = 'Speaker ?';

/**
 * Transcribe up to `max` stored chunks not yet staged, then, once every chunk
 * is staged, the whole call's segments on one timeline. Whisper names no
 * speaker, so a passage reads "Speaker ?" until the founder assigns it.
 */
export async function transcribeStoredChunks(
  env: Env, sessionId: number, userId: number, callLang: string | null, max = STT_CHUNKS_PER_RUN,
): Promise<TranscribeRun> {
  const session = await loadSession(env, sessionId);
  if (!session || session.expected_last_seq == null) return { state: 'refused', refusal: 'chunk_missing', budget: false };
  const last = session.expected_last_seq;
  const chunks = (await listChunks(env, session.id)).filter((c) => c.seq <= last);
  if (chunks.length < last + 1) return { state: 'refused', refusal: 'chunk_missing', budget: false };
  const staged = await env.DB.prepare('SELECT seq FROM interview_chunk_transcripts WHERE session_id = ?').bind(session.id).all<{ seq: number }>();
  const have = new Set((staged.results ?? []).map((r) => Number(r.seq)));
  const model = DEFAULT_FINAL_MODEL;
  let done = have.size;
  for (const chunk of chunks.filter((c) => !have.has(c.seq)).slice(0, Math.max(1, max))) {
    const r = await transcribeChunk(env, {
      session: { language: callLang }, userId, chunk, model, intervieweeName: null, offsetMs: 0,
      rail: { page: CUSTOMER_RESEARCH_PAGE, option: TRANSCRIBE_OPTIONS.session, record: `session:${session.id}` },
    });
    if (!r.ok) {
      await recordReceipt(env, session.id, {
        kind: 'final', model, requested_model: model, fallback_used: false,
        audio_minutes: audioMinutesFromBytes(chunk.size_bytes), cost_microusd: 0,
        outcome: r.budget ? 'refused' : 'failed', refusal: r.refusal,
      });
      return { state: 'refused', refusal: r.refusal, budget: r.budget };
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO interview_chunk_transcripts (session_id, seq, model, language, segments_json, cost_microusd, fallback_used)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(session.id, chunk.seq, r.model, r.language, JSON.stringify(r.segments), r.costMicro, r.fallback ? 1 : 0).run();
    done += 1;
  }
  if (done < chunks.length) return { state: 'more', done, total: chunks.length };

  const rows = await env.DB.prepare(
    'SELECT seq, model, segments_json, cost_microusd FROM interview_chunk_transcripts WHERE session_id = ? AND seq <= ? ORDER BY seq',
  ).bind(session.id, last).all<{ seq: number; model: string; segments_json: string; cost_microusd: number }>();
  const startOf = new Map(chunks.map((c) => [c.seq, c.start_ms ?? 0]));
  const segments: ImportedSegment[] = [];
  let used = model;
  let cost = 0;
  for (const row of rows.results ?? []) {
    const offset = startOf.get(Number(row.seq)) ?? 0;
    used = row.model || used;
    cost += Number(row.cost_microusd || 0);
    for (const s of JSON.parse(row.segments_json) as StoredSegment[]) {
      segments.push({
        speaker: s.speaker_label && s.speaker_label !== 'Speaker ?' ? s.speaker_label : SPEAKER_UNKNOWN,
        text: s.text,
        startMs: s.start_ms == null ? null : s.start_ms + offset,
        endMs: s.end_ms == null ? null : s.end_ms + offset,
      });
    }
  }
  await recordReceipt(env, session.id, {
    kind: 'final', model: used, requested_model: model, fallback_used: false,
    audio_minutes: chunks.reduce((m, c) => m + audioMinutesFromBytes(c.size_bytes), 0), cost_microusd: cost, outcome: 'ok',
  });
  return { state: 'done', segments, model: used };
}
