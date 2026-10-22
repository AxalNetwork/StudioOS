/**
 * D872 (#2519) — `src/lib/recordingUpload.js`, the call-recording uploader:
 * part sizes and sequence numbers, the WAV each part is, the attestation
 * checked before anything is read, an undecodable file's one message, and a
 * resumed upload that sends only the parts the Worker does not hold.
 *
 * Web Audio and the API are stand-ins: `decodeFile` takes the context class,
 * `uploadRecording` takes `api` and `decode`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHUNK_BYTES, MAX_UPLOAD_MS, MESSAGES, PART_SECONDS, UPLOAD_SAMPLE_RATE, WAV_HEADER_BYTES, UploadError,
  attestationOf, decodeFile, encodeWav, planParts, uploadKey, uploadRecording,
} from '../src/lib/recordingUpload.js';

const RATE = UPLOAD_SAMPLE_RATE;
const PER_PART = RATE * PART_SECONDS;
const file = (name = 'call.m4a') => ({ name, size: 1234, lastModified: 1_700_000_000_000, arrayBuffer: async () => new ArrayBuffer(8) });
const ATTESTED = { agreed: true, method: 'verbal' };

/** An API that stores parts by seq, as the Worker does: a repeat is a duplicate, stored once. */
function fakeApi({ held = [] } = {}) {
  const chunks = new Map(held.map((seq) => [seq, { seq }]));
  const calls = { open: [], put: [], finish: [] };
  return {
    calls, chunks,
    async open(body) { calls.open.push(body); return { session: { id: 42 } }; },
    async get() { return { chunks: [...chunks.values()] }; },
    async uploadChunk(id, seq, blob, startMs) {
      calls.put.push({ id, seq, type: blob.type, size: blob.size, startMs });
      const duplicate = chunks.has(seq);
      chunks.set(seq, { seq });
      return { ok: true, seq, duplicate };
    },
    async finish(id, lastSeq, auto) { calls.finish.push({ id, lastSeq, auto }); return { ok: true }; },
  };
}
const decodedOf = (seconds) => async () => ({ samples: new Float32Array(Math.round(seconds * RATE)), durationMs: Math.round(seconds * 1000) });

test('parts: 120 seconds each, numbered from 0, the last one short, each under the Worker\'s 5 MB', () => {
  const total = Math.round(45 * 60 * RATE) + 123; // 45 minutes and a few samples
  const parts = planParts(total);
  assert.equal(parts.length, 23);
  assert.deepEqual(parts.map((p) => p.seq), [...Array(23).keys()]);
  assert.deepEqual([parts[0].start, parts[0].end, parts[0].startMs], [0, PER_PART, 0]);
  assert.deepEqual([parts[1].startMs, parts[22].start, parts[22].end], [120_000, 22 * PER_PART, total]);
  const full = encodeWav(new Float32Array(PER_PART));
  assert.equal(full.byteLength, WAV_HEADER_BYTES + PER_PART * 2);
  assert.ok(full.byteLength < MAX_CHUNK_BYTES, `${full.byteLength} bytes`);
  assert.deepEqual(planParts(0), []);
});

test('a part is a canonical WAV: RIFF, 16 kHz, mono, 16-bit PCM, 44-byte header, clipped samples', () => {
  const w = encodeWav(Float32Array.from([0, 0.5, -0.5, 2, -2]), 1, 5);
  const v = new DataView(w.buffer);
  const tag = (at) => String.fromCharCode(...w.slice(at, at + 4));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.deepEqual([v.getUint32(4, true), v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true), v.getUint32(40, true)],
    [36 + 8, 1, 1, 16000, 32000, 2, 16, 8]);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true)), [16383, -16384, 32767, -32768]);
});

test('no attestation, no read and no request; each method is one of the three', async () => {
  for (const bad of [undefined, {}, { agreed: false, method: 'verbal' }, { agreed: true }, { agreed: true, method: 'in_app' }, { agreed: 'yes', method: 'written' }]) {
    const api = fakeApi();
    let decoded = false;
    await assert.rejects(
      uploadRecording({ file: file(), api, target: { project_id: 1 }, attestation: bad, decode: async () => { decoded = true; return { samples: new Float32Array(1), durationMs: 1 }; } }),
      (e) => e instanceof UploadError && e.code === 'attestation_required' && e.message === MESSAGES.attestation_required,
    );
    assert.equal(decoded, false, 'the file was read');
    assert.equal(api.calls.open.length, 0, 'a request was sent');
  }
  assert.deepEqual(['verbal', 'written', 'pre_agreed'].map((m) => attestationOf({ agreed: true, method: m })?.method), ['verbal', 'written', 'pre_agreed']);
});

test('an undecodable file is one plain message; so is a context the browser lacks', async () => {
  class Broken { async decodeAudioData() { throw new Error('EncodingError: Unable to decode audio data'); } }
  await assert.rejects(decodeFile(file('notes.pdf'), { OfflineContext: Broken }), (e) => e.code === 'undecodable' && e.message === MESSAGES.undecodable);
  await assert.rejects(decodeFile(file(), { OfflineContext: null }), (e) => e.code === 'undecodable');
  // Decoded at 16 kHz and mixed to one channel.
  class Stereo {
    constructor(_c, _l, rate) { this.rate = rate; }
    async decodeAudioData() {
      const l = Float32Array.from([1, 1, 0]); const r = Float32Array.from([0, 1, 0]);
      return { sampleRate: this.rate, length: 3, numberOfChannels: 2, getChannelData: (ch) => (ch ? r : l) };
    }
  }
  const d = await decodeFile(file(), { OfflineContext: Stereo });
  assert.deepEqual([...d.samples], [0.5, 1, 0]);
  assert.equal(d.durationMs, Math.round((3 / 16000) * 1000));
});

test('a 45-minute recording: opened as an upload with its attestation and length, every part sent in order, then finish', async () => {
  const api = fakeApi();
  const progress = [];
  const r = await uploadRecording({
    file: file(), api, target: { project_id: 7, interview_id: 3 }, attestation: ATTESTED, decode: decodedOf(45 * 60),
    onProgress: (p) => progress.push(p.done),
  });
  assert.deepEqual(r, { sessionId: 42, parts: 23, sent: 23, skipped: 0 });
  const opened = api.calls.open[0];
  assert.deepEqual(
    [opened.project_id, opened.interview_id, opened.source, opened.attestation, opened.duration_ms, opened.channel],
    [7, 3, 'upload', ATTESTED, 45 * 60 * 1000, 'video'],
  );
  assert.match(opened.client_key, /^upload-[0-9a-f]{16}$/);
  assert.equal(opened.client_key.includes('call'), false, 'the file name is hashed, never sent');
  assert.deepEqual(api.calls.put.map((p) => p.seq), [...Array(23).keys()]);
  assert.ok(api.calls.put.every((p) => p.type === 'audio/wav' && p.size <= MAX_CHUNK_BYTES));
  assert.deepEqual(api.calls.put.slice(0, 2).map((p) => p.startMs), [0, 120_000]);
  assert.deepEqual(api.calls.finish, [{ id: 42, lastSeq: 22, auto: false }]);
  assert.equal(progress.at(-1), 23);
});

test('a resumed upload sends only what the Worker does not hold, under the same key', async () => {
  const first = fakeApi({ held: [0, 1, 2, 3, 4] });
  const r = await uploadRecording({ file: file(), api: first, target: { project_id: 7 }, attestation: ATTESTED, decode: decodedOf(20 * 60) });
  assert.deepEqual([r.parts, r.sent, r.skipped], [10, 5, 5]);
  assert.deepEqual(first.calls.put.map((p) => p.seq), [5, 6, 7, 8, 9]);
  const again = fakeApi({ held: [...Array(10).keys()] });
  const r2 = await uploadRecording({ file: file(), api: again, target: { project_id: 7 }, attestation: ATTESTED, decode: decodedOf(20 * 60) });
  assert.deepEqual([r2.sent, r2.skipped], [0, 10]);
  assert.equal(again.calls.open[0].client_key, first.calls.open[0].client_key, 'the same file opens the same session');
  assert.notEqual(uploadKey(file('other.m4a')), uploadKey(file()));
  assert.deepEqual(again.calls.finish, [{ id: 42, lastSeq: 9, auto: false }]);
});

test('longer than three hours, or silent, is refused before any request', async () => {
  for (const [decode, code] of [[decodedOf(MAX_UPLOAD_MS / 1000 + 1), 'upload_too_long'], [decodedOf(0), 'empty']]) {
    const api = fakeApi();
    await assert.rejects(uploadRecording({ file: file(), api, target: { project_id: 7 }, attestation: ATTESTED, decode }), (e) => e.code === code);
    assert.equal(api.calls.open.length, 0);
  }
});
