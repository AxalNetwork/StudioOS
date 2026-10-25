// D872 (#2519) — upload a call recording into Record a Session. Logic only;
// the page waits on M9's canvas.
//
// Any call's file (a Zoom local recording, a Meet recording from Drive, Teams,
// a phone recorder) is decoded ON THE FOUNDER'S DEVICE with Web Audio, mixed
// to mono at 16 kHz, and cut into WAV parts of 120 seconds each: 16-bit PCM
// behind a 44-byte header, 3.84 MB, under the Worker's 5 MB chunk limit. Only
// those parts travel, through the recorder's own routes:
//
//   open    POST /sessions              { source: 'upload', attestation, duration_ms, client_key, … }
//   get     GET  /sessions/:id          which parts the Worker already holds
//   chunk   PUT  /sessions/:id/chunks/:seq   one part, audio/wav, with x-chunk-start-ms
//   finish  POST /sessions/:id/finish   { last_seq } — the recorder's pipeline transcribes each part once
//
// WHY WAV. Re-encoding through MediaRecorder runs in real time (a 45-minute
// call would take 45 minutes); PCM is written as fast as it is read. Each part
// is a whole two minutes, so it is charged its true two minutes of
// speech-to-text, never a rounded-up third (`chunkAudioMinutes`, D872 §3).
//
// RESUMABLE. The session is opened with a `client_key` derived from the file
// (its name, size and last change, hashed), so opening it again answers the
// same session; the parts the Worker already holds are skipped, and a part
// sent twice is a duplicate the Worker stores once.
//
// NOTHING UPLOADS WITHOUT THE ATTESTATION: "Everyone recorded agreed: out
// loud, in writing, or beforehand." It is checked before the file is read.

export const UPLOAD_SAMPLE_RATE = 16000;
export const PART_SECONDS = 120;
export const WAV_HEADER_BYTES = 44;
/** The Worker's limits (interviewSessions.ts `MAX_CHUNK_BYTES`, `MAX_UPLOAD_MS`). */
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_MS = 3 * 3600 * 1000;

/** The attestation's methods, as the Worker records them: out loud, in writing, beforehand. */
export const ATTESTATIONS = Object.freeze([
  { method: 'verbal', label: 'Out loud' },
  { method: 'written', label: 'In writing' },
  { method: 'pre_agreed', label: 'Beforehand' },
]);
export const ATTESTATION_SENTENCE = 'Everyone recorded agreed: out loud, in writing, or beforehand.';

export const MESSAGES = Object.freeze({
  attestation_required: 'Confirm that everyone recorded agreed (out loud, in writing, or beforehand) before uploading.',
  undecodable: 'This file could not be read as audio on this device. Export the call as MP3, M4A, MP4 or WAV, and try again.',
  empty: 'This file has no sound in it.',
  upload_too_long: 'A recording can be at most 3 hours long. Trim it, or upload it in parts.',
});

export class UploadError extends Error {
  constructor(code, message = MESSAGES[code] || 'The recording could not be uploaded.') {
    super(message);
    this.name = 'UploadError';
    this.code = code;
  }
}

/** The attestation as the Worker takes it, or null when it is not given. */
export function attestationOf(input) {
  const method = input && input.agreed === true ? String(input.method || '') : '';
  return ATTESTATIONS.some((a) => a.method === method) ? { agreed: true, method } : null;
}

/** One channel at 16 kHz: the channels averaged. */
export function mixToMono(audioBuffer) {
  const n = audioBuffer.numberOfChannels;
  if (n === 1) return audioBuffer.getChannelData(0);
  const out = new Float32Array(audioBuffer.length);
  for (let ch = 0; ch < n; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < out.length; i += 1) out[i] += data[i] / n;
  }
  return out;
}

/**
 * Decode a file with Web Audio, resampled to 16 kHz by an OfflineAudioContext
 * at that rate. A file the browser cannot read is one plain UploadError.
 */
export async function decodeFile(file, { OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext } = {}) {
  if (!OfflineContext) throw new UploadError('undecodable');
  let audioBuffer;
  try {
    const ctx = new OfflineContext(1, 1, UPLOAD_SAMPLE_RATE);
    audioBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new UploadError('undecodable');
  }
  if (!audioBuffer || !audioBuffer.length) throw new UploadError('empty');
  if (audioBuffer.sampleRate !== UPLOAD_SAMPLE_RATE) throw new UploadError('undecodable');
  const samples = mixToMono(audioBuffer);
  return { samples, durationMs: Math.round((samples.length / UPLOAD_SAMPLE_RATE) * 1000) };
}

/** The parts of a recording of `total` samples: `seq`, its sample range and where it starts. */
export function planParts(total, { sampleRate = UPLOAD_SAMPLE_RATE, partSeconds = PART_SECONDS } = {}) {
  const per = sampleRate * partSeconds;
  const parts = [];
  for (let start = 0, seq = 0; start < total; start += per, seq += 1) {
    parts.push({ seq, start, end: Math.min(total, start + per), startMs: Math.round((start / sampleRate) * 1000) });
  }
  return parts;
}

/** Samples `start` to `end` as a WAV: 16 kHz, mono, 16-bit PCM, canonical 44-byte header. */
export function encodeWav(samples, start = 0, end = samples.length, sampleRate = UPLOAD_SAMPLE_RATE) {
  const count = Math.max(0, end - start);
  const out = new Uint8Array(WAV_HEADER_BYTES + count * 2);
  const v = new DataView(out.buffer);
  const tag = (at, s) => { for (let i = 0; i < 4; i += 1) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const x = Math.max(-1, Math.min(1, samples[start + i] || 0));
    v.setInt16(WAV_HEADER_BYTES + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

/** A stable key for one file, so a second open answers the same session. No name travels: it is hashed. */
export function uploadKey(file) {
  const s = `${file && file.name}|${file && file.size}|${file && file.lastModified}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  return `upload-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Upload one recording into a session and start its transcription.
 *
 * `target` is where it is recorded: `{ project_id, interview_id }` for an
 * interview the founder picks, or `{ project_id, interviewee: { name } }` for
 * a new one. `api` is `interviewSessionsApi` (open, get, uploadChunk, finish);
 * `decode` is `decodeFile`, injectable for tests. `onProgress({ done, total })`
 * counts parts stored. Returns `{ sessionId, parts, sent, skipped }`.
 */
export async function uploadRecording({
  file, api, target, attestation, channel = 'video', finalModel, onProgress, decode = decodeFile,
}) {
  const attested = attestationOf(attestation);
  if (!attested) throw new UploadError('attestation_required');
  const { samples, durationMs } = await decode(file);
  if (!samples.length) throw new UploadError('empty');
  if (durationMs > MAX_UPLOAD_MS) throw new UploadError('upload_too_long');

  const opened = await api.open({
    ...target, channel, source: 'upload', attestation: attested, duration_ms: durationMs, client_key: uploadKey(file),
    ...(finalModel ? { final_model: finalModel } : {}),
  });
  const sessionId = opened.session.id;
  const held = new Set(((await api.get(sessionId)).chunks || []).map((c) => Number(c.seq)));
  const parts = planParts(samples.length);
  let sent = 0;
  let done = 0;
  for (const part of parts) {
    if (!held.has(part.seq)) {
      const blob = new Blob([encodeWav(samples, part.start, part.end)], { type: 'audio/wav' });
      await api.uploadChunk(sessionId, part.seq, blob, part.startMs);
      sent += 1;
    }
    done += 1;
    if (onProgress) onProgress({ done, total: parts.length });
  }
  // Transcribe only (D765): Summarise and structure stay the founder's press.
  await api.finish(sessionId, parts.length - 1, false);
  return { sessionId, parts: parts.length, sent, skipped: parts.length - sent };
}
