/**
 * D886 B2 (#2580): chunks survive a dropped connection, events arrive once
 * and in order, and the WAV is D872's byte for byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkUploader, backoffMs } from '../src/uploader.ts';
import { EventBatcher } from '../src/events.ts';
import { Chunker, encodeWav, toPcm16k } from '../src/wav.ts';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { CHUNK_SAMPLES, EVENT_BATCH_MAX, EVENT_QUEUE_MAX, FREE_LIMIT_MS, RETRY_TRIES, SAMPLE_RATE, WAV_HEADER_BYTES } from '../src/constants.ts';
// The browser uploader's encoder (D872), whose parts the Worker already admits.
import { encodeWav as browserEncodeWav } from '../../frontend/src/lib/recordingUpload.js';
import { FakeClock, StubCallback, tone } from './_harness.ts';

const silent = () => {};

test('1. the WAV header is the browser uploader\'s, byte for byte, and the samples are the PCM given', () => {
  const pcm = tone(1600);
  const ours = encodeWav(pcm);
  const floats = new Float32Array(pcm.length);
  const theirs: Uint8Array = browserEncodeWav(floats);
  assert.deepEqual([...ours.subarray(0, WAV_HEADER_BYTES)], [...theirs.subarray(0, WAV_HEADER_BYTES)]);
  const v = new DataView(ours.buffer);
  assert.equal(String.fromCharCode(...ours.subarray(0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), SAMPLE_RATE); assert.equal(v.getUint16(22, true), 1); assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), pcm.length * 2);
  for (const i of [0, 1, 799, 1599]) assert.equal(v.getInt16(WAV_HEADER_BYTES + i * 2, true), pcm[i]);
});

test('2. the chunker cuts ~30 s parts with seq and start times, across frames of any size', () => {
  const c = new Chunker();
  const out = [...c.push(tone(CHUNK_SAMPLES - 5)), ...c.push(tone(10)), ...c.push(tone(CHUNK_SAMPLES + 3))];
  const tail = c.flush();
  assert.deepEqual(out.map((x) => [x.seq, x.start_ms]), [[0, 0], [1, 30_000]]);
  assert.ok(out.every((x) => x.wav.byteLength === WAV_HEADER_BYTES + CHUNK_SAMPLES * 2));
  assert.deepEqual([tail!.seq, tail!.start_ms, tail!.wav.byteLength], [2, 60_000, WAV_HEADER_BYTES + 8 * 2]);
  assert.equal(c.flush(), null);
});

test('3. toPcm16k turns 48 kHz floats into 16 kHz PCM, clipped', () => {
  const pcm = toPcm16k(new Float32Array([0, 0, 0, 1, 1, 1, -1, -1, -1, 2, 2, 2]), 48000);
  assert.deepEqual([...pcm], [0, 0x7fff, -0x8000, 0x7fff]);
});

test('4. a dropped connection: the chunk is sent again after backoff, stored once, and the rest still go in order', async () => {
  const clock = new FakeClock();
  const cb = new StubCallback();
  cb.failChunk.set(1, 3);
  cb.lostAnswer.add(2);
  const up = new ChunkUploader(cb, clock, silent);
  const c = new Chunker(4);
  const t0 = clock.now();
  for (const ch of c.push(tone(16))) up.add(ch);
  await clock.until(up.drain());
  assert.ok(clock.now() - t0 >= 1000 + 2000 + 4000 + 1000, 'each retry waits its backoff');
  assert.deepEqual([...cb.chunks.keys()].sort(), [0, 1, 2, 3]);
  assert.equal(cb.chunkSends, 4 + 3 + 1, 'three failed sends of 1, one repeat of 2 whose answer was lost');
  assert.equal(up.storedCount, 4); assert.equal(up.failedCount, 0); assert.equal(up.lastSeq, 3);
  assert.deepEqual([0, 1, 2, 5, 6].map(backoffMs), [1000, 2000, 4000, 30_000, 30_000]);
});

test('5. a chunk that fails a whole pass stays queued and goes at the drain; one that never goes is counted', async () => {
  const clock = new FakeClock();
  const cb = new StubCallback();
  cb.failChunk.set(0, RETRY_TRIES + 1);
  const up = new ChunkUploader(cb, clock, silent);
  const c = new Chunker(4);
  for (const ch of c.push(tone(8))) up.add(ch);
  await clock.until(up.drain());
  assert.deepEqual([...cb.chunks.keys()].sort(), [0, 1], 'chunk 1 was not held up for good, and chunk 0 went on the drain');

  const cb2 = new StubCallback();
  cb2.failChunk.set(0, 1000);
  const up2 = new ChunkUploader(cb2, clock, silent);
  up2.add(new Chunker(4).push(tone(4))[0]);
  await clock.until(up2.drain());
  assert.equal(up2.failedCount, 1); assert.equal(up2.lastSeq, -1);
});

test('6. a whole run resumes its upload after the connection drops mid-call', async () => {
  const clock = new FakeClock();
  const cb = new StubCallback();
  cb.failChunk.set(1, 5);
  const a = new FakeAdapter({ openDoor: true });
  a.arrive('p1', 'A');
  const run = runBot({ runId: 'r', platform: 'teams', meetingUrl: 'https://teams.microsoft.com/l/x', notice: 'n', limitMs: FREE_LIMIT_MS, deadlineAt: clock.now()+FREE_LIMIT_MS, budgetDeadlineAt: clock.now()+120_000 }, { adapter: a, transport: cb, clock });
  await clock.advance(100);
  for (let i = 0; i < 4; i += 1) { a.say(tone(CHUNK_SAMPLES)); await clock.advance(30_000); }
  a.end();
  const r = await clock.until(run);
  assert.deepEqual([...cb.chunks.keys()].sort(), [0, 1, 2, 3]);
  assert.deepEqual([r.chunks, r.last_seq, r.chunks_failed], [4, 3, 0]);
});

test('7. events: batches of at most 50, in order; a failed batch is sent on the next flush; overflow is dropped and counted', async () => {
  const clock = new FakeClock();
  const cb = new StubCallback();
  const ev = new EventBatcher(cb, clock, silent, clock.now());
  cb.failEvents = 1;
  for (let i = 0; i < 120; i += 1) ev.speaker({ key: `p${i % 2}` });
  await clock.until(ev.flush(1));
  await clock.until(ev.flush(1));
  const got = cb.allEvents.map((e) => e.n);
  assert.deepEqual(got, Array.from({ length: 120 }, (_, i) => i + 1));
  assert.ok(cb.batches.every((b) => b.length <= EVENT_BATCH_MAX));

  const cb2 = new StubCallback();
  cb2.failEvents = 1_000_000;
  const ev2 = new EventBatcher(cb2, clock, silent, clock.now());
  for (let i = 0; i < EVENT_QUEUE_MAX + 7; i += 1) ev2.speaker({ key: `k${i}` });
  await clock.until(ev2.flush(1));
  assert.equal(ev2.droppedCount, 7);
  assert.equal(ev2.pendingCount, EVENT_QUEUE_MAX);
});
